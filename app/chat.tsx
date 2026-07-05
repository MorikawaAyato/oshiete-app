import {
  View, Text, TouchableOpacity, ScrollView, TextInput,
  StyleSheet, Image, KeyboardAvoidingView, Platform,
  Animated, Alert, Modal,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { useApp } from '@/lib/AppContext'
import { getStudentById } from '@/lib/students'
import { startChat, sendChat } from '@/lib/api'
import { getTeacherCharacter } from '@/lib/teacherProfile'
import { addMail, loadRecap, loadFactsheet, saveRecapToHistory } from '@/lib/storage'
import type { ChatMessage } from '@/lib/types'
import { c } from '@/lib/theme'

const MAX_TURNS = 9
const HINT_MAX_USES = 3
const HINT_LIMIT_ENABLED = false // 実験中: 虎の巻の回数制限を無効化（戻すときは true）

const NG_PATTERNS = [
  /死[にねの]/, /死んで/, /氏ね/,
  /[殺コロ][しすせそ]/, /ぶ[っ]?殺/,
  /ちんこ/i, /ちんちん/i, /まんこ/i, /おっぱい/i,
  /[セせ][ッっ][クく][スす]/, /エロ/i, /ポルノ/i, /フェラ/i, /手コキ/i, /オナニー/i,
]

function containsNG(text: string): boolean {
  return NG_PATTERNS.some((p) => p.test(text))
}

// 添削アニメ: 花丸スタンプ／赤ペンをぽんっと表示する
function GradeIn({ delay, animate, stamp, children }: { delay: number; animate: boolean; stamp?: boolean; children: React.ReactNode }) {
  const scale = useRef(new Animated.Value(animate ? (stamp ? 2 : 0.9) : 1)).current
  const opacity = useRef(new Animated.Value(animate ? 0 : 1)).current
  useEffect(() => {
    if (!animate) return
    Animated.sequence([
      Animated.delay(delay),
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, bounciness: 14, speed: 14 }),
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]),
    ]).start()
  }, [])
  return <Animated.View style={{ opacity, transform: [{ scale }] }}>{children}</Animated.View>
}

function TypingDots({ color }: { color: string }) {
  const dot0 = useRef(new Animated.Value(0)).current
  const dot1 = useRef(new Animated.Value(0)).current
  const dot2 = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const bounce = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: -5, duration: 200, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 200, useNativeDriver: true }),
          Animated.delay(600 - delay),
        ])
      )
    const a0 = bounce(dot0, 0)
    const a1 = bounce(dot1, 150)
    const a2 = bounce(dot2, 300)
    a0.start(); a1.start(); a2.start()
    return () => { a0.stop(); a1.stop(); a2.stop() }
  }, [])

  return (
    <View style={{ backgroundColor: 'white', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', gap: 5, alignItems: 'center' }}>
      {[dot0, dot1, dot2].map((dot, i) => (
        <Animated.View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, opacity: 0.7, transform: [{ translateY: dot }] }} />
      ))}
    </View>
  )
}

function EnteringRoom({ student }: { student: { name: string; avatar: string; color: string } }) {
  const msgs = [
    `${student.name}のトークルームに接続中...`,
    '教材を送信しています...',
    `${student.name}が確認しています...`,
    'もうすぐ始まります...',
  ]
  const [idx, setIdx] = useState(0)
  const opacity = useRef(new Animated.Value(1)).current

  useEffect(() => {
    const interval = setInterval(() => {
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        setIdx(i => (i + 1) % msgs.length)
        Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }).start()
      })
    }, 2200)
    return () => clearInterval(interval)
  }, [])

  return (
    <View style={styles.entering}>
      <View style={styles.enteringAvatarWrap}>
        <Image source={{ uri: student.avatar }} style={styles.enteringAvatar} />
        <View style={styles.enteringOnline} />
      </View>
      <Animated.Text style={[styles.enteringMsg, { opacity }]}>
        {msgs[idx]}
      </Animated.Text>
      <View style={styles.dotsRow}>
        <View style={[styles.dot, { backgroundColor: student.color }]} />
        <View style={[styles.dot, { backgroundColor: student.color, opacity: 0.6 }]} />
        <View style={[styles.dot, { backgroundColor: student.color, opacity: 0.3 }]} />
      </View>
    </View>
  )
}

