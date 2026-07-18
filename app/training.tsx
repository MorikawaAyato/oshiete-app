import {
  View, Text, TouchableOpacity, ScrollView, Image, StyleSheet,
  Modal, TextInput, KeyboardAvoidingView, Platform, Pressable, Animated,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { useApp } from '@/lib/AppContext'
import { loadHistory, loadDrillPending, saveDrillPending, loadCardProgress, splitUnits, getUnitStatuses, logWork } from '@/lib/storage'
import type { HistoryItem, QACard } from '@/lib/types'
import { BottomTabBar } from '@/components/BottomTabBar'
import { c, font } from '@/lib/theme'
import { Feather } from '@expo/vector-icons'

const PRINCIPAL_IMAGE = require('../assets/tora_koutyou.webp')
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
          if (splitUnits(cards.length).some((_, i) => statuses[i] === 'done')) { done = true; break }
        }
        setHasDoneUnits(done)
      })
      void loadDrillPending().then(setDrillPendingKeys)
    }, [])
  )

  // フラッシュカードの進行状態
  const [drillMaterialId, setDrillMaterialId] = useState<string>('all')
  const [drillPickerOpen, setDrillPickerOpen] = useState(false) // 教材選択シート
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
      splitUnits(cards.length).forEach((u, i) => {
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
            {/* 校長との1on1：研修ルームの主役。あたたかい応接ふうのカードで大きく見せる */}
            <View style={styles.principalHero}>
              <View style={styles.principalHeroHead}>
                <TouchableOpacity onPress={() => setShowPrincipalAvatar(true)} activeOpacity={0.8} style={{ position: 'relative' }}>
                  <Image source={PRINCIPAL_IMAGE} style={styles.principalHeroAvatar} />
                  <View style={styles.callAvatarDot} />
                </TouchableOpacity>
                <View>
                  <Text style={styles.principalHeroName}>校長先生</Text>
                  <View style={styles.connectedPill}>
                    <EqBars />
                    <Text style={styles.connectedText}>接続中</Text>
                  </View>
                </View>
              </View>
              <View style={styles.principalHeroBubble}>
                <Text style={styles.principalLine}>{principalLine}</Text>
              </View>
            </View>

            {/* 一問一答研修：研修ルームの中心機能。ヒーローカードにする */}
            <View style={styles.card}>
              <View style={styles.sectionHeroRow}>
                <View style={styles.sectionHeroIcon}>
                  <Feather name="award" size={20} color="#d97706" />
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
              <Text style={styles.sectionDesc}>授業前の準備にも、終えた授業の忘れ防止にも。カードをめくって自分の言葉で答え、「覚えた／まだ」を付けていきます。「まだ」のカードと、完了した授業のしばらく触れていないカードが優先して出ます。</Text>
              {allCards.length === 0 ? (
                <Text style={styles.emptyText}>教材を取り込むと、その内容からカードが用意されます</Text>
              ) : (
                <>
                  {/* 研修する教材の選択：プルダウン（教材が増えても場所を取らず、スマホでも操作しやすい） */}
                  {(() => {
                    const selectedMaterial = drillMaterialId === 'all' ? null : materialsWithCards.find((h) => h.id === drillMaterialId) ?? null
                    const selectedLabel = selectedMaterial ? selectedMaterial.title.replace(TITLE_RE, '') : '全部ミックス'
                    const selectedCount = selectedMaterial ? (selectedMaterial.factsheet?.cards?.length ?? 0) : allCards.length
                    const selectedPending = selectedMaterial ? pendingCountOf(selectedMaterial.factsheet?.cards ?? []) : allPending
                    return (
                      <TouchableOpacity style={styles.pickerBtn} onPress={() => setDrillPickerOpen(true)}>
                        <Text style={styles.pickerLabel}>教材</Text>
                        <Text style={styles.pickerValue} numberOfLines={1}>{selectedLabel}</Text>
                        <Text style={styles.pickerCount}>{selectedCount}枚</Text>
                        {selectedPending > 0 && (
                          <View style={styles.chipBadge}>
                            <Text style={styles.chipBadgeText}>まだ{selectedPending}</Text>
                          </View>
                        )}
                        <Text style={styles.pickerCaret}>▾</Text>
                      </TouchableOpacity>
                    )
                  })()}
                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={() => void startDrill(drillMaterialId === 'all' || materialsWithCards.some((h) => h.id === drillMaterialId) ? drillMaterialId : 'all')}
                  >
                    <Text style={styles.primaryBtnText}>研修を始める（最大{DRILL_SESSION_SIZE}問）</Text>
                  </TouchableOpacity>
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
            <Text style={styles.drillProgress}>カード {drillIdx + 1} / {drillCards.length}</Text>
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
            <Image source={PRINCIPAL_IMAGE} style={styles.zoomImage} />
          </View>
        </Pressable>
      </Modal>

      {/* 研修する教材の選択シート */}
      <Modal visible={drillPickerOpen} transparent animationType="slide" onRequestClose={() => setDrillPickerOpen(false)}>
        <View style={styles.sheetContainer}>
          <Pressable style={styles.sheetOverlay} onPress={() => setDrillPickerOpen(false)} />
          <View style={styles.sheetBottom}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>研修する教材</Text>
              <TouchableOpacity onPress={() => setDrillPickerOpen(false)}>
                <Text style={styles.sheetClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              <TouchableOpacity style={styles.pickerRow} onPress={() => { setDrillMaterialId('all'); setDrillPickerOpen(false) }}>
                <Text style={[styles.pickerRowText, drillMaterialId === 'all' && styles.pickerRowTextSel]} numberOfLines={1}>
                  全部ミックス
                </Text>
                <Text style={styles.pickerCount}>{allCards.length}枚</Text>
                {allPending > 0 && (
                  <View style={styles.chipBadge}>
                    <Text style={styles.chipBadgeText}>まだ{allPending}</Text>
                  </View>
                )}
                {drillMaterialId === 'all' && <Text style={styles.pickerCheck}>✓</Text>}
              </TouchableOpacity>
              {materialsWithCards.map((h) => {
                const pending = pendingCountOf(h.factsheet?.cards ?? [])
                const sel = drillMaterialId === h.id
                return (
                  <TouchableOpacity key={h.id} style={styles.pickerRow} onPress={() => { setDrillMaterialId(h.id); setDrillPickerOpen(false) }}>
                    <Text style={[styles.pickerRowText, sel && styles.pickerRowTextSel]} numberOfLines={1}>
                      {h.title.replace(TITLE_RE, '')}
                    </Text>
                    <Text style={styles.pickerCount}>{h.factsheet?.cards?.length ?? 0}枚</Text>
                    {pending > 0 && (
                      <View style={styles.chipBadge}>
                        <Text style={styles.chipBadgeText}>まだ{pending}</Text>
                      </View>
                    )}
                    {sel && <Text style={styles.pickerCheck}>✓</Text>}
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
          </View>
        </View>
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
  principalAvatar: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: '#fde68a' },
  principalAvatarSmall: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: '#fde68a' },
  // 1on1のチャット風バー（カードの器に入れず、部屋に浮かぶメッセージとして表示）
  // 校長ヒーロー（研修ルームの主役。面は銀ルールで白、校長の識別は金縁アバターなど小アクセントが担う）
  principalHero: { backgroundColor: 'white', borderRadius: 24, borderWidth: 1, borderColor: c.border, padding: 20 },
  principalHeroHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  principalHeroAvatar: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: 'white' },
  principalHeroName: { fontSize: 14, fontWeight: '900', color: c.text, marginBottom: 2 },
  principalHeroBubble: {
    alignSelf: 'flex-start', backgroundColor: c.bgSub, borderWidth: 1, borderColor: c.border,
    borderRadius: 16, borderTopLeftRadius: 4, paddingHorizontal: 16, paddingVertical: 12,
  },
  // 研修カードのヒーロー見出し（アイコン＋タイトル）
  sectionHeroRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  sectionHeroIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: '#fef3c7', alignItems: 'center', justifyContent: 'center' },
  callBar: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 4 },
  callAvatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: c.border },
  callAvatarDot: {
    position: 'absolute', bottom: 0, right: 0,
    width: 11, height: 11, borderRadius: 6,
    backgroundColor: '#34d399', borderWidth: 2, borderColor: 'white',
  },
  callNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  callName: { fontSize: 11, fontWeight: '700', color: c.textMid },
  connectedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#a7f3d0',
    borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1,
  },
  connectedText: { fontSize: 8, fontWeight: '700', color: '#047857' },
  principalBubble: {
    marginTop: 10, alignSelf: 'flex-start',
    backgroundColor: 'white', borderWidth: 1, borderColor: c.border,
    borderRadius: 16, borderTopLeftRadius: 4,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  principalBubbleFull: { marginTop: 0, alignSelf: 'stretch' },
  principalLine: { fontSize: 13, color: c.textMid, lineHeight: 20 },
  principalComment: { flex: 1, fontSize: 13, color: c.textMid, lineHeight: 19, backgroundColor: c.bgSub, borderRadius: 12, padding: 10 },

  sectionTitle: { fontSize: 14, fontWeight: '900', color: c.text, marginBottom: 4 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // 「ふだんの練習」/「大一番」のアイブロウと、研修→試験の接続テキスト
  eyebrowLight: { fontSize: 10, fontWeight: '700', letterSpacing: 2, color: '#d97706', marginBottom: 2 },
  eyebrowDark: { fontSize: 10, fontWeight: '700', letterSpacing: 2, color: '#fcd34d', marginBottom: 2 },
  // 昇進試験カード（証書ふうのダーク）
  examCard: { backgroundColor: '#1e293b', borderRadius: 16, borderWidth: 1, borderColor: '#334155', padding: 16 },
  examTitle: { fontSize: 14, fontWeight: '900', color: 'white', marginBottom: 4 },
  examDesc: { fontSize: 12, color: '#cbd5e1', lineHeight: 18, marginBottom: 12 },
  stakeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12,
  },
  stakeLabel: { fontSize: 11, color: '#94a3b8' },
  stakeCurrent: { fontSize: 12, fontWeight: '700', color: 'white', flexShrink: 1 },
  stakeArrow: { fontSize: 12, color: '#64748b' },
  stakeNext: { fontSize: 12, fontWeight: '900', letterSpacing: 3, color: '#fcd34d' },
  examGoldBtn: { backgroundColor: '#fbbf24', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  examGoldBtnText: { fontSize: 13, fontWeight: '900', color: '#1e293b' },
  examLockedText: { fontSize: 12, color: '#94a3b8', lineHeight: 18 },
  pendingBadge: { backgroundColor: '#fef3c7', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginBottom: 4 },
  pendingBadgeText: { fontSize: 10, fontWeight: '700', color: '#b45309' },
  sectionDesc: { fontSize: 12, color: c.textSub, lineHeight: 18, marginBottom: 12 },
  bold: { fontWeight: '700', color: c.textMid },
  emptyText: { fontSize: 12, color: c.textSub, lineHeight: 18 },

  // 教材選択プルダウン
  pickerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: c.border, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, backgroundColor: 'white',
  },
  pickerLabel: { fontSize: 10, fontWeight: '700', color: c.textSub },
  pickerValue: { flex: 1, fontSize: 13, fontWeight: '600', color: c.textMid },
  pickerCaret: { fontSize: 11, color: c.faint },
  pickerCount: { fontSize: 10, color: c.textSub, flexShrink: 0 },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 18, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: c.bgSub,
  },
  pickerRowText: { flex: 1, fontSize: 13, color: c.textMid },
  pickerRowTextSel: { fontWeight: '700', color: c.primaryStrong },
  pickerCheck: { fontSize: 13, fontWeight: '700', color: c.primaryStrong },
  chipBadge: { backgroundColor: '#fef3c7', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  chipBadgeText: { fontSize: 10, fontWeight: '700', color: '#b45309' },

  primaryBtn: { backgroundColor: c.primaryStrong, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  primaryBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  secondaryBtn: { flex: 1, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 12, paddingVertical: 12, alignItems: 'center', backgroundColor: '#fff' },
  secondaryBtnText: { fontSize: 13, fontWeight: '700', color: c.textMid },

  drillProgress: { fontSize: 11, fontWeight: '700', color: c.faint },
  drillCard: { backgroundColor: 'white', borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 20, minHeight: 160, justifyContent: 'center' },
  drillLabelQ: { fontSize: 10, fontWeight: '700', color: '#b45309', letterSpacing: 2, marginBottom: 6 },
  drillLabelA: { fontSize: 10, fontWeight: '700', color: '#059669', letterSpacing: 2, marginTop: 14, marginBottom: 6 },
  drillQuestion: { fontSize: 16, fontWeight: '700', color: c.text, lineHeight: 24 },
  drillAnswer: { fontSize: 14, color: c.textMid, lineHeight: 21 },
  revealBtn: { backgroundColor: c.text, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  markBtn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  markBtnRow: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  markO: { color: '#10b981', fontWeight: '700' },
  markX: { color: '#f43f5e', fontWeight: '700' },

  doneTitle: { fontSize: 20, fontWeight: '900', color: c.text, marginBottom: 4 },
  doneScore: { fontSize: 13, color: c.textMid, marginBottom: 14 },

  zoomOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  zoomCircle: { width: 220, height: 220, borderRadius: 110, overflow: 'hidden', borderWidth: 4, borderColor: '#fde68a', backgroundColor: '#fff' },
  zoomImage: { position: 'absolute', top: 0, width: 220, height: 290 },

  sheetContainer: { flex: 1, justifyContent: 'flex-end' },
  sheetOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheetBottom: { backgroundColor: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%', paddingBottom: 28 },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
  },
  sheetTitle: { fontSize: 15, fontWeight: '900', color: c.text },
  sheetClose: { fontSize: 18, color: c.faint },

  examSpeech: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: c.bgSub, borderRadius: 14, padding: 12, marginBottom: 14 },
  examSpeechText: { flex: 1, fontSize: 13, color: c.textMid, lineHeight: 19 },
  examProgress: { fontSize: 11, fontWeight: '700', color: c.faint, marginBottom: 4 },
  examQuestion: { fontSize: 14, fontWeight: '700', color: c.text, lineHeight: 21, marginBottom: 10 },
  examInput: { borderWidth: 1, borderColor: c.borderStrong, borderRadius: 12, padding: 12, fontSize: 14, color: c.text, minHeight: 80, textAlignVertical: 'top' },
  examNavBtn: { borderWidth: 1, borderColor: c.borderStrong, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#fff' },
  examNavBtnText: { fontSize: 12, fontWeight: '700', color: c.textMid },
  examNextBtn: { flex: 1, backgroundColor: '#d97706', borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  examErrorText: { fontSize: 11, color: c.dangerText, marginTop: 8 },
  examMsgText: { fontSize: 13, fontWeight: '700', color: c.textMid },
  examVerdict: { fontSize: 22, fontWeight: '900', color: c.text, textAlign: 'center', marginBottom: 4 },
  examScore: { fontSize: 13, color: c.textMid, textAlign: 'center', marginBottom: 14, lineHeight: 19 },
  examResultCard: { borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, marginBottom: 10 },
  examResultQ: { fontSize: 12, fontWeight: '700', color: c.text, marginBottom: 4, lineHeight: 18 },
  examResultA: { fontSize: 12, color: c.textSub, lineHeight: 18 },
  examResultModel: { fontSize: 12, color: c.dangerText, marginTop: 3, lineHeight: 18 },
  examResultComment: { fontSize: 12, color: '#b45309', marginTop: 3, lineHeight: 18 },
  examCloseBtn: { backgroundColor: c.text, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 8, marginBottom: 12 },
})
