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
import { fetchPrint, judgeRedpen, fetchFactsheet } from '@/lib/api'
import {
  loadFactsheet, updateHistoryFactsheet, saveRecapToHistory,
  loadCardProgress, saveCardProgress, loadDrillPending, saveDrillPending, drillKey,
} from '@/lib/storage'
import type { CardProgress, PrintItem, QACard, Recap } from '@/lib/types'
import { btn, c, font } from '@/lib/theme'
import { Feather } from '@expo/vector-icons'
import BouncyPressable from '@/components/BouncyPressable'
import PawGlyph from '@/components/PawGlyph'
import StampText from '@/components/StampText'

// プリント授業：1枚＝5問（復習枠 最大2＋新規枠）。流れは 丸付け→赤ペン→答え合わせ
const PRINT_SIZE = 5
const PRINT_REVIEW_MAX = 2

const NG_PATTERNS = [
  /死[にねの]/, /死んで/, /氏ね/,
  /[殺コロ][しすせそ]/, /ぶ[っ]?殺/,
  /ちんこ/i, /ちんちん/i, /まんこ/i, /おっぱい/i,
  /[セせ][ッっ][クく][スす]/, /エロ/i, /ポルノ/i, /フェラ/i, /手コキ/i, /オナニー/i,
]

function containsNG(text: string): boolean {
  return NG_PATTERNS.some((p) => p.test(text))
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// プリントの出題構成：復習枠（進度pending＋研修「まだ」を古い順に最大2問）＋新規枠（未出題優先、
// 尽きたら最終出題が古い順）。昇進試験の出題ロジックと同じ思想。出題順はシャッフルして返す
function composePrint(
  cards: QACard[],
  progress: Record<string, CardProgress>,
  drillPending: Set<string>,
): { card: QACard; index: number; isReview: boolean }[] {
  const entries = cards.map((card, index) => ({ card, index, key: drillKey(card) }))
  const isPending = (e: { key: string }) => !!progress[e.key]?.pending || drillPending.has(e.key)
  const reviews = entries
    .filter(isPending)
    .sort((a, b) => (progress[a.key]?.lastAt ?? 0) - (progress[b.key]?.lastAt ?? 0))
    .slice(0, PRINT_REVIEW_MAX)
  const picked = new Set(reviews.map((e) => e.key))
  const fresh = shuffle(entries.filter((e) => !picked.has(e.key) && !progress[e.key]))
  const seen = entries
    .filter((e) => !picked.has(e.key) && progress[e.key] && !isPending(e))
    .sort((a, b) => progress[a.key].lastAt - progress[b.key].lastAt)
  const fill = [...fresh, ...seen].slice(0, Math.max(0, PRINT_SIZE - reviews.length))
  return shuffle([
    ...reviews.map((e) => ({ card: e.card, index: e.index, isReview: true })),
    ...fill.map((e) => ({ card: e.card, index: e.index, isReview: false })),
  ])
}

// タイピング演出: 足あとがとことこ現れて消える
function TypingPaws() {
  const paw0 = useRef(new Animated.Value(0)).current
  const paw1 = useRef(new Animated.Value(0)).current
  const paw2 = useRef(new Animated.Value(0)).current

  useEffect(() => {
    // 各足あとの周期は 1600ms で揃える（時差で現れて、いっしょに消える）
    const step = (paw: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(paw, { toValue: 1, duration: 200, useNativeDriver: true }),
          Animated.delay(1000 - delay),
          Animated.timing(paw, { toValue: 0, duration: 200, useNativeDriver: true }),
          Animated.delay(200),
        ])
      )
    const a0 = step(paw0, 0)
    const a1 = step(paw1, 300)
    const a2 = step(paw2, 600)
    a0.start(); a1.start(); a2.start()
    return () => { a0.stop(); a1.stop(); a2.stop() }
  }, [])

  return (
    <View style={{ backgroundColor: 'white', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', gap: 4, alignItems: 'center' }}>
      {[paw0, paw1, paw2].map((paw, i) => (
        <Animated.View
          key={i}
          style={{ opacity: paw, transform: [{ translateY: i === 1 ? -4 : 4 }, { rotate: i === 1 ? '84deg' : '96deg' }] }}
        >
          <PawGlyph />
        </Animated.View>
      ))}
    </View>
  )
}

function EnteringRoom({ student }: { student: { name: string; avatar: ReturnType<typeof require>; color: string } }) {
  const msgs = [
    `${student.name}のトークルームに接続中...`,
    `${student.name}がプリントをかばんから出しています...`,
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
        <Image source={student.avatar} style={styles.enteringAvatar} />
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
    imageDescription, notes, selectedStudentId, currentHistoryId,
    chatMessages, setChatMessages,
    printItems, setPrintItems,
    printStage, setPrintStage,
    resetChatSession,
  } = useApp()
  const student = getStudentById(selectedStudentId ?? '')
  const scrollRef = useRef<ScrollView>(null)

  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState(false)
  const [studentTyping, setStudentTyping] = useState(false)
  const [showPrint, setShowPrint] = useState(false) // プリント（丸付け／添削済み）モーダル
  const [showCheck, setShowCheck] = useState(false) // 答え合わせモーダル
  const [redpenInput, setRedpenInput] = useState('') // 赤ペンラリーの入力欄
  const [showRedpenHints, setShowRedpenHints] = useState(false) // いま聞かれている問題の虎の巻
  const [redpenSending, setRedpenSending] = useState(false) // 返却（赤ペン一括判定）の通信中
  const [redpenError, setRedpenError] = useState<string | null>(null)
  const [flipNoteDrafts, setFlipNoteDrafts] = useState<Record<number, string>>({}) // ○→✕のひとこと下書き

  // 生徒のセリフを入力中演出を挟んで1通ずつ届けるタイマー（画面を離れたら破棄）
  const beatTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const pushBeats = (texts: string[]) => {
    texts.forEach((t, i) => {
      beatTimers.current.push(setTimeout(() => setStudentTyping(true), i * 2000 + 500))
      beatTimers.current.push(setTimeout(() => {
        setStudentTyping(false)
        setChatMessages(prev => [...prev, { role: 'mana', text: t }])
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)
      }, i * 2000 + 1800))
    })
  }
  useEffect(() => () => { beatTimers.current.forEach(clearTimeout) }, [])

  useEffect(() => {
    if (chatMessages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 100)
    }
  }, [])

  // 授業開始：カードバンクからプリントを構成し、答案（正誤つき）を生成して教室へ
  const initPrint = async () => {
    if (!student) return
    setStartError(false)
    setStarting(true)
    try {
      const factsheet = await loadFactsheet(currentHistoryId)
      const cards = factsheet?.cards ?? []
      if (cards.length === 0) {
        // プリントはカードバンクから作る。バンクが無い教材はバックフィルを仕掛けてから待ってもらう
        if (currentHistoryId && imageDescription) {
          const histId = currentHistoryId
          void fetchFactsheet(imageDescription, notes)
            .then((res) => { if (res.factsheet) void updateHistoryFactsheet(histId, res.factsheet) })
            .catch(() => {})
        }
        setStartError(true)
        return
      }
      const [progress, drillPending] = await Promise.all([loadCardProgress(), loadDrillPending()])
      const picked = composePrint(cards, progress, drillPending)
      const res = await fetchPrint(
        student.id,
        picked.map((p) => ({ question: p.card.q, modelAnswer: p.card.a, isReview: p.isReview })),
        factsheet?.misconceptions ?? [],
      )
      if (!res.items || res.items.length !== picked.length) {
        setStartError(true)
        return
      }
      const items: PrintItem[] = picked.map((p, i) => ({
        cardIndex: p.index,
        cardKey: drillKey(p.card),
        question: p.card.q,
        modelAnswer: p.card.a,
        studentAnswer: res.items![i].studentAnswer,
        truth: res.items![i].truth,
        choices: (res.items![i].choices ?? []).slice(0, 3),
        isReview: p.isReview,
      }))
      // 初回（この教材のカードにまだ進度がない）だけ「さっき解いてもらったてい」の挨拶にする
      const isFirst = !cards.some((cd) => progress[drillKey(cd)])
      setPrintItems(items)
      setPrintStage('grading')
      pushBeats([isFirst ? student.printGreetingFirst : student.printGreeting])
    } catch {
      setStartError(true)
    } finally {
      setStarting(false)
    }
  }

  useEffect(() => {
    // プリントが既にある（教材画面から戻ってきた・再開した）場合は生成しない
    if (!student || printItems.length > 0) return
    void initPrint()
  }, [])

  // 第1段：先生（ユーザー）がプリントの各問に⭕❌をつける（模範解答は見ない）
  const setPrintMark = (i: number, val: boolean) => {
    setPrintItems((prev) => prev.map((it, j) => (j === i ? { ...it, teacherMark: val } : it)))
  }

  // 丸付けと truth の突き合わせ（答え合わせで生徒が聞きに来る「採点のズレ」）
  const hasGradeMismatch = (it: PrintItem) => it.teacherMark !== undefined && it.teacherMark !== (it.truth === 'correct')

  // セリフのテンプレ埋め（{n}=問番号 {q}=問題文。長い問題文は詰める）
  const fillAsk = (template: string, n: number, q: string) =>
    template.replace('{n}', String(n)).replace('{q}', q.length > 24 ? q.slice(0, 24) + '…' : q)

  // 授業の締め：最終○✕を確定し、カード進度・研修「まだ」・Recapへ反映してリザルトを届ける
  const finishLesson = (rawItems: PrintItem[], opts?: { noMismatch?: boolean; leadBeats?: string[] }) => {
    if (!student) return
    const items = rawItems.map((it) => ({ ...it, finalMark: it.finalMark ?? it.teacherMark }))
    setPrintItems(items)
    setPrintStage('done')
    setShowCheck(false)
    const now = Date.now()
    void (async () => {
      const [progress, drillPending] = await Promise.all([loadCardProgress(), loadDrillPending()])
      for (const it of items) {
        // 「クリア」＝最終○かつ説明も覚え直し不要。それ以外は復習待ちとして次回プリントの復習枠へ
        const cleared = it.finalMark === true && it.redPenFinal !== 'relearn'
        const prev = progress[it.cardKey]
        progress[it.cardKey] = { seen: (prev?.seen ?? 0) + 1, lastAt: now, lastResult: it.finalMark === true, pending: !cleared }
        if (cleared) drillPending.delete(it.cardKey) // 研修の「まだ」も授業のクリアで解消する
      }
      await saveCardProgress(progress)
      await saveDrillPending(drillPending)
      // 生徒プロフィールの記録（Recap）はプリント結果から機械生成（AIコール不要）
      if (currentHistoryId) {
        const recap: Recap = {
          savedAt: now,
          coveredTopics: items.map((it) => ({ topic: it.question.slice(0, 40), understanding: it.finalMark ? ('high' as const) : ('low' as const) })),
          struggledPoints: items.filter((it) => !it.finalMark || it.redPenFinal === 'relearn').map((it) => it.modelAnswer).slice(0, 6),
          uncoveredTopics: [],
        }
        await saveRecapToHistory(currentHistoryId, student.id, recap)
      }
    })()
    const okCount = items.filter((it) => it.finalMark).length
    const retryCount = items.filter((it) => !it.finalMark || it.redPenFinal === 'relearn').length
    const beats: string[] = [...(opts?.leadBeats ?? [])]
    if (opts?.noMismatch) beats.push(okCount === items.length ? student.perfectLine : student.noMismatchLine)
    beats.push(student.printThanks)
    beats.push(`今日のプリントは ○が${okCount}問・✕が${items.length - okCount}問 でした。${retryCount > 0 ? `まちがえた${retryCount}問は、次のプリントでもういちど挑戦しますね！` : 'ぜんぶばっちりです！'}`)
    pushBeats(beats)
  }

  // 答え合わせへ：採点のズレも説明のズレも無ければ、そのまま授業を締める
  const goCheck = (items: PrintItem[]) => {
    const mismatches = items.filter(hasGradeMismatch)
    const diverged = items.filter((it) => it.redPenVerdict === 'diverge')
    if (mismatches.length === 0 && diverged.length === 0) {
      finishLesson(items, { noMismatch: true })
    } else {
      setPrintStage('check')
      if (student) pushBeats([student.checkRequest])
    }
  }

  // 第1段の締め：採点してプリントを返す。✕があれば赤ペンのラリーへ、無ければ答え合わせへ
  const returnPrint = () => {
    setShowPrint(false)
    const wrongs = printItems.map((it, i) => ({ it, i })).filter(({ it }) => it.teacherMark === false)
    if (wrongs.length > 0 && student) {
      setPrintStage('redpen')
      pushBeats([student.redpenRequest, fillAsk(student.redpenAsk, wrongs[0].i + 1, wrongs[0].it.question)])
    } else {
      goCheck(printItems)
    }
  }

  // 赤ペンラリー：✕の問題を生徒が1問ずつ聞いてくる。先生の返信で次の問いへ（相づちは定型＝AI待ちゼロ）
  const sendRedpenChat = () => {
    if (!student || redpenSending || studentTyping) return
    const text = redpenInput.trim()
    if (!text) return
    if (containsNG(text)) { setRedpenError('その内容は送信できません'); return }
    const current = printItems.map((it, i) => ({ it, i })).find(({ it }) => it.teacherMark === false && it.redPen === undefined)
    if (!current) return
    setRedpenError(null)
    setRedpenInput('')
    setShowRedpenHints(false)
    const items = printItems.map((it, i) => (i === current.i ? { ...it, redPen: text } : it))
    setPrintItems(items)
    setChatMessages((prev) => [...prev, { role: 'user', text }])
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)
    const next = items.map((it, i) => ({ it, i })).find(({ it }) => it.teacherMark === false && it.redPen === undefined)
    if (next) {
      pushBeats([fillAsk(student.redpenAskNext, next.i + 1, next.it.question)])
    } else {
      void completeRedpen(items)
    }
  }

  // 赤ペンラリーの締め：正誤一致の✕の解説だけ一括判定にかけて、答え合わせ or 終了へ
  // （先生の✕が実は正解の答案だった問題は、答え合わせの採点ズレ側で解消されるため判定しない）
  const completeRedpen = async (itemsIn: PrintItem[]) => {
    if (!student || redpenSending) return
    setRedpenSending(true)
    setStudentTyping(true)
    let items = itemsIn
    const judgeTargets = items.map((it, i) => ({ it, i })).filter(({ it }) => it.teacherMark === false && it.truth === 'wrong')
    if (judgeTargets.length > 0) {
      try {
        const res = await judgeRedpen(judgeTargets.map(({ it }) => ({ question: it.question, modelAnswer: it.modelAnswer, explanation: it.redPen ?? '' })))
        if (Array.isArray(res.verdicts) && res.verdicts.length === judgeTargets.length) {
          const byIndex = new Map(judgeTargets.map(({ i }, k) => [i, res.verdicts![k]]))
          items = items.map((it, i) => (byIndex.has(i) ? { ...it, redPenVerdict: byIndex.get(i) } : it))
        }
      } catch { /* 判定に失敗しても授業は止めない（全件match扱い） */ }
    }
    setStudentTyping(false)
    setRedpenSending(false)
    setPrintItems(items)
    const mismatches = items.filter(hasGradeMismatch)
    const diverged = items.filter((it) => it.redPenVerdict === 'diverge')
    if (mismatches.length === 0 && diverged.length === 0) {
      finishLesson(items, { noMismatch: true, leadBeats: [student.redpenClose] })
    } else {
      setPrintStage('check')
      pushBeats([student.redpenClose, student.checkRequest])
    }
  }

  // 再開時の取りこぼし対策：赤ペンを全部書き終えた直後に中断されたセッションは、判定から続きを進める
  useEffect(() => {
    if (printStage !== 'redpen' || printItems.length === 0 || redpenSending) return
    const pendingAsk = printItems.some((it) => it.teacherMark === false && it.redPen === undefined)
    if (!pendingAsk) void completeRedpen(printItems)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printStage])

  // 第3段：採点ズレの再判定（最終判断は常にユーザ）
  const setCheckDecision = (i: number, finalMark: boolean) => {
    setPrintItems((prev) => prev.map((it, j) => (j === i ? { ...it, finalMark } : it)))
  }

  // 第3段：説明ズレへの1タップ判定
  const setRedpenDecision = (i: number, verdict: 'relearn' | 'ok') => {
    setPrintItems((prev) => prev.map((it, j) => (j === i ? { ...it, redPenFinal: verdict } : it)))
  }

  // 第3段の締め：○→✕にひっくり返した問題のひとことを反映して授業を締める
  const finishCheck = () => {
    const items = printItems.map((it, i) => {
      const note = (flipNoteDrafts[i] ?? '').trim()
      return it.teacherMark === true && it.finalMark === false && note ? { ...it, flipNote: note } : it
    })
    finishLesson(items)
  }

  const handleBack = () => {
    if (chatMessages.length > 0 && printStage !== 'done') {
      Alert.alert(
        '授業をとちゅうでやめますか？',
        'やめると、このプリントの採点はリセットされます。',
        [
          { text: 'キャンセル', style: 'cancel' },
          {
            text: 'やめて戻る',
            style: 'destructive',
            onPress: () => {
              resetChatSession()
              router.back()
            },
          },
        ],
      )
    } else {
      if (printStage === 'done') resetChatSession()
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

  if (starting || (startError && printItems.length === 0)) {
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
            <Text style={styles.errorText}><Feather name="alert-triangle" size={13} color={c.danger} /> プリントの用意ができませんでした。教材の準備中かもしれません。少し待ってからもう一度試してください</Text>
            <TouchableOpacity onPress={() => void initPrint()} style={styles.retryBtn}>
              <Text style={styles.retryBtnText}>もう一度接続する</Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    )
  }

  const stageLabel = printStage === 'done' ? '授業終了' : printStage === 'grading' ? 'プリントの丸付け中' : printStage === 'redpen' ? '赤ペンを待っています' : '答え合わせ中'

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
            <Text style={styles.backText}>← 退出</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Image source={student.avatar} style={styles.headerAvatar} />
            <View>
              <Text style={styles.headerName}>{student.name}</Text>
              <Text style={styles.stageText}>{stageLabel}</Text>
            </View>
          </View>
          <View style={{ width: 60 }} />
        </View>

        {/* 共有ドック：オンライン授業の「画面共有」スロット。プリントは常にここから開ける */}
        <View style={styles.dockRow}>
          {printItems.length > 0 && (() => {
            const marked = printItems.filter((it) => it.teacherMark !== undefined).length
            const wrongs = printItems.filter((it) => it.teacherMark === false)
            const explained = wrongs.filter((it) => it.redPen !== undefined).length
            const dockLabel =
              printStage === 'grading' ? `丸付け ${marked}/${printItems.length}`
              : printStage === 'redpen' ? `赤ペン ${explained}/${wrongs.length}`
              : printStage === 'check' ? '答え合わせ中'
              : '添削ずみ'
            return (
              <TouchableOpacity style={styles.printDock} onPress={() => setShowPrint(true)} activeOpacity={0.8}>
                <Image source={require('../assets/print.webp')} style={{ width: 15, height: 15 }} resizeMode="contain" />
                <Text style={styles.printDockText} numberOfLines={1}>共有中：プリント</Text>
                <View style={styles.printDockChip}><Text style={styles.printDockChipText}>{dockLabel}</Text></View>
              </TouchableOpacity>
            )
          })()}
          <TouchableOpacity style={styles.previewDock} onPress={() => router.push('/preview')} activeOpacity={0.8}>
            <Feather name="book-open" size={14} color={c.textMid} />
            <Text style={styles.previewBarText}>教材を見る</Text>
          </TouchableOpacity>
        </View>

        {/* チャット（生徒のセリフ＋プリントカード） */}
        <ScrollView
          ref={scrollRef}
          style={styles.messages}
          contentContainerStyle={styles.messagesContent}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {chatMessages.map((msg, i) => (
            <View key={i} style={[styles.bubble, msg.role === 'user' ? styles.bubbleUser : styles.bubbleMana]}>
              {msg.role === 'mana' && (
                <Image source={student.avatar} style={styles.bubbleAvatar} />
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
          {/* プリントカード（授業のはじめに生徒から届く。タップで採点／見返し） */}
          {printItems.length > 0 && chatMessages.length > 0 && (
            <View style={[styles.bubble, styles.bubbleMana]}>
              <Image source={student.avatar} style={styles.bubbleAvatar} />
              <TouchableOpacity onPress={() => setShowPrint(true)} style={styles.notebookCard}>
                <View style={styles.notebookCardPaper}>
                  <Text style={styles.notebookCardTitle} numberOfLines={1}>一問一答プリント</Text>
                  {/* ライブドキュメント：採点の○✕がその場で書き込まれていく */}
                  {printItems.slice(0, 3).map((it, i) => {
                    const mark = it.finalMark ?? it.teacherMark
                    return (
                      <Text key={i} style={styles.notebookCardLine} numberOfLines={1}>
                        <Text style={{ fontWeight: '700', color: mark === undefined ? c.paperLine : mark ? '#059669' : '#e11d48' }}>
                          {mark === undefined ? '・' : mark ? '○' : '✕'}
                        </Text>
                        {' '}{it.question}
                      </Text>
                    )
                  })}
                  <Text style={styles.notebookCardLine}>…</Text>
                </View>
                <Text style={styles.notebookCardAction}>
                  {printStage === 'grading' ? 'タップして採点する' : printStage === 'done' ? '添削済みのプリントを見る' : 'プリントを見る'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
          {studentTyping && (
            <View style={[styles.bubble, styles.bubbleMana]}>
              <Image source={student.avatar} style={styles.bubbleAvatar} />
              <TypingPaws />
            </View>
          )}
          {printStage === 'done' && !studentTyping && (
            <View style={styles.endedActions}>
              <Text style={styles.endedLabel}>今日の授業は終わりました！</Text>
              <TouchableOpacity style={styles.finishBtn} onPress={handleBack}>
                <Text style={styles.finishBtnText}>ホームに戻る</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>

        {/* アクションバー：丸付け・答え合わせはボタン、赤ペンラリー中はチャット入力欄になる */}
        {printStage !== 'done' && (
          <View style={styles.actionBar}>
            {studentTyping ? (
              <Text style={styles.actionWaiting}>{student.name}が書いています…</Text>
            ) : printStage === 'grading' ? (
              <BouncyPressable style={[styles.actionBtn, { backgroundColor: student.colorStrong }]} onPress={() => setShowPrint(true)} haptic="light">
                <Text style={styles.actionBtnText}>プリントを採点する</Text>
              </BouncyPressable>
            ) : printStage === 'redpen' ? (
              (() => {
                const current = printItems.map((it, i) => ({ it, i })).find(({ it }) => it.teacherMark === false && it.redPen === undefined)
                if (!current) return <Text style={styles.actionWaiting}>プリントを返しています…</Text>
                return (
                  <View>
                    {(current.it.choices?.length ?? 0) > 0 && (
                      <View style={{ marginBottom: 8, gap: 6 }}>
                        <TouchableOpacity
                          onPress={() => setShowRedpenHints((v) => !v)}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                        >
                          <Image source={require('../assets/toranomaki.webp')} style={{ width: 16, height: 16 }} resizeMode="contain" />
                          <Text style={styles.hintToggleText}>虎の巻を開く {showRedpenHints ? '▲' : '▼'}</Text>
                        </TouchableOpacity>
                        {showRedpenHints && (
                          <>
                            <Text style={styles.hintNote}>1つが正解、2つが誤りです。タップすると入力欄に写せます</Text>
                            {current.it.choices!.map((choice, k) => (
                              <TouchableOpacity key={k} onPress={() => setRedpenInput(choice)} style={styles.hintItem}>
                                <Text style={styles.hintItemText}>{choice}</Text>
                              </TouchableOpacity>
                            ))}
                          </>
                        )}
                      </View>
                    )}
                    <View style={styles.inputRow}>
                      <TextInput
                        style={styles.input}
                        value={redpenInput}
                        onChangeText={setRedpenInput}
                        placeholder="ひとことで教えてあげよう…"
                        placeholderTextColor={c.faint}
                        multiline
                        maxLength={200}
                      />
                      <BouncyPressable
                        style={[styles.sendBtn, (!redpenInput.trim() || redpenSending) && styles.sendBtnDisabled]}
                        onPress={sendRedpenChat}
                        disabled={!redpenInput.trim() || redpenSending}
                        haptic="light"
                      >
                        <Text style={styles.sendBtnText}>送信</Text>
                      </BouncyPressable>
                    </View>
                    {redpenError && (
                      <Text style={styles.ngWarning}><Feather name="alert-triangle" size={12} color={c.danger} /> {redpenError}</Text>
                    )}
                  </View>
                )
              })()
            ) : (
              <BouncyPressable style={[styles.actionBtn, { backgroundColor: '#f59e0b' }]} onPress={() => setShowCheck(true)} haptic="light">
                <Text style={styles.actionBtnText}>答え合わせをする</Text>
              </BouncyPressable>
            )}
          </View>
        )}

        {/* プリントモーダル（第1段：丸付け／終了後：添削済みの見返し） */}
        <Modal
          visible={showPrint && printItems.length > 0}
          transparent
          animationType="fade"
          onRequestClose={() => setShowPrint(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.notebookModal}>
              <View style={styles.notebookModalHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Image source={require('../assets/print.webp')} style={{ width: 18, height: 18 }} resizeMode="contain" />
                  <Text style={styles.notebookModalTitle}>{student.name}のプリント</Text>
                </View>
                <TouchableOpacity onPress={() => setShowPrint(false)} hitSlop={8}>
                  <Text style={styles.notebookModalClose}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.notebookScroll}>
                {printStage === 'grading' && (
                  <Text style={styles.notebookGradeHint}>
                    模範解答は見ずに、先生の記憶だけで採点します。合っていたら <Text style={styles.gradeMarkO}>○</Text>、ちがえば <Text style={styles.gradeMarkX}>✕</Text> をつけてね。
                  </Text>
                )}
                <View style={styles.notebookPaper}>
                  <Text style={styles.notebookTitle}>一問一答プリント</Text>
                  {printItems.map((it, i) => {
                    const isGrading = printStage === 'grading'
                    const showAnswers = printStage === 'done' // 途中段階で模範解答を見せない（赤ペンは純粋想起で書く）
                    const mark = it.finalMark ?? it.teacherMark
                    return (
                      <View key={i} style={styles.notebookLineRow}>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4 }}>
                            <Text style={[styles.printQuestion, { flex: 1 }]}>
                              <Text style={{ fontWeight: '700' }}>問{i + 1} </Text>{it.question}
                            </Text>
                            {it.isReview && <View style={styles.reviewBadge}><Text style={styles.reviewBadgeText}>復習</Text></View>}
                          </View>
                          <Text style={styles.notebookLineText}>
                            <Text style={styles.notebookPenMark}>✎ </Text>{it.studentAnswer}
                          </Text>
                          {showAnswers && (
                            <Text style={styles.notebookReference}>
                              <Text style={styles.notebookReferenceMark}>答 </Text>{it.modelAnswer}
                            </Text>
                          )}
                          {showAnswers && (it.redPen || it.flipNote) ? (
                            <Text style={styles.redpenLine}>
                              <Text style={styles.notebookReferenceMark}>赤ペン </Text>{it.redPen ?? it.flipNote}
                            </Text>
                          ) : null}
                        </View>
                        {isGrading ? (
                          <View style={styles.markRow}>
                            <TouchableOpacity onPress={() => setPrintMark(i, true)} style={[styles.markBtn, it.teacherMark === true && styles.markBtnCorrect]}>
                              <StampText active={it.teacherMark === true} style={[styles.markBtnText, it.teacherMark === true && styles.markBtnTextSel]}>○</StampText>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => setPrintMark(i, false)} style={[styles.markBtn, it.teacherMark === false && styles.markBtnWrong]}>
                              <StampText active={it.teacherMark === false} style={[styles.markBtnText, it.teacherMark === false && styles.markBtnTextSel]}>✕</StampText>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          mark !== undefined && (
                            <Text style={[styles.notebookMarkResult, { color: mark ? '#059669' : '#e11d48' }]}>
                              {mark ? '○' : '✕'}
                            </Text>
                          )
                        )}
                      </View>
                    )
                  })}
                </View>
              </ScrollView>
              <View style={styles.notebookModalFooter}>
                {printStage === 'grading' ? (() => {
                  const allGraded = printItems.every((it) => it.teacherMark !== undefined)
                  return (
                    <BouncyPressable onPress={() => { if (allGraded) returnPrint() }} style={[styles.returnBtn, !allGraded && styles.returnBtnDisabled]} haptic="success">
                      <Text style={[styles.gradeBtnText, !allGraded && styles.gradeBtnTextDisabled]}>
                        {allGraded ? '採点してプリントを返す' : <>すべての問題に <Text style={styles.gradeMarkO}>○</Text> か <Text style={styles.gradeMarkX}>✕</Text> をつけてね</>}
                      </Text>
                    </BouncyPressable>
                  )
                })() : (
                  <TouchableOpacity onPress={() => setShowPrint(false)} style={styles.closeNotebookBtn}>
                    <Text style={styles.closeNotebookBtnText}>閉じる</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        </Modal>

        {/* 答え合わせモーダル（第3段：採点のズレと説明のズレを一括解消。最終判断は常にユーザ） */}
        <Modal
          visible={showCheck && printStage === 'check'}
          transparent
          animationType="fade"
          onRequestClose={() => setShowCheck(false)}
        >
          <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.notebookModal}>
              <View style={styles.notebookModalHeader}>
                <Text style={styles.notebookModalTitle}>答え合わせ</Text>
                <TouchableOpacity onPress={() => setShowCheck(false)} hitSlop={8}>
                  <Text style={styles.notebookModalClose}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.notebookScroll} keyboardShouldPersistTaps="handled">
                {(() => {
                  const mismatches = printItems.map((it, i) => ({ it, i })).filter(({ it }) => hasGradeMismatch(it))
                  const diverged = printItems.map((it, i) => ({ it, i })).filter(({ it }) => it.redPenVerdict === 'diverge')
                  return (
                    <View style={{ gap: 14, paddingBottom: 8 }}>
                      {mismatches.length > 0 && (
                        <View>
                          <Text style={styles.notebookGradeHint}>
                            {student.name}が模範解答と見比べて気になった採点です。赤い<Text style={styles.modelAnswerWord}>答</Text>と見比べて、先生が最終判断してあげてね。
                          </Text>
                          <View style={{ gap: 10 }}>
                            {mismatches.map(({ it, i }) => (
                              <View key={i} style={styles.redpenItem}>
                                <Text style={styles.printQuestion}><Text style={{ fontWeight: '700' }}>問{i + 1} </Text>{it.question}</Text>
                                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4, marginTop: 2 }}>
                                  <Text style={[styles.redpenStudentAnswer, { flex: 1 }]}>✎ {it.studentAnswer}</Text>
                                  <Text style={{ fontSize: 14, fontWeight: '700', color: it.teacherMark ? '#059669' : '#e11d48' }}>{it.teacherMark ? '○' : '✕'}</Text>
                                </View>
                                <Text style={styles.notebookReference}>
                                  <Text style={styles.notebookReferenceMark}>答 </Text>{it.modelAnswer}
                                </Text>
                                <View style={styles.decisionRow}>
                                  {it.teacherMark === true ? (
                                    <>
                                      <TouchableOpacity onPress={() => setCheckDecision(i, false)} style={[styles.decisionBtn, it.finalMark === false && styles.decisionBtnWrong]}>
                                        <Text style={[styles.decisionBtnText, it.finalMark === false && styles.decisionBtnTextSel]}>✕に直す</Text>
                                      </TouchableOpacity>
                                      <TouchableOpacity onPress={() => setCheckDecision(i, true)} style={[styles.decisionBtn, it.finalMark === true && styles.decisionBtnCorrect]}>
                                        <Text style={[styles.decisionBtnText, it.finalMark === true && styles.decisionBtnTextSel]}>この答えでも○</Text>
                                      </TouchableOpacity>
                                    </>
                                  ) : (
                                    <>
                                      <TouchableOpacity onPress={() => setCheckDecision(i, true)} style={[styles.decisionBtn, it.finalMark === true && styles.decisionBtnCorrect]}>
                                        <Text style={[styles.decisionBtnText, it.finalMark === true && styles.decisionBtnTextSel]}>○に直す</Text>
                                      </TouchableOpacity>
                                      <TouchableOpacity onPress={() => setCheckDecision(i, false)} style={[styles.decisionBtn, it.finalMark === false && styles.decisionBtnWrong]}>
                                        <Text style={[styles.decisionBtnText, it.finalMark === false && styles.decisionBtnTextSel]}>やっぱり✕</Text>
                                      </TouchableOpacity>
                                    </>
                                  )}
                                </View>
                                {it.teacherMark === true && it.finalMark === false && (
                                  <View style={{ marginTop: 6, gap: 4 }}>
                                    <Text style={styles.hintNote}>「じゃあここも、ひとことだけ教えてください！」</Text>
                                    <TextInput
                                      value={flipNoteDrafts[i] ?? ''}
                                      onChangeText={(t) => setFlipNoteDrafts((prev) => ({ ...prev, [i]: t }))}
                                      placeholder="ひとことで教えてあげよう…"
                                      placeholderTextColor={c.faint}
                                      multiline
                                      maxLength={200}
                                      style={styles.redpenInput}
                                    />
                                  </View>
                                )}
                              </View>
                            ))}
                          </View>
                        </View>
                      )}
                      {diverged.length > 0 && (
                        <View>
                          <Text style={styles.notebookGradeHint}>
                            「先生の説明、模範解答とちょっとちがう気がして…」——赤ペンと模範解答を見比べて、1タップで答えてあげてね。
                          </Text>
                          <View style={{ gap: 10 }}>
                            {diverged.map(({ it, i }) => (
                              <View key={i} style={styles.redpenItem}>
                                <Text style={styles.printQuestion}><Text style={{ fontWeight: '700' }}>問{i + 1} </Text>{it.question}</Text>
                                <Text style={[styles.redpenLine, { marginTop: 2 }]}>
                                  <Text style={styles.notebookReferenceMark}>赤ペン </Text>{it.redPen}
                                </Text>
                                <Text style={styles.notebookReference}>
                                  <Text style={styles.notebookReferenceMark}>答 </Text>{it.modelAnswer}
                                </Text>
                                <View style={styles.decisionRow}>
                                  <TouchableOpacity onPress={() => setRedpenDecision(i, 'relearn')} style={[styles.decisionBtn, it.redPenFinal === 'relearn' && styles.decisionBtnRelearn]}>
                                    <Text style={[styles.decisionBtnText, it.redPenFinal === 'relearn' && styles.decisionBtnTextSel]}>模範解答で覚え直す</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity onPress={() => setRedpenDecision(i, 'ok')} style={[styles.decisionBtn, it.redPenFinal === 'ok' && styles.decisionBtnCorrect]}>
                                    <Text style={[styles.decisionBtnText, it.redPenFinal === 'ok' && styles.decisionBtnTextSel]}>同じ意味だからOK</Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                            ))}
                          </View>
                        </View>
                      )}
                    </View>
                  )
                })()}
              </ScrollView>
              <View style={styles.notebookModalFooter}>
                {(() => {
                  const mismatches = printItems.map((it, i) => ({ it, i })).filter(({ it }) => hasGradeMismatch(it))
                  const diverged = printItems.map((it, i) => ({ it, i })).filter(({ it }) => it.redPenVerdict === 'diverge')
                  const flipsNeedingNote = printItems.map((it, i) => ({ it, i })).filter(({ it }) => it.teacherMark === true && it.finalMark === false)
                  const canFinish =
                    mismatches.every(({ it }) => it.finalMark !== undefined) &&
                    diverged.every(({ it }) => it.redPenFinal !== undefined) &&
                    flipsNeedingNote.every(({ i }) => (flipNoteDrafts[i] ?? '').trim().length > 0)
                  return (
                    <BouncyPressable
                      onPress={() => { if (canFinish) finishCheck() }}
                      style={[styles.returnBtn, !canFinish && styles.returnBtnDisabled]}
                      haptic="success"
                    >
                      <Text style={[styles.gradeBtnText, !canFinish && styles.gradeBtnTextDisabled]}>
                        {canFinish ? '答え合わせをおわる' : 'ぜんぶの項目に答えてあげてね'}
                      </Text>
                    </BouncyPressable>
                  )
                })()}
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
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
  headerName: { fontSize: 14, fontFamily: font.round, color: c.textStrong },
  stageText: { fontSize: 11, fontWeight: '600', color: c.textSub, marginTop: 1 },

  dockRow: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: c.border,
  },
  printDock: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 10,
    paddingVertical: 7, paddingHorizontal: 8,
  },
  printDockText: { fontSize: 12, fontWeight: '700', color: '#92400e', flexShrink: 1 },
  printDockChip: { backgroundColor: 'rgba(255,255,255,0.85)', borderWidth: 1, borderColor: '#fde68a', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  printDockChipText: { fontSize: 10, fontWeight: '700', color: '#b45309' },
  previewDock: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: c.skyTint, borderWidth: 1, borderColor: c.skyBorder, borderRadius: 10,
    paddingVertical: 7, paddingHorizontal: 8,
  },
  previewBarText: { fontSize: 13, fontWeight: '700', color: c.link },

  messages: { flex: 1, backgroundColor: 'transparent' },
  messagesContent: { paddingHorizontal: 16, paddingVertical: 16, gap: 12 },

  bubble: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubbleUser: { justifyContent: 'flex-end' },
  bubbleMana: { justifyContent: 'flex-start' },
  bubbleAvatar: { width: 32, height: 32, borderRadius: 16, marginBottom: 2 },
  bubbleText: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleTextUser: { backgroundColor: c.primaryStrong },
  bubbleTextMana: { backgroundColor: 'white' },
  msgText: { fontSize: 14, color: c.textStrong, lineHeight: 21 },
  msgTextUser: { color: 'white' },

  retryBtn: { ...btn.secondary, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 9 },
  retryBtnText: { ...btn.secondaryText, fontSize: 13 },

  notebookCard: {
    width: 210, backgroundColor: 'white', borderRadius: 16,
    borderWidth: 2, borderColor: c.border, padding: 10,
  },
  notebookCardPaper: {
    backgroundColor: c.paper, borderRadius: 10,
    borderWidth: 1, borderColor: c.paperBorder,
    paddingHorizontal: 10, paddingVertical: 8, overflow: 'hidden',
  },
  notebookCardTitle: { fontSize: 10, fontWeight: '700', color: c.textSub, marginBottom: 3 },
  notebookCardLine: {
    fontSize: 10, color: c.textSub, lineHeight: 18,
    borderBottomWidth: 1, borderBottomColor: c.paperLine + '80',
  },
  notebookCardAction: { marginTop: 7, fontSize: 12, fontWeight: '700', color: c.primary, textAlign: 'center' },

  actionBar: {
    backgroundColor: 'white', borderTopWidth: 1, borderTopColor: c.border,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  actionBtn: { borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  actionBtnText: { color: 'white', fontFamily: font.round, fontSize: 14 },
  actionWaiting: { fontSize: 12, color: c.faint, textAlign: 'center', paddingVertical: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1, backgroundColor: c.bg, borderRadius: 12,
    borderWidth: 1, borderColor: c.border,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, color: c.textStrong, maxHeight: 100,
  },
  sendBtn: { backgroundColor: '#f43f5e', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: 'white', fontFamily: font.round, fontSize: 14 },

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
  notebookModalTitle: { fontSize: 14, fontFamily: font.round, color: c.textStrong },
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
  printQuestion: { fontSize: 11.5, color: c.textSub, lineHeight: 17 },
  reviewBadge: { backgroundColor: '#fde68a', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  reviewBadgeText: { fontSize: 9, fontWeight: '700', color: '#92400e' },
  notebookLineText: { fontSize: 13, color: c.text, lineHeight: 20, fontWeight: '600', marginTop: 2 },
  notebookPenMark: { color: c.textSub, fontWeight: '400' },
  notebookLineRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderBottomWidth: 1, borderBottomColor: c.paperLine + 'cc',
    paddingVertical: 8,
  },
  notebookReference: { fontSize: 11, color: '#e11d48', lineHeight: 17, marginTop: 3 },
  notebookReferenceMark: { fontWeight: '700' },
  redpenLine: { fontSize: 11, color: '#be123c', lineHeight: 17, marginTop: 3 },
  notebookMarkResult: { fontSize: 18, fontWeight: '700', paddingTop: 1 },
  notebookGradeHint: { fontSize: 12, color: c.textSub, lineHeight: 18, paddingTop: 12, paddingBottom: 8 },
  modelAnswerWord: { fontWeight: '700', color: '#e11d48' },
  gradeMarkO: { fontWeight: '700', color: '#10b981' },
  gradeMarkX: { fontWeight: '700', color: '#f43f5e' },
  markRow: { flexDirection: 'row', gap: 6 },
  markBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: c.borderStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  markBtnCorrect: { backgroundColor: '#10b981', borderColor: '#10b981' },
  markBtnWrong: { backgroundColor: '#f43f5e', borderColor: '#f43f5e' },
  markBtnText: { fontSize: 16, fontWeight: '700', color: c.borderStrong },
  markBtnTextSel: { color: '#fff' },
  notebookModalFooter: { paddingHorizontal: 18, paddingTop: 12 },
  returnBtn: {
    backgroundColor: c.primaryStrong, borderRadius: 12,
    paddingVertical: 13, alignItems: 'center',
  },
  returnBtnDisabled: { backgroundColor: c.bgSub },
  gradeBtnText: { color: 'white', fontFamily: font.round, fontSize: 14 },
  gradeBtnTextDisabled: { color: c.faint },
  closeNotebookBtn: { ...btn.secondary, borderRadius: 12 },
  closeNotebookBtnText: { ...btn.secondaryText },

  redpenItem: {
    borderWidth: 1, borderColor: c.border, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  redpenStudentAnswer: { fontSize: 12.5, color: c.text, lineHeight: 19, fontWeight: '600' },
  redpenInput: {
    marginTop: 6, borderWidth: 1, borderColor: '#fecdd3', borderRadius: 10,
    backgroundColor: '#fff1f2', paddingHorizontal: 10, paddingVertical: 8,
    fontSize: 13, color: c.textStrong, minHeight: 44,
  },
  hintToggleText: { fontSize: 12, fontWeight: '600', color: c.paperText },
  hintNote: { fontSize: 11, color: c.textSub },
  hintItem: {
    borderWidth: 1, borderColor: c.paperLine, borderRadius: 12,
    backgroundColor: c.paper, paddingHorizontal: 14, paddingVertical: 10,
  },
  hintItemText: { fontSize: 13, color: c.text, lineHeight: 19 },
  ngWarning: { fontSize: 12, color: c.danger, textAlign: 'center', paddingBottom: 8 },

  decisionRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  decisionBtn: {
    flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 10,
    paddingVertical: 8, alignItems: 'center', backgroundColor: '#fff',
  },
  decisionBtnCorrect: { backgroundColor: '#10b981', borderColor: '#10b981' },
  decisionBtnWrong: { backgroundColor: '#f43f5e', borderColor: '#f43f5e' },
  decisionBtnRelearn: { backgroundColor: '#f59e0b', borderColor: '#f59e0b' },
  decisionBtnText: { fontSize: 12, fontWeight: '700', color: c.textSub },
  decisionBtnTextSel: { color: '#fff' },

  endedActions: { marginTop: 16, gap: 10 },
  endedLabel: { fontSize: 13, color: c.textSub, textAlign: 'center', fontWeight: '600' },
  finishBtn: { ...btn.secondary, borderRadius: 12, paddingVertical: 14 },
  finishBtnText: { ...btn.secondaryText },
})