export default function ChatScreen() {
  const router = useRouter()
  const {
    imageDescription, notes, selectedStudentId, teacherProfile, currentHistoryId,
    chatMessages, setChatMessages,
    turnCount, setTurnCount,
    classEnded, setClassEnded,
    hints, setHints,
    hintUsesLeft, setHintUsesLeft,
    correctness, setCorrectness,
    lessonRecap, setLessonRecap,
    notebook, setNotebook,
    notebookState, setNotebookState,
    resetChatSession,
  } = useApp()
  const teacherName = teacherProfile.name || undefined
  const teacherCharacter = getTeacherCharacter(teacherProfile.avatarId)
  const student = getStudentById(selectedStudentId ?? '')
  const scrollRef = useRef<ScrollView>(null)

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState(false)
  const [sendError, setSendError] = useState<ChatMessage[] | null>(null)
  const [inputBlocked, setInputBlocked] = useState(false)
  const [showHints, setShowHints] = useState(false)
  const [hintCharged, setHintCharged] = useState(false) // このターンのヒントを開封済みか（開閉で二重消費しない）
  const [showNotebook, setShowNotebook] = useState(false)
  const [notebookGrading, setNotebookGrading] = useState(false)

  const remainingMins = classEnded ? 0 : (MAX_TURNS - turnCount) * 5
  const progressRatio = (MAX_TURNS - turnCount) / MAX_TURNS
  const timerColor = classEnded
    ? c.faint
    : progressRatio > 0.55 ? c.success : progressRatio > 0.3 ? c.warn : c.dangerSoft

  useEffect(() => {
    if (chatMessages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 100)
    }
  }, [])

  const initChat = () => {
    if (!student) return
    setStartError(false)
    setStarting(true)
    // この教材×この生徒の前回Recap（生徒メモリ）とファクトシートがあれば授業に持ち込む
    Promise.all([loadRecap(currentHistoryId, student.id), loadFactsheet(currentHistoryId)])
      .then(([recap, factsheet]) => {
        setLessonRecap(recap)
        setCorrectness([])
        setNotebook(null)
        setNotebookState(null)
        setNotebookGrading(false)
        return startChat(student.id, imageDescription, notes, teacherName, teacherCharacter, recap ?? undefined, factsheet)
      })
      .then((res) => {
        if (res.manaResponse) {
          setChatMessages([{ role: 'mana', text: res.manaResponse }])
          setHints(res.hints ?? null)
          setShowHints(false)
          setHintUsesLeft(HINT_MAX_USES)
          setHintCharged(false)
        } else {
          setStartError(true)
        }
      })
      .catch(() => setStartError(true))
      .finally(() => setStarting(false))
  }

  useEffect(() => {
    // メッセージが既にある（教材画面から戻ってきた等）場合はstartChatしない
    if (!student || chatMessages.length > 0) return
    initChat()
  }, [])

  const performSend = async (next: ChatMessage[]) => {
    if (!student) return
    setSendError(null)
    setLoading(true)

    try {
      const isFinalTurn = turnCount + 1 >= MAX_TURNS
      const turnsLeft = MAX_TURNS - (turnCount + 1)
      const factsheet = await loadFactsheet(currentHistoryId)
      const res = await sendChat(student.id, imageDescription, notes, next, teacherName, teacherCharacter, isFinalTurn, turnsLeft, correctness, lessonRecap ?? undefined, factsheet)
      if (res.text) {
        const newMessages: ChatMessage[] = [...next, { role: 'mana', text: res.text }]
        setChatMessages(newMessages)
        setHints(res.hints ?? null)
        setShowHints(false)
        setHintCharged(false)
        setCorrectness(prev => [...prev, res.correct ?? null])
        const newTurnCount = turnCount + 1
        setTurnCount(newTurnCount)
        if (newTurnCount >= MAX_TURNS) {
          setClassEnded(true)
          setHints(null)
          if (res.recap && currentHistoryId) {
            void saveRecapToHistory(currentHistoryId, student.id, res.recap)
          }
          if (res.mailContent) {
            void addMail({
              id: Date.now().toString(),
              type: 'student',
              from: student.name,
              studentId: student.id,
              subject: res.mailSubject,
              content: res.mailContent,
              timestamp: new Date().toISOString(),
              read: false,
            })
          }
          const nb = res.notebook
          setTimeout(() => {
            setChatMessages(prev => [...prev, { role: 'mana', text: student.endMessage }])
            setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)
            if (nb) {
              // 終了の挨拶のあとにノート写真が届く
              setTimeout(() => {
                setChatMessages(prev => [...prev, { role: 'mana', text: student.notebookMessage }])
                setNotebook(nb)
                setNotebookState('received')
                setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)
              }, 1200)
            }
          }, 500)
        }
      } else {
        // APIがエラーJSONを返した場合（メッセージには何も追加しない）
        setSendError(next)
        setHints(null)
      }
    } catch {
      setSendError(next)
      setHints(null)
    } finally {
      setLoading(false)
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)
    }
  }

  const doSend = async (text: string) => {
    if (!student) return
    setHints(null)
    setShowHints(false)
    setHintCharged(false)
    const userMsg: ChatMessage = { role: 'user', text }
    const next = [...chatMessages, userMsg]
    setChatMessages(next)
    await performSend(next)
  }

  const openHints = () => {
    if (showHints) { setShowHints(false); return }
    if (HINT_LIMIT_ENABLED && !hintCharged) {
      if (hintUsesLeft <= 0) return
      setHintUsesLeft((v) => v - 1)
      setHintCharged(true)
    }
    setShowHints(true)
  }

  const send = async () => {
    if (!input.trim() || loading || !student) return
    if (containsNG(input)) {
      setInputBlocked(true)
      setTimeout(() => setInputBlocked(false), 3000)
      return
    }
    const text = input.trim()
    setInput('')
    await doSend(text)
  }

  const endClass = () => {
    if (classEnded) return
    setClassEnded(true)
    if (student) {
      setChatMessages((prev) => [...prev, { role: 'mana', text: student.endMessage }])
    }
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)
  }

  // 添削したノートを生徒に返す
  const handleReturnNotebook = () => {
    if (!student) return
    setNotebookState('returned')
    setShowNotebook(false)
    setNotebookGrading(false)
    setChatMessages((prev) => [...prev, { role: 'mana', text: student.notebookThanks }])
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)
  }

  const handleBack = () => {
    if (chatMessages.length > 0 && !classEnded) {
      Alert.alert(
        '授業を終了しますか？',
        '途中で戻ると会話の記録が消えます。',
        [
          { text: 'キャンセル', style: 'cancel' },
          {
            text: '終了して戻る',
            style: 'destructive',
            onPress: () => {
              resetChatSession()
              router.back()
            },
          },
        ],
      )
    } else {
      if (classEnded) resetChatSession()
      router.back()
    }
  }

  if (!student) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.errorText}>生徒が選択されていません</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backLink}>← 戻る</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  if (starting || (startError && chatMessages.length === 0)) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: student.color + '18' }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
            <Text style={styles.backText}>← 戻る</Text>
          </TouchableOpacity>
          <View style={{ width: 60 }} />
        </View>
        {starting ? (
          <EnteringRoom student={student} />
        ) : (
          <View style={styles.center}>
            <Text style={styles.errorText}>⚠️ {student.name}のトークルームに接続できませんでした</Text>
            <TouchableOpacity onPress={initChat} style={styles.retryBtn}>
              <Text style={styles.retryBtnText}>もう一度接続する</Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: student.color + '18' }]}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* ヘッダー */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
            <Text style={styles.backText}>← 戻る</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Image source={{ uri: student.avatar }} style={styles.headerAvatar} />
            <View>
              <Text style={styles.headerName}>{student.name}</Text>
              <Text style={[styles.timerText, { color: timerColor }]}>
                {classEnded ? '終了' : `残り${remainingMins}分`}
              </Text>
              {!classEnded && (
                <Text style={styles.timerSub}>送信ごとに5分</Text>
              )}
            </View>
          </View>
          {!classEnded ? (
            <TouchableOpacity onPress={endClass} style={styles.endBtn}>
              <Text style={styles.endBtnText}>授業終了</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 60 }} />
          )}
        </View>

        {/* 教材を見るボタン */}
        <TouchableOpacity style={styles.previewBar} onPress={() => router.push('/preview')}>
          <Text style={styles.previewBarText}>📖 教材を見る</Text>
        </TouchableOpacity>

        {/* チャット */}
        <ScrollView
          ref={scrollRef}
          style={styles.messages}
          contentContainerStyle={styles.messagesContent}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {chatMessages.map((msg, i) => (
            <View key={i} style={[styles.bubble, msg.role === 'user' ? styles.bubbleUser : styles.bubbleMana]}>
              {msg.role === 'mana' && (
                <Image source={{ uri: student.avatar }} style={styles.bubbleAvatar} />
              )}
              <View style={[
                styles.bubbleText,
                msg.role === 'user' ? styles.bubbleTextUser : styles.bubbleTextMana,
                { maxWidth: msg.role === 'user' ? '75%' : '80%' },
              ]}>
                <Text style={[styles.msgText, msg.role === 'user' && styles.msgTextUser]}>
                  {msg.text}
                </Text>
              </View>
            </View>
          ))}
          {sendError && !loading && (
            <View style={styles.sendErrorWrap}>
              <Text style={styles.sendErrorText}>⚠️ 通信エラーで届きませんでした</Text>
              <TouchableOpacity onPress={() => performSend(sendError)} style={styles.retryBtn}>
                <Text style={styles.retryBtnText}>もう一度送る</Text>
              </TouchableOpacity>
            </View>
          )}
          {loading && (
            <View style={[styles.bubble, styles.bubbleMana]}>
              <Image source={{ uri: student.avatar }} style={styles.bubbleAvatar} />
              <TypingDots color={student.color} />
            </View>
          )}
          {/* ノート写真カード（授業終了後に生徒から届く） */}
          {notebook && notebookState && (
            <View style={[styles.bubble, styles.bubbleMana]}>
              <Image source={{ uri: student.avatar }} style={styles.bubbleAvatar} />
              <TouchableOpacity onPress={() => setShowNotebook(true)} style={styles.notebookCard}>
                <View style={styles.notebookCardPaper}>
                  <Text style={styles.notebookCardTitle} numberOfLines={1}>📓 {notebook.title}</Text>
                  {notebook.lines.slice(0, 3).map((l, i) => (
                    <Text key={i} style={styles.notebookCardLine} numberOfLines={1}>
                      {l.status === 'blank' ? '　' : l.text}
                    </Text>
                  ))}
                  <Text style={styles.notebookCardLine}>…</Text>
                  {notebookState === 'returned' && (
                    <Text style={styles.notebookCardStamp}>💮</Text>
                  )}
                </View>
                <Text style={styles.notebookCardAction}>
                  {notebookState === 'returned' ? '添削済みのノートを見る ✨' : 'タップして添削する 🖊️'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
          {classEnded && (
            <View style={styles.endedActions}>
              <Text style={styles.endedLabel}>授業が終わりました</Text>
              <TouchableOpacity style={styles.finishBtn} onPress={handleBack}>
                <Text style={styles.finishBtnText}>ホームに戻る</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>

        {/* ノート添削モーダル */}
        <Modal
          visible={showNotebook && !!notebook}
          transparent
          animationType="fade"
          onRequestClose={() => setShowNotebook(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.notebookModal}>
              <View style={styles.notebookModalHeader}>
                <Text style={styles.notebookModalTitle}>📓 {student.name}のノート</Text>
                <TouchableOpacity onPress={() => setShowNotebook(false)} hitSlop={8}>
                  <Text style={styles.notebookModalClose}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.notebookScroll}>
                <View style={styles.notebookPaper}>
                  <Text style={styles.notebookTitle}>{notebook?.title}</Text>
                  {notebook?.lines.map((line, i) => {
                    const annotationsVisible = notebookGrading || notebookState === 'returned'
                    const animate = notebookGrading && notebookState === 'received'
                    return (
                      <View key={i} style={styles.notebookLineRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.notebookLineText, line.status === 'blank' && styles.notebookLineBlank]}>
                            {line.status === 'blank' ? '（ここ、書けませんでした…）' : line.text}
                          </Text>
                          {annotationsVisible && line.status !== 'correct' && line.correction && (
                            <GradeIn delay={400 + i * 350} animate={animate}>
                              <Text style={styles.notebookCorrection}>
                                {line.status === 'wrong' ? '✗ ' : '＋ '}{line.correction}
                              </Text>
                            </GradeIn>
                          )}
                        </View>
                        {annotationsVisible && line.status === 'correct' && (
                          <GradeIn delay={400 + i * 350} animate={animate} stamp>
                            <Text style={styles.notebookHanamaru}>💮</Text>
                          </GradeIn>
                        )}
                      </View>
                    )
                  })}
                </View>
              </ScrollView>
              <View style={styles.notebookModalFooter}>
                {!notebookGrading && notebookState === 'received' ? (
                  <TouchableOpacity onPress={() => setNotebookGrading(true)} style={styles.gradeBtn}>
                    <Text style={styles.gradeBtnText}>🖊️ 赤ペンで添削する</Text>
                  </TouchableOpacity>
                ) : notebookState === 'received' ? (
                  <GradeIn delay={600 + (notebook?.lines.length ?? 0) * 350} animate>
                    <TouchableOpacity onPress={handleReturnNotebook} style={styles.returnBtn}>
                      <Text style={styles.gradeBtnText}>📮 ノートを返す</Text>
                    </TouchableOpacity>
                  </GradeIn>
                ) : (
                  <TouchableOpacity onPress={() => setShowNotebook(false)} style={styles.closeNotebookBtn}>
                    <Text style={styles.closeNotebookBtnText}>閉じる</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        </Modal>

        {/* 入力エリア */}
        {!classEnded && (
          <View style={styles.inputAreaWrap}>
            {hints && (
              <View style={styles.hintsWrap}>
                <TouchableOpacity
                  onPress={openHints}
                  disabled={HINT_LIMIT_ENABLED && !showHints && !hintCharged && hintUsesLeft <= 0}
                  style={styles.hintToggle}
                >
                  <Text style={[styles.hintToggleText, HINT_LIMIT_ENABLED && hintUsesLeft <= 0 && !hintCharged && styles.hintToggleTextDisabled]}>
                    {HINT_LIMIT_ENABLED && hintUsesLeft <= 0 && !hintCharged
                      ? '📜 虎の巻は使い切りました'
                      : `📜 虎の巻を開く${HINT_LIMIT_ENABLED ? `（残り${hintUsesLeft}回）` : ''} ${showHints ? '▲' : '▼'}`}
                  </Text>
                </TouchableOpacity>
                {showHints && (
                  <>
                    <Text style={styles.hintNote}>1つが正解、2つが誤りです。タップすると入力欄に写せます</Text>
                    {hints.map((hint, i) => (
                      <TouchableOpacity key={i} onPress={() => setInput(hint)} disabled={loading} style={styles.hintItem}>
                        <Text style={styles.hintItemText}>{hint}</Text>
                      </TouchableOpacity>
                    ))}
                  </>
                )}
              </View>
            )}
            <View style={styles.inputArea}>
              <TextInput
                style={styles.input}
                value={input}
                onChangeText={setInput}
                placeholder="先生として説明してみよう..."
                placeholderTextColor={c.faint}
                multiline
                maxLength={500}
              />
              <TouchableOpacity
                style={[styles.sendBtn, { backgroundColor: student.color }, (!input.trim() || loading) && styles.sendBtnDisabled]}
                onPress={send}
                disabled={!input.trim() || loading}
              >
                <Text style={styles.sendBtnText}>送信</Text>
              </TouchableOpacity>
            </View>
            {inputBlocked && (
              <Text style={styles.ngWarning}>⚠️ その内容は送信できません</Text>
            )}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  errorText: { fontSize: 15, color: c.textSub, textAlign: 'center' },
  backLink: { fontSize: 14, color: c.link, fontWeight: '600' },

  entering: {
    flex: 1, justifyContent: 'center', alignItems: 'center', gap: 28, paddingHorizontal: 32,
  },
  enteringAvatarWrap: { position: 'relative' },
  enteringAvatar: { width: 96, height: 96, borderRadius: 48 },
  enteringOnline: {
    position: 'absolute', bottom: 4, right: 4,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: c.success, borderWidth: 2, borderColor: 'white',
  },
  enteringMsg: { fontSize: 16, fontWeight: '600', color: c.text, textAlign: 'center' },
  dotsRow: { flexDirection: 'row', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: c.border,
  },
  backBtn: { paddingVertical: 4 },
  backText: { fontSize: 13, color: c.link },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerAvatar: { width: 32, height: 32, borderRadius: 16 },
  headerName: { fontSize: 14, fontWeight: 'bold', color: c.textStrong },
  timerText: { fontSize: 11, fontWeight: '700', marginTop: 1 },
  timerSub: { fontSize: 9, color: c.faint, marginTop: 1 },
  endBtn: { backgroundColor: c.bgSub, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  endBtnText: { fontSize: 12, color: c.textSub, fontWeight: '600' },

  previewBar: {
    backgroundColor: c.purpleTint, borderBottomWidth: 1, borderBottomColor: c.purpleBorder,
    paddingVertical: 9, alignItems: 'center',
  },
  previewBarText: { fontSize: 13, fontWeight: '700', color: c.purple },

  messages: { flex: 1, backgroundColor: 'transparent' },
  messagesContent: { paddingHorizontal: 16, paddingVertical: 16, gap: 12 },

  bubble: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubbleUser: { justifyContent: 'flex-end' },
  bubbleMana: { justifyContent: 'flex-start' },
  bubbleAvatar: { width: 32, height: 32, borderRadius: 16, marginBottom: 2 },
  bubbleText: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleTextUser: { backgroundColor: c.primarySoft },
  bubbleTextMana: { backgroundColor: 'white' },
  msgText: { fontSize: 14, color: c.textStrong, lineHeight: 21 },
  msgTextUser: { color: 'white' },

  typingDots: { backgroundColor: 'white', borderRadius: 16, padding: 12 },

  sendErrorWrap: { alignItems: 'center', gap: 8, paddingVertical: 4 },
  sendErrorText: { fontSize: 12, color: c.dangerSoft, fontWeight: '600' },
  retryBtn: {
    backgroundColor: 'white', borderRadius: 12,
    borderWidth: 1, borderColor: c.borderStrong,
    paddingHorizontal: 16, paddingVertical: 9,
  },
  retryBtnText: { fontSize: 13, fontWeight: '700', color: c.textMid },

  notebookCard: {
    width: 210, backgroundColor: 'white', borderRadius: 16,
    borderWidth: 2, borderColor: c.border, padding: 10,
  },
  notebookCardPaper: {
    backgroundColor: c.paper, borderRadius: 10,
    borderWidth: 1, borderColor: c.paperBorder,
    paddingHorizontal: 10, paddingVertical: 8, overflow: 'hidden',
  },
  notebookCardTitle: { fontSize: 10, fontWeight: '700', color: c.faint, marginBottom: 3 },
  notebookCardLine: {
    fontSize: 10, color: c.textSub, lineHeight: 18,
    borderBottomWidth: 1, borderBottomColor: c.paperLine + '80',
  },
  notebookCardStamp: { position: 'absolute', top: 2, right: 4, fontSize: 24 },
  notebookCardAction: { marginTop: 7, fontSize: 12, fontWeight: '700', color: c.primary, textAlign: 'center' },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', padding: 20,
  },
  notebookModal: {
    backgroundColor: 'white', borderRadius: 20, maxHeight: '85%',
    paddingBottom: 16,
  },
  notebookModalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 16, paddingBottom: 8,
  },
  notebookModalTitle: { fontSize: 14, fontWeight: 'bold', color: c.textStrong },
  notebookModalClose: { fontSize: 16, color: c.faint, paddingHorizontal: 4 },
  notebookScroll: { paddingHorizontal: 18 },
  notebookPaper: {
    backgroundColor: c.paper, borderRadius: 14,
    borderWidth: 1, borderColor: c.paperLine,
    paddingHorizontal: 14, paddingVertical: 14,
  },
  notebookTitle: {
    fontSize: 14, fontWeight: 'bold', color: c.text,
    borderBottomWidth: 2, borderBottomColor: c.paperRule,
    paddingBottom: 4, marginBottom: 6,
  },
  notebookLineRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderBottomWidth: 1, borderBottomColor: c.paperLine + 'cc',
    paddingVertical: 7,
  },
  notebookLineText: { fontSize: 13, color: c.text, lineHeight: 20 },
  notebookLineBlank: { color: c.borderStrong },
  notebookCorrection: { fontSize: 12, fontWeight: '700', color: c.danger, lineHeight: 17, marginTop: 3 },
  notebookHanamaru: { fontSize: 30 },
  notebookModalFooter: { paddingHorizontal: 18, paddingTop: 12 },
  gradeBtn: {
    backgroundColor: c.dangerSoft, borderRadius: 12,
    paddingVertical: 13, alignItems: 'center',
  },
  returnBtn: {
    backgroundColor: c.primarySoft, borderRadius: 12,
    paddingVertical: 13, alignItems: 'center',
  },
  gradeBtnText: { color: 'white', fontWeight: 'bold', fontSize: 14 },
  closeNotebookBtn: {
    backgroundColor: 'white', borderRadius: 12,
    borderWidth: 1, borderColor: c.borderStrong,
    paddingVertical: 13, alignItems: 'center',
  },
  closeNotebookBtnText: { fontSize: 14, fontWeight: '700', color: c.textMid },

  endedActions: { marginTop: 16, gap: 10 },
  endedLabel: { fontSize: 13, color: c.textSub, textAlign: 'center', fontWeight: '600' },
  finishBtn: {
    backgroundColor: 'white', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
    borderWidth: 1.5, borderColor: c.borderStrong,
  },
  finishBtnText: { fontSize: 14, fontWeight: '700', color: c.textMid },
  finishBtnTextPreview: { fontSize: 14, fontWeight: '700', color: c.link },

  inputAreaWrap: {
    backgroundColor: 'white', borderTopWidth: 1, borderTopColor: c.border,
  },
  hintsWrap: { paddingHorizontal: 12, paddingTop: 10, gap: 6 },
  hintToggle: { paddingVertical: 2 },
  hintToggleText: { fontSize: 12, fontWeight: '600', color: c.paperText },
  hintToggleTextDisabled: { color: c.borderStrong },
  hintNote: { fontSize: 11, color: c.textSub, marginBottom: 2 },
  hintItem: {
    borderWidth: 1, borderColor: c.paperLine, borderRadius: 12,
    backgroundColor: c.paper, paddingHorizontal: 14, paddingVertical: 10,
  },
  hintItemText: { fontSize: 13, color: c.text, lineHeight: 19 },
  inputArea: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  ngWarning: {
    fontSize: 12, color: c.danger, textAlign: 'center',
    paddingBottom: 8,
  },
  input: {
    flex: 1, backgroundColor: c.bg, borderRadius: 12,
    borderWidth: 1, borderColor: c.border,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, color: c.textStrong, maxHeight: 100,
  },
  sendBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: 'white', fontWeight: 'bold', fontSize: 14 },
})
