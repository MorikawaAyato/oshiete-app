import {
  View, Text, TouchableOpacity, ScrollView, Image, StyleSheet,
  Modal, TextInput, KeyboardAvoidingView, Platform, Pressable, Animated,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { useApp } from '@/lib/AppContext'
import { loadHistory, loadDrillPending, saveDrillPending, loadCardProgress, saveCardProgress, unitsFor, getUnitStatuses, logWork, loadWorkLog, dateKeyAfterDays, examDateLabel } from '@/lib/storage'
import type { WorkLog } from '@/lib/storage'
import type { HistoryItem, QACard } from '@/lib/types'
import { BottomTabBar } from '@/components/BottomTabBar'
import { c, font } from '@/lib/theme'
import { Feather } from '@expo/vector-icons'

const PRINCIPAL_IMAGE = require('../assets/tora_koutyou.webp')
const PRINCIPAL_IMAGE_DARK = require('../assets/tora_koutyou_dark.webp') // 紺の儀式面（通信パネル・ズーム）用
const TITLE_RE = /^この(教材|文書|画像|写真)は[、，]?\s*/u

// 研修（フラッシュカード）
const DRILL_SESSION_SIZE = 10

function drillKey(card: QACard): string {
  return card.statement.replace(/[\s　]/g, '')
}

// 「接続中」の声イコライザー：3本のバーが時差でゆらぐ（＝いま会話が流れている）。
// 静的な緑ドット（オンライン＝居る）との違いを形で示す
function EqBars() {
  const bars = [useRef(new Animated.Value(0.35)).current, useRef(new Animated.Value(0.35)).current, useRef(new Animated.Value(0.35)).current]
  useEffect(() => {
    const loops = bars.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 200),
          Animated.timing(v, { toValue: 1, duration: 500, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.35, duration: 500, useNativeDriver: true }),
        ])
      )
    )
    loops.forEach((l) => l.start())
    return () => loops.forEach((l) => l.stop())
  }, [])
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 1.5, height: 8 }}>
      {bars.map((v, i) => (
        <Animated.View key={i} style={{ width: 2, height: 8, borderRadius: 1, backgroundColor: '#34d399', transform: [{ scaleY: v }] }} />
      ))}
    </View>
  )
}

