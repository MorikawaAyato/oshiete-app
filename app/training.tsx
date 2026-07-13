import {
  View, Text, TouchableOpacity, ScrollView, Image, StyleSheet,
  Modal, TextInput, KeyboardAvoidingView, Platform, Pressable, Animated,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { useApp } from '@/lib/AppContext'
import { TEACHER_TITLES, getUnlockedTitleCount } from '@/lib/teacherProfile'
import { loadHistory, loadDrillPending, saveDrillPending } from '@/lib/storage'
import { gradeExam } from '@/lib/api'
import type { HistoryItem, QACard } from '@/lib/types'
import { BottomTabBar } from '@/components/BottomTabBar'
import { c, font } from '@/lib/theme'
import { Feather } from '@expo/vector-icons'

const PRINCIPAL_IMAGE = require('../assets/tora_koutyou.webp')
const TITLE_RE = /^この(教材|文書|画像|写真)は[、，]?\s*/u

// 昇進試験（ウェブ側と同じ条件）
const EXAM_QUESTION_COUNT = 5
const EXAM_PASS_COUNT = 4

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

  useFocusEffect(
    useCallback(() => {
      loadHistory().then(setHistory)
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

  const startDrill = async (materialId: string) => {
    const pool = drillPool(materialId)
    if (pool.length === 0) return
    const pending = await loadDrillPending()
    const pendingCards = shuffleCards(pool.filter((cd) => pending.has(drillKey(cd))))
    const restCards = shuffleCards(pool.filter((cd) => !pending.has(drillKey(cd))))
    setDrillCards([...pendingCards, ...restCards].slice(0, DRILL_SESSION_SIZE))
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

  // 昇進試験の進行状態（採点時に別解を判定できるよう、各カードに出典教材の事実リストを添える）
  const examCardPool = () =>
    history.flatMap((h) => (h.factsheet?.cards ?? []).map((card) => ({ ...card, facts: h.factsheet?.facts ?? [] })))

  const [examOpen, setExamOpen] = useState(false)
  const [examQuestions, setExamQuestions] = useState<(QACard & { facts: string[] })[]>([])
  const [examStep, setExamStep] = useState(0)
  const [examAnswers, setExamAnswers] = useState<string[]>([])
  const [examGrading, setExamGrading] = useState(false)
  const [examResults, setExamResults] = useState<{ correct: boolean; comment: string }[] | null>(null)
  const [examError, setExamError] = useState<string | null>(null)
  const [showPrincipalAvatar, setShowPrincipalAvatar] = useState(false)

  const startExam = () => {
    const pool = examCardPool()
    if (pool.length < EXAM_QUESTION_COUNT) return
    const shuffled = shuffleCards(pool)
    setExamQuestions(shuffled.slice(0, EXAM_QUESTION_COUNT))
    setExamAnswers(Array(EXAM_QUESTION_COUNT).fill(''))
    setExamStep(0)
    setExamResults(null)
    setExamError(null)
    setExamOpen(true)
  }

  const submitExam = async () => {
    setExamGrading(true)
    setExamError(null)
    try {
      const res = await gradeExam(examQuestions.map((cd, i) => ({ q: cd.q, a: cd.a, statement: cd.statement, facts: cd.facts, userAnswer: (examAnswers[i] ?? '').trim() })))
      if (!res.results) throw new Error(res.error)
      setExamResults(res.results)
      if (res.results.filter((r) => r.correct).length >= EXAM_PASS_COUNT) {
        const unlockedCount = getUnlockedTitleCount(teacherProfile)
        const nextTitle = TEACHER_TITLES[unlockedCount]
        if (nextTitle) setTeacherProfile({ ...teacherProfile, title: nextTitle, unlockedTitleCount: unlockedCount + 1 })
      }
    } catch {
      setExamError('採点に失敗しました。通信環境を確認してもう一度お試しください。')
    } finally {
      setExamGrading(false)
    }
  }

  const nextTitle = TEACHER_TITLES[getUnlockedTitleCount(teacherProfile)]
  const allCards = history.flatMap((h) => h.factsheet?.cards ?? [])
  const materialsWithCards = history.filter((h) => (h.factsheet?.cards?.length ?? 0) > 0)
  const canExam = !!nextTitle && allCards.length >= EXAM_QUESTION_COUNT
  const teacherCall = teacherProfile.name ? `${teacherProfile.name}先生` : '先生'
  // 「まだ」のカード残数（全体・教材ごと）。研修に戻ってくる理由を可視化する
  const pendingCountOf = (cards: QACard[]) => cards.filter((cd) => drillPendingKeys.has(drillKey(cd))).length
  const allPending = pendingCountOf(allCards)
  const principalLine =
    allCards.length === 0
      ? `${teacherCall}、よく来たね。だが研修はまだ早い。まずは教材を取り込んで、生徒に授業をしてきなさい。話はそれからだ。`
      : allPending > 0
      ? `${teacherCall}、よく来たね。「まだ」のカードが${allPending}枚残っておるぞ。逃げずに、一枚ずつ潰していきなさい。`
      : canExam
      ? `${teacherCall}、よく来たね。研修は嘘をつかん。研修で鍛えたら、次の昇進試験に挑みなさい。待っておるぞ。`
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
            {/* 校長との1on1：機能カードと同列に見えないよう、カードの器には入れず
                「部屋に浮かぶチャットメッセージ」として表示する */}
            <View style={styles.callBar}>
              <TouchableOpacity onPress={() => setShowPrincipalAvatar(true)} activeOpacity={0.8} style={{ position: 'relative' }}>
                <Image source={PRINCIPAL_IMAGE} style={styles.callAvatar} />
                <View style={styles.callAvatarDot} />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <View style={styles.callNameRow}>
                  <Text style={styles.callName}>校長先生</Text>
                  <View style={styles.connectedPill}>
                    <EqBars />
                    <Text style={styles.connectedText}>接続中</Text>
                  </View>
                </View>
                <View style={[styles.principalBubble, styles.principalBubbleFull]}>
                  <Text style={styles.principalLine}>{principalLine}</Text>
                </View>
              </View>
            </View>

            {/* 一問一答研修：ふだんの練習（軽い側） */}
            <View style={styles.card}>
              <Text style={styles.eyebrowLight}>ふだんの練習</Text>
              <View style={styles.sectionTitleRow}>
                <Text style={styles.sectionTitle}>一問一答研修</Text>
                {allPending > 0 && (
                  <View style={styles.pendingBadge}>
                    <Text style={styles.pendingBadgeText}>まだ {allPending}枚</Text>
                  </View>
                )}
              </View>
              <Text style={styles.sectionDesc}>何度でも・自己採点・3分から。カードをめくって自分の言葉で答え、「おぼえた／まだ」をつけていきます。「まだ」のカードは次回優先で出ます。</Text>
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
                    <Text style={styles.primaryBtnText}>研修をはじめる（最大{DRILL_SESSION_SIZE}問）</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            {/* 昇進試験：大一番（重い側）。証書ふうのダークカードで研修と格を分ける。
                研修→試験の順序は校長のセリフとアイブロウが語るので、接続テキストは置かない */}
            <View style={styles.examCard}>
              <Text style={styles.eyebrowDark}>大一番</Text>
              <Text style={styles.examTitle}>昇進試験</Text>
              {nextTitle ? (
                <>
                  <Text style={styles.examDesc}>
                    全教材から校長先生が{EXAM_QUESTION_COUNT}問出題。{EXAM_PASS_COUNT}問正解で合格・昇進です。
                  </Text>
                  {/* 賭け金：何が懸かっているかを常設（次の称号名は伏せたまま） */}
                  <View style={styles.stakeRow}>
                    <Text style={styles.stakeLabel}>現在の称号</Text>
                    <Text style={styles.stakeCurrent} numberOfLines={1}>{teacherProfile.title}</Text>
                    <Text style={styles.stakeArrow}>→</Text>
                    <Text style={styles.stakeNext}>？？？</Text>
                  </View>
                  {canExam ? (
                    <TouchableOpacity style={styles.examGoldBtn} onPress={startExam}>
                      <Text style={styles.examGoldBtnText}>校長先生の試験を受ける</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.examLockedText}>教材を取り込んで授業をすると受験できます（カード{EXAM_QUESTION_COUNT}枚以上）</Text>
                  )}
                </>
              ) : (
                <Text style={styles.examDesc}>「{teacherProfile.title}」は最高位です。これからも生徒たちをよろしく頼むよ。</Text>
              )}
            </View>
          </>
        ) : drillDone ? (
          <>
            <View style={[styles.card, { alignItems: 'center' }]}>
              <Text style={styles.doneTitle}>{drillOkCount === drillCards.length ? '全部おぼえた！' : 'おつかれさま！'}</Text>
              <Text style={styles.doneScore}>{drillOkCount} / {drillCards.length} 枚おぼえた</Text>
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
                <Text style={styles.secondaryBtnText}>おわる</Text>
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
                  <Text style={styles.primaryBtnText}>おぼえた</Text>
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

      {/* 昇進試験（校長室） */}
      <Modal visible={examOpen} transparent animationType="slide" onRequestClose={() => setExamOpen(false)}>
        <KeyboardAvoidingView style={styles.sheetContainer} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.sheetOverlay} onPress={() => { if (!examGrading) setExamOpen(false) }} />
          <View style={styles.sheetBottom}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>昇進試験</Text>
              <TouchableOpacity onPress={() => setExamOpen(false)}>
                <Text style={styles.sheetClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              {examGrading ? (
                <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                  <Image source={PRINCIPAL_IMAGE} style={[styles.principalAvatar, { marginBottom: 10 }]} />
                  <Text style={styles.examMsgText}>校長先生が採点しています...</Text>
                </View>
              ) : examResults ? (
                <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
                  {(() => {
                    const correctCount = examResults.filter((r) => r.correct).length
                    const passed = correctCount >= EXAM_PASS_COUNT
                    return (
                      <>
                        <Text style={styles.examVerdict}>{passed ? '合格！' : 'もう一歩...！'}</Text>
                        <Text style={styles.examScore}>
                          {correctCount} / {examResults.length} 問正解
                          {passed ? ` — 「${teacherProfile.title}」に昇進しました！` : `（合格は${EXAM_PASS_COUNT}問）。また挑戦してくださいね。`}
                        </Text>
                        {examResults.map((r, i) => (
                          <View key={i} style={styles.examResultCard}>
                            <Text style={styles.examResultQ}>{r.correct ? <Text style={styles.markO}>○</Text> : <Text style={styles.markX}>✕</Text>} 問{i + 1}: {examQuestions[i]?.q}</Text>
                            <Text style={styles.examResultA}>あなたの答え: {(examAnswers[i] ?? '').trim() || '（空欄）'}</Text>
                            {!r.correct && <Text style={styles.examResultModel}>模範解答: {examQuestions[i]?.a}</Text>}
                            {!!r.comment && <Text style={styles.examResultComment}>{r.comment}</Text>}
                          </View>
                        ))}
                        <TouchableOpacity style={styles.examCloseBtn} onPress={() => setExamOpen(false)}>
                          <Text style={styles.primaryBtnText}>校長室を出る</Text>
                        </TouchableOpacity>
                      </>
                    )
                  })()}
                </View>
              ) : examQuestions.length > 0 ? (
                <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
                  <View style={styles.examSpeech}>
                    <Image source={PRINCIPAL_IMAGE} style={styles.principalAvatarSmall} />
                    <Text style={styles.examSpeechText}>
                      {examStep === 0
                        ? `それでは始めよう。全${examQuestions.length}問、${EXAM_PASS_COUNT}問正解で次の称号に昇進だ。自分の言葉で答えなさい。`
                        : 'つぎの問題だ。'}
                    </Text>
                  </View>
                  <Text style={styles.examProgress}>問 {examStep + 1} / {examQuestions.length}</Text>
                  <Text style={styles.examQuestion}>{examQuestions[examStep]?.q}</Text>
                  <TextInput
                    style={styles.examInput}
                    value={examAnswers[examStep] ?? ''}
                    onChangeText={(t) => setExamAnswers((prev) => prev.map((a, i) => (i === examStep ? t : a)))}
                    placeholder="自分の言葉で答えてみよう"
                    placeholderTextColor={c.faint}
                    multiline
                    maxLength={300}
                  />
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                    {examStep > 0 && (
                      <TouchableOpacity style={styles.examNavBtn} onPress={() => setExamStep((s) => s - 1)}>
                        <Text style={styles.examNavBtnText}>← 前の問題</Text>
                      </TouchableOpacity>
                    )}
                    {examStep < examQuestions.length - 1 ? (
                      <TouchableOpacity style={styles.examNextBtn} onPress={() => setExamStep((s) => s + 1)}>
                        <Text style={styles.primaryBtnText}>次の問題 →</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity style={[styles.examNextBtn, styles.markBtnRow]} onPress={() => void submitExam()}>
                        <Feather name="send" size={14} color="#fff" />
                        <Text style={styles.primaryBtnText}>答案を提出する</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {!!examError && <Text style={styles.examErrorText}>{examError}</Text>}
                </View>
              ) : null}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
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
  connectedText: { fontSize: 8, fontWeight: '700', color: '#059669' },
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
  emptyText: { fontSize: 12, color: c.faint, lineHeight: 18 },

  // 教材選択プルダウン
  pickerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: c.border, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, backgroundColor: 'white',
  },
  pickerLabel: { fontSize: 10, fontWeight: '700', color: c.faint },
  pickerValue: { flex: 1, fontSize: 13, fontWeight: '600', color: c.textMid },
  pickerCaret: { fontSize: 11, color: c.faint },
  pickerCount: { fontSize: 10, color: c.faint, flexShrink: 0 },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 18, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: c.bgSub,
  },
  pickerRowText: { flex: 1, fontSize: 13, color: c.textMid },
  pickerRowTextSel: { fontWeight: '700', color: '#b45309' },
  pickerCheck: { fontSize: 13, fontWeight: '700', color: '#f59e0b' },
  chipBadge: { backgroundColor: '#fef3c7', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  chipBadgeText: { fontSize: 10, fontWeight: '700', color: '#b45309' },

  primaryBtn: { backgroundColor: '#f59e0b', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
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