function shuffleCards<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function TrainingScreen() {
  const { teacherProfile, setTeacherProfile } = useApp()
  const [history, setHistory] = useState<HistoryItem[]>([])

  // 「まだ」のカードキー集合。残数バッジと校長のセリフに使う（markDrillで更新）
  const [drillPendingKeys, setDrillPendingKeys] = useState<Set<string>>(new Set())
  // 業務日誌（研修の記録行に使う。研修タブに出すのは研修のデータだけ）
  const [workLog, setWorkLog] = useState<WorkLog>({})
  // 完了済みの単元があるか（校長の「みがき直し」の口上に使う）
  const [hasDoneUnits, setHasDoneUnits] = useState(false)

  useFocusEffect(
    useCallback(() => {
      loadHistory().then(async (items) => {
        setHistory(items)
        let done = false
        for (const h of items) {
          const cards = h.factsheet?.cards ?? []
          if (cards.length === 0) continue
          const statuses = await getUnitStatuses(h.id, cards.length)
          if ((await unitsFor(h.id, cards.length)).some((_, i) => statuses[i] === 'done')) { done = true; break }
        }
        setHasDoneUnits(done)
      })
      void loadDrillPending().then(setDrillPendingKeys)
      void loadWorkLog().then(setWorkLog)
    }, [])
  )

  // フラッシュカードの進行状態
  const [drillMaterialId, setDrillMaterialId] = useState<string>('all')
  const [drillCards, setDrillCards] = useState<QACard[]>([])
  const [drillIdx, setDrillIdx] = useState(0)
  const [drillRevealed, setDrillRevealed] = useState(false)
  const [drillOkCount, setDrillOkCount] = useState(0)
  const [drillDone, setDrillDone] = useState(false)

  const drillPool = (materialId: string): QACard[] =>
    materialId === 'all'
      ? history.flatMap((h) => h.factsheet?.cards ?? [])
      : history.find((h) => h.id === materialId)?.factsheet?.cards ?? []

  // 完了済み単元のカードキー集合（研修の「わすれ防止」出題の対象）
  const collectDoneUnitKeys = async (): Promise<Set<string>> => {
    const keys = new Set<string>()
    for (const h of history) {
      const cards = h.factsheet?.cards ?? []
      if (cards.length === 0) continue
      const statuses = await getUnitStatuses(h.id, cards.length)
      ;(await unitsFor(h.id, cards.length)).forEach((u, i) => {
        if (statuses[i] !== 'done') return
        for (let k = u.start; k < u.start + u.size; k++) keys.add(drillKey(cards[k]))
      })
    }
    return keys
  }

  // 研修＝練習場：授業前のならしにも、完了後のわすれ防止にも同じ入口で応える。
  // 出題優先度は ①「まだ」 ②完了済み単元のカードを触れてから古い順（間隔反復） ③残りシャッフル
  const startDrill = async (materialId: string) => {
    const pool = drillPool(materialId)
    if (pool.length === 0) return
    const [pending, progress, doneKeys] = await Promise.all([loadDrillPending(), loadCardProgress(), collectDoneUnitKeys()])
    const pendingCards = shuffleCards(pool.filter((cd) => pending.has(drillKey(cd))))
    const maintainCards = pool
      .filter((cd) => !pending.has(drillKey(cd)) && doneKeys.has(drillKey(cd)))
      .sort((a, b) => (progress[drillKey(a)]?.lastAt ?? 0) - (progress[drillKey(b)]?.lastAt ?? 0))
    const restCards = shuffleCards(pool.filter((cd) => !pending.has(drillKey(cd)) && !doneKeys.has(drillKey(cd))))
    setDrillCards([...pendingCards, ...maintainCards, ...restCards].slice(0, DRILL_SESSION_SIZE))
    setDrillIdx(0)
    setDrillRevealed(false)
    setDrillOkCount(0)
    setDrillDone(false)
  }

  const markDrill = async (remembered: boolean) => {
    const card = drillCards[drillIdx]
    if (!card) return
    const pending = await loadDrillPending()
    if (remembered) {
      pending.delete(drillKey(card))
      setDrillOkCount((v) => v + 1)
    } else {
      pending.add(drillKey(card))
    }
    await saveDrillPending(pending)
    setDrillPendingKeys(new Set(pending))
    // 研修も「触れた」として記録（間隔反復の並び順の元データ）
    const progress = await loadCardProgress()
    const key = drillKey(card)
    progress[key] = { seen: (progress[key]?.seen ?? 0) + 1, lastAt: Date.now(), lastResult: remembered }
    await saveCardProgress(progress)
    if (drillIdx + 1 >= drillCards.length) {
      setDrillDone(true)
      void logWork('drill', { historyId: drillMaterialId !== 'all' ? drillMaterialId : undefined }) // 業務日誌へ（最後までめくった研修だけを記録）
    } else {
      setDrillIdx((i) => i + 1)
      setDrillRevealed(false)
    }
  }

  const exitDrill = () => {
    setDrillCards([])
    setDrillDone(false)
    setDrillIdx(0)
    setDrillRevealed(false)
  }

  const [showPrincipalAvatar, setShowPrincipalAvatar] = useState(false)

  const allCards = history.flatMap((h) => h.factsheet?.cards ?? [])
  const materialsWithCards = history.filter((h) => (h.factsheet?.cards?.length ?? 0) > 0)
  const teacherCall = teacherProfile.name ? `${teacherProfile.name}先生` : '先生'
  // 「まだ」のカード残数（全体・教材ごと）。研修に戻ってくる理由を可視化する
  const pendingCountOf = (cards: QACard[]) => cards.filter((cd) => drillPendingKeys.has(drillKey(cd))).length
  const allPending = pendingCountOf(allCards)
  // 研修の記録：研修タブに出す数字は研修由来のものだけ（「まだ」と実施記録）。
  // 授業の丸付け結果はここには映さない＝研修と授業は別の部屋
  const drillDayKeys = Object.keys(workLog).filter((k) => (workLog[k]?.drill ?? 0) > 0).sort()
  const lastDrillKey = drillDayKeys[drillDayKeys.length - 1]
  const recent7Keys = new Set(Array.from({ length: 7 }, (_, i) => dateKeyAfterDays(-i)))
  const drillCount7 = drillDayKeys.filter((k) => recent7Keys.has(k)).reduce((sum, k) => sum + (workLog[k]?.drill ?? 0), 0)
  const principalLine =
    allCards.length === 0
      ? `${teacherCall}、よく来たね。だが研修はまだ早い。まずは教材を取り込んで、生徒に授業をしてきなさい。話はそれからだ。`
      : allPending > 0
      ? `${teacherCall}、よく来たね。「まだ」のカードが${allPending}枚残っておるぞ。逃げずに、一枚ずつ潰していきなさい。`
      : hasDoneUnits
      ? `${teacherCall}、よく来たね。教えた知識も、時間がたてばさびる。完了した授業のカードをめくって、みがき直しておきなさい。`
      : `${teacherCall}、よく来たね。教えるとは、二度学ぶことだ。カードをめくって、教えの引き出しを増やしなさい。`
  const drillActive = drillCards.length > 0

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>研修ルーム</Text>
        {drillActive && !drillDone && (
          <TouchableOpacity onPress={exitDrill}>
            <Text style={styles.headerQuit}>研修をやめる</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        {!drillActive ? (
          <>
            {/* 校長との1on1＝紺の「通信パネル」。挨拶役なので帯に格下げ（研修カードより弱く） */}
            <View style={styles.principalHero}>
              <TouchableOpacity onPress={() => setShowPrincipalAvatar(true)} activeOpacity={0.8} style={{ position: 'relative' }}>
                <Image source={PRINCIPAL_IMAGE_DARK} style={styles.principalHeroAvatar} />
                <View style={styles.callAvatarDot} />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <Text style={styles.principalHeroName}>校長先生</Text>
                  <View style={styles.connectedPill}>
                    <EqBars />
                    <Text style={styles.connectedText}>接続中</Text>
                  </View>
                </View>
                <Text style={styles.principalLine}>{principalLine}</Text>
              </View>
            </View>

            {/* 一問一答研修：研修ルームの中心機能。ヒーローカードにする */}
            <View style={styles.card}>
              <View style={styles.sectionHeroRow}>
                <View style={styles.sectionHeroIcon}>
                  <Feather name="award" size={20} color={c.blazer} />
                </View>
                <View style={styles.sectionTitleRow}>
                  <Text style={styles.sectionTitle}>一問一答研修</Text>
                  {allPending > 0 && (
                    <View style={styles.pendingBadge}>
                      <Text style={styles.pendingBadgeText}>まだ {allPending}枚</Text>
                    </View>
                  )}
                </View>
              </View>
              {/* 説明は2行まで（案内板化するとCTAが沈む） */}
              <Text style={styles.sectionDesc}>カードをめくって自分の言葉で答え、「覚えた／まだ」を付けます。「まだ」と、しばらく触れていないカードが優先して出ます。</Text>
              {allCards.length === 0 ? (
                <Text style={styles.emptyText}>教材を取り込むと、その内容からカードが用意されます</Text>
              ) : (
                <>
                  {/* 研修の記録：研修由来のデータだけを出す（授業の結果は映さない） */}
                  {lastDrillKey && (
                    <Text style={styles.drillRecordLine}>最終研修：{examDateLabel(lastDrillKey)} ・ この7日間 {drillCount7}回</Text>
                  )}
                  <TouchableOpacity
                    style={[styles.primaryBtn, { flexDirection: 'row', justifyContent: 'center', gap: 6 }]}
                    onPress={() => { setDrillMaterialId('all'); void startDrill('all') }}
                  >
                    <Feather name="layers" size={15} color="#fff" />
                    <Text style={styles.primaryBtnText}>
                      {materialsWithCards.length >= 2 ? '全教材ミックスで始める' : '研修を始める'}
                    </Text>
                  </TouchableOpacity>
                  {/* 問数はボタンの外に（小さい端末での文字あふれ対策） */}
                  <Text style={styles.drillLimitNote}>1回の研修は最大{DRILL_SESSION_SIZE}問</Text>
                  {/* 教材ごとの入口：同じ道具の入口なので別カードにせず研修カード内に収める（画面の断片化を防ぐ）。
                      行タップで即研修（ピッカーはこのリストで置き換え、選択UIの二重化を避ける） */}
                  {materialsWithCards.length >= 2 && (
                    <View style={styles.matListSection}>
                      <Text style={styles.matListLabel}>教材ごとに始める</Text>
                      {materialsWithCards.map((h, i) => {
                        const pending = pendingCountOf(h.factsheet?.cards ?? [])
                        return (
                          <TouchableOpacity key={h.id} style={[styles.matRow, i > 0 && styles.matRowBorder]}
                            onPress={() => { setDrillMaterialId(h.id); void startDrill(h.id) }}>
                            <Feather name="layers" size={16} color={c.blazer} />
                            <Text style={[styles.matRowTitle, { flex: 1 }]} numberOfLines={1}>{h.title.replace(TITLE_RE, '')}</Text>
                            {pending > 0 && <Text style={styles.matRowPending}>まだ{pending}</Text>}
                            <Text style={styles.matRowChevron}>›</Text>
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                  )}
                </>
              )}
            </View>
          </>
        ) : drillDone ? (
          <>
            <View style={[styles.card, { alignItems: 'center' }]}>
              <Text style={styles.doneTitle}>{drillOkCount === drillCards.length ? '全部覚えた！' : 'おつかれさまでした'}</Text>
              <Text style={styles.doneScore}>{drillOkCount} / {drillCards.length} 枚覚えた</Text>
              <View style={styles.heroRow}>
                <Image source={PRINCIPAL_IMAGE} style={styles.principalAvatarSmall} />
                <Text style={styles.principalComment}>
                  {drillOkCount === drillCards.length ? '見事だ。その調子で続けなさい。' : '「まだ」のカードは次回わたしが優先して出す。一枚ずつ潰していきなさい。'}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={[styles.primaryBtn, { flex: 1 }]} onPress={() => void startDrill(drillMaterialId)}>
                <Text style={styles.primaryBtnText}>もう一回</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={exitDrill}>
                <Text style={styles.secondaryBtnText}>終わる</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            {/* どの教材の研修かをフルタイトルで明示（一覧では見切れるため） */}
            <View>
              <Text style={styles.drillMaterialTitle}>{drillMaterialId === 'all' ? '全教材ミックス' : (history.find((h) => h.id === drillMaterialId)?.title.replace(TITLE_RE, '') ?? '')}</Text>
              <Text style={[styles.drillProgress, { marginTop: 2 }]}>カード {drillIdx + 1} / {drillCards.length}</Text>
            </View>
            <View style={styles.drillCard}>
              <Text style={styles.drillLabelQ}>Q</Text>
              <Text style={styles.drillQuestion}>{drillCards[drillIdx]?.q}</Text>
              {drillRevealed && (
                <>
                  <Text style={styles.drillLabelA}>A</Text>
                  <Text style={styles.drillAnswer}>{drillCards[drillIdx]?.a}</Text>
                </>
              )}
            </View>
            {!drillRevealed ? (
              <TouchableOpacity style={styles.revealBtn} onPress={() => setDrillRevealed(true)}>
                <Text style={styles.primaryBtnText}>答えを見る</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity style={[styles.markBtn, styles.markBtnRow, { backgroundColor: '#10b981' }]} onPress={() => void markDrill(true)}>
                  <Feather name="check" size={16} color="#fff" />
                  <Text style={styles.primaryBtnText}>覚えた</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.markBtn, styles.markBtnRow, { backgroundColor: '#fb7185' }]} onPress={() => void markDrill(false)}>
                  <Feather name="rotate-ccw" size={16} color="#fff" />
                  <Text style={styles.primaryBtnText}>まだ</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <BottomTabBar active="training" />

      {/* 校長先生の拡大表示（顔のアップ） */}
      <Modal visible={showPrincipalAvatar} transparent animationType="fade" onRequestClose={() => setShowPrincipalAvatar(false)}>
        <Pressable style={styles.zoomOverlay} onPress={() => setShowPrincipalAvatar(false)}>
          <View style={styles.zoomCircle}>
            <Image source={PRINCIPAL_IMAGE_DARK} style={styles.zoomImage} />
          </View>
        </Pressable>
      </Modal>

    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  // ヘッダーは教材タブ・研修タブで同一スタイル（library.tsx / training.tsx で揃えること）
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: 'white',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
  },
  headerTitle: { fontSize: 16, fontFamily: font.round, color: c.textStrong },
  headerQuit: { fontSize: 12, fontWeight: '700', color: c.faint },
  content: { padding: 16, gap: 14, paddingBottom: 32 },

  card: { backgroundColor: 'white', borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 16 },
  heroRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  principalAvatarSmall: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: '#fde68a' },
  // 1on1のチャット風バー（カードの器に入れず、部屋に浮かぶメッセージとして表示）
  // 校長ヒーロー＝紺の「通信パネル」（通信室・先生証と同族の儀式面。接続中の1on1通信なのでダークが許される。
  // 黒モニターほど硬くせず、紺＋金縁＋発光する緑で「いかした」側に寄せる）
  principalHero: {
    backgroundColor: c.ink, borderRadius: 16, borderWidth: 1, borderColor: '#1b2b42',
    paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10,
  },
  principalHeroAvatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: '#fcd34d' },
  principalHeroName: { fontSize: 12, fontWeight: '900', color: '#f1f5f9' },
  // 研修カードのヒーロー見出し（アイコン＋タイトル）
  sectionHeroRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  sectionHeroIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: c.bgSub, alignItems: 'center', justifyContent: 'center' },
  callAvatarDot: {
    position: 'absolute', bottom: 0, right: 0,
    width: 11, height: 11, borderRadius: 6,
    backgroundColor: '#34d399', borderWidth: 2, borderColor: c.ink,
  },
  connectedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(52,211,153,0.12)', borderWidth: 1, borderColor: 'rgba(52,211,153,0.4)',
    borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1,
  },
  connectedText: { fontSize: 8, fontWeight: '700', color: '#6ee7b7' },
  principalLine: { fontSize: 13, color: '#cbd5e1', lineHeight: 20 },
  principalComment: { flex: 1, fontSize: 13, color: c.textMid, lineHeight: 19, backgroundColor: c.bgSub, borderRadius: 12, padding: 10 },

  sectionTitle: { fontSize: 14, fontWeight: '900', color: c.text, marginBottom: 4 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // 「まだ」バッジはピンク系（まだ＝研修のあなたの判断＝ピンクの語彙で統一）
  pendingBadge: { backgroundColor: '#fce7f3', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginBottom: 4 },
  pendingBadgeText: { fontSize: 10, fontWeight: '700', color: '#be185d' },
  sectionDesc: { fontSize: 12, color: c.textSub, lineHeight: 18, marginBottom: 12 },
  bold: { fontWeight: '700', color: c.textMid },
  emptyText: { fontSize: 12, color: c.textSub, lineHeight: 18 },

  // 研修の記録行（研修由来のデータだけ）
  drillRecordLine: { fontSize: 11, color: c.textSub, marginBottom: 10 },

  drillLimitNote: { fontSize: 10, color: c.textSub, textAlign: 'center', marginTop: 6 },

  // 教材ごとの入口（研修カード内の下段。行タップで即研修）
  matListSection: { marginTop: 14, borderTopWidth: 1, borderTopColor: c.bgSub, paddingTop: 10 },
  matListLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: c.faint, paddingBottom: 2 },
  matRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  matRowBorder: { borderTopWidth: 1, borderTopColor: c.bgSub },
  matRowTitle: { fontSize: 13, fontWeight: '600', color: c.textMid },
  matRowPending: { fontSize: 11, fontWeight: '700', color: c.primaryStrong },
  matRowChevron: { fontSize: 15, color: c.faint },

  // 研修中の教材表示（フルタイトル）
  drillMaterialTitle: { fontSize: 12, fontWeight: '700', color: c.textMid },

  primaryBtn: { backgroundColor: c.primaryStrong, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  primaryBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  secondaryBtn: { flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 12, paddingVertical: 12, alignItems: 'center', backgroundColor: '#fff' },
  secondaryBtnText: { fontSize: 13, fontWeight: '700', color: c.textMid },

  drillProgress: { fontSize: 11, fontWeight: '700', color: c.faint },
  drillCard: { backgroundColor: c.paper, borderRadius: 16, borderWidth: 1, borderColor: c.paperBorder, padding: 20, minHeight: 160, justifyContent: 'center' },
  drillLabelQ: { fontSize: 10, fontWeight: '700', color: '#b45309', letterSpacing: 2, marginBottom: 6 },
  drillLabelA: { fontSize: 10, fontWeight: '700', color: '#059669', letterSpacing: 2, marginTop: 14, marginBottom: 6 },
  drillQuestion: { fontSize: 16, fontWeight: '700', color: c.text, lineHeight: 24 },
  drillAnswer: { fontSize: 14, color: c.textMid, lineHeight: 21 },
  revealBtn: { backgroundColor: c.text, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  markBtn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  markBtnRow: { flexDirection: 'row', justifyContent: 'center', gap: 6 },

  doneTitle: { fontSize: 20, fontWeight: '900', color: c.text, marginBottom: 4 },
  doneScore: { fontSize: 13, color: c.textMid, marginBottom: 14 },

  zoomOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  zoomCircle: { width: 220, height: 220, borderRadius: 110, overflow: 'hidden', borderWidth: 4, borderColor: '#fcd34d', backgroundColor: '#fff' },
  // 新しい校長画像は正方形なので、旧構図用の縦長クロップ（歪む）をやめて全体をcover表示にする
  zoomImage: { width: '100%', height: '100%' },

})
