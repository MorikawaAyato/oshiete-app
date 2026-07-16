import {
  View, Text, TouchableOpacity, ScrollView, TextInput,
  StyleSheet, Image, KeyboardAvoidingView, Platform,
  Animated, Alert, Modal,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Fragment, useEffect, useRef, useState } from 'react'
import { useApp } from '@/lib/AppContext'
import { getStudentById } from '@/lib/students'
import { fetchPrint, fetchFactsheet } from '@/lib/api'
import {
  loadFactsheet, updateHistoryFactsheet, saveRecapToHistory,
  loadCardProgress, saveCardProgress, loadDrillPending, saveDrillPending, drillKey,
  splitUnits, defaultUnitIndex, getUnitStatuses, setUnitStatus,
} from '@/lib/storage'
import type { PrintItem, Recap } from '@/lib/types'
import { btn, c, font } from '@/lib/theme'
import { Feather } from '@expo/vector-icons'
import BouncyPressable from '@/components/BouncyPressable'
import PawGlyph from '@/components/PawGlyph'
import StampText from '@/components/StampText'

// プリント授業：教材のカードを順番どおり最大5問ずつの「授業単元」に分け、1回の授業で1単元を扱う。
// 流れは 丸付け→赤ペン→振り返り（模範解答との見くらべ）。単元を完了にするかは先生が決める

const NG_PATTERNS = [
  /死[にねの]/, /死んで/, /氏ね/,
  /[殺コロ][しすせそ]/, /ぶ[っ]?殺/,
  /ちんこ/i, /ちんちん/i, /まんこ/i, /おっぱい/i,
  /[セせ][ッっ][クく][スす]/, /エロ/i, /ポルノ/i, /フェラ/i, /手コキ/i, /オナニー/i,
]

function containsNG(text: string): boolean {
  return NG_PATTERNS.some((p) => p.test(text))
}

// 生成保険：仕込んだ「まちがい」答案が模範解答と実質同一だった場合は正解扱いに倒す
// （同一文に「模範解答とちがう」の印をつけて振り返らせるのは誤りのため）
function sameAsModel(answer: string, model: string): boolean {
  const norm = (t: string) => t.replace(/[\s　。、．，,.!！?？「」]/g, '')
  return norm(answer) === norm(model)
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
    `${student.name}がノートをかばんから出しています...`,
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
    lessonUnit, setLessonUnit,
    unitDecided, setUnitDecided,
    resetChatSession,
  } = useApp()
  const student = getStudentById(selectedStudentId ?? '')
  const scrollRef = useRef<ScrollView>(null)

  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState(false)
  const [studentTyping, setStudentTyping] = useState(false)
  const [showPrint, setShowPrint] = useState(false) // 学習ノート（1問1ページ）モーダル
  const [notePage, setNotePage] = useState(0) // ノートの表示ページ（＝問題番号）
  const [seenPages, setSeenPages] = useState<Set<number>>(new Set()) // 振り返りの既読ページ（全ページ見てから完了を判断）
  const [redpenInput, setRedpenInput] = useState('') // 赤ペンラリーの入力欄
  const [showRedpenHints, setShowRedpenHints] = useState(false) // いま聞かれている問題の虎の巻
  const [redpenError, setRedpenError] = useState<string | null>(null)

  // 生徒のセリフを入力中演出を挟んで1通ずつ届けるタイマー（画面を離れたら破棄）。
  // 文字列のほか、ノートの引用カード（noteRef）つきのセリフも配信できる
  type Beat = string | { text: string; noteRef?: number }
  const beatTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const pushBeats = (beats: Beat[]) => {
    beats.forEach((b, i) => {
      beatTimers.current.push(setTimeout(() => setStudentTyping(true), i * 2000 + 500))
      beatTimers.current.push(setTimeout(() => {
        setStudentTyping(false)
        setChatMessages(prev => [...prev, typeof b === 'string' ? { role: 'mana', text: b } : { role: 'mana', ...b }])
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)
      }, i * 2000 + 1800))
    })
  }
  useEffect(() => () => { beatTimers.current.forEach(clearTimeout) }, [])

  // 共有ドック：段が進むたびにぽんっと跳ねて目線を誘導する（カードではなくここが資料の定位置）
  const dockScale = useRef(new Animated.Value(1)).current
  useEffect(() => {
    dockScale.setValue(1.06)
    Animated.spring(dockScale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 9 }).start()
  }, [printStage])

  useEffect(() => {
    if (chatMessages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 100)
    }
  }, [])

  // 授業開始：選ばれた単元のカードからプリントを作り、答案（正誤つき）を生成して教室へ
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
      // 単元の確定：ホームで選ばれた単元、なければ最初の「完了でない」単元
      const units = splitUnits(cards.length)
      const statuses = await getUnitStatuses(currentHistoryId, cards.length)
      const unitIdx = Math.min(lessonUnit ?? defaultUnitIndex(cards.length, statuses), units.length - 1)
      const unit = units[unitIdx]
      const picked = cards.slice(unit.start, unit.start + unit.size).map((card, k) => ({ card, index: unit.start + k }))
      const res = await fetchPrint(
        student.id,
        picked.map((p) => ({ question: p.card.q, modelAnswer: p.card.a })),
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
        truth: sameAsModel(res.items![i].studentAnswer, p.card.a) ? 'correct' : res.items![i].truth,
        choices: (res.items![i].choices ?? []).slice(0, 3),
      }))
      // 初回（この教材のカードにまだ進度がない）だけ「さっき解いてもらったてい」の挨拶にする
      const progress = await loadCardProgress()
      const isFirst = !cards.some((cd) => progress[drillKey(cd)])
      setPrintItems(items)
      setPrintStage('grading')
      setLessonUnit(unitIdx)
      setUnitDecided(true)
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

  // セリフのテンプレ埋め（{n}=問番号 {q}=問題文。長い問題文は詰める）
  const fillAsk = (template: string, n: number, q: string) =>
    template.replace('{n}', String(n)).replace('{q}', q.length > 24 ? q.slice(0, 24) + '…' : q)

  // 授業の締め：カード進度・研修「まだ」・Recap・単元ステータス（実施済み）へ反映し、
  // お礼のあと振り返り（模範解答との見くらべ）を自動で開く。単元を完了にするかは振り返りの中で先生が決める
  const finishLesson = (items: PrintItem[], opts?: { leadBeats?: string[] }) => {
    if (!student) return
    setPrintItems(items)
    setPrintStage('done')
    setShowPrint(false)
    const now = Date.now()
    void (async () => {
      const [progress, drillPending] = await Promise.all([loadCardProgress(), loadDrillPending()])
      for (const it of items) {
        const prev = progress[it.cardKey]
        progress[it.cardKey] = { seen: (prev?.seen ?? 0) + 1, lastAt: now, lastResult: it.teacherMark === true }
        if (it.teacherMark === true) drillPending.delete(it.cardKey) // 研修の「まだ」は授業の○で解消する
      }
      await saveCardProgress(progress)
      await saveDrillPending(drillPending)
      // 単元はまず「実施済み」になる。「完了」に上げるかは振り返りのあとの先生の判断
      if (currentHistoryId && lessonUnit !== null) {
        const cardCount = (await loadFactsheet(currentHistoryId))?.cards?.length ?? 0
        if (cardCount > 0) await setUnitStatus(currentHistoryId, cardCount, lessonUnit, 'tried')
      }
      // 生徒プロフィールの記録（Recap）はプリント結果から機械生成（AIコール不要）
      if (currentHistoryId) {
        const recap: Recap = {
          savedAt: now,
          coveredTopics: items.map((it) => ({ topic: it.question.slice(0, 40), understanding: it.teacherMark ? ('high' as const) : ('low' as const) })),
          struggledPoints: items.filter((it) => !it.teacherMark).map((it) => it.modelAnswer).slice(0, 6),
          uncoveredTopics: [],
        }
        await saveRecapToHistory(currentHistoryId, student.id, recap)
      }
    })()
    // ○✕の集計はリザルトとして報告しない（誤答は仕込みなので演出上の数字）。感情のビートだけ残す
    const beats: string[] = [...(opts?.leadBeats ?? [])]
    if (items.every((it) => it.teacherMark === true)) beats.push(student.perfectLine)
    beats.push(student.printThanks)
    pushBeats(beats)
    // お礼が届いたら振り返りを自動で開く（模範解答との見くらべは授業の必須の締め）
    setUnitDecided(false)
    setSeenPages(new Set())
    beatTimers.current.push(setTimeout(() => { setNotePage(0); setShowPrint(true) }, beats.length * 2000 + 1300))
  }

  // 返却の処理：✕があれば赤ペンのラリーへ、無ければそのまま授業を締める。
  // 返却の一言はユーザが送る（アプリは先生の言葉を代筆しない。下書きまで）
  const performReturn = () => {
    const wrongs = printItems.map((it, i) => ({ it, i })).filter(({ it }) => it.teacherMark === false)
    if (wrongs.length > 0 && student) {
      setPrintStage('redpen')
      pushBeats([student.redpenRequest, { text: fillAsk(student.redpenAsk, wrongs[0].i + 1, wrongs[0].it.question), noteRef: wrongs[0].i }])
    } else {
      finishLesson(printItems)
    }
  }

  // チャット入力の用途：返却の一言／赤ペンのラリー
  const lessonAllMarked = printItems.length > 0 && printItems.every((it) => it.teacherMark !== undefined)
  const composeMode: 'return' | 'rally' | null =
    printStage === 'grading' && lessonAllMarked ? 'return'
    : printStage === 'redpen' ? 'rally'
    : null

  // 下書きは入力欄には入れず、プレースホルダーとして見せる（空のまま送信＝下書きが届く／書けば自分の言葉）。
  // 用途が切り替わったら入力欄を空にする
  const composeDraft = composeMode === 'return' ? 'まるつけできたよ。ノート、返すね！' : null
  const prevComposeRef = useRef<string | null>(null)
  useEffect(() => {
    if (composeMode === prevComposeRef.current) return
    prevComposeRef.current = composeMode
    setRedpenInput('')
  }, [composeMode])

  // 返却の送信（先生の発言は必ず先生が押して送る）
  const sendTeacherLine = () => {
    if (!student || studentTyping) return
    const text = redpenInput.trim() || (composeDraft ?? '')
    if (!text) return
    if (containsNG(text)) { setRedpenError('その内容は送信できません'); return }
    setRedpenError(null)
    setRedpenInput('')
    setChatMessages((prev) => [...prev, { role: 'user', text }])
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)
    if (composeMode === 'return') performReturn()
  }

  // 赤ペンラリー：✕の問題を生徒が1問ずつ聞いてくる。先生の返信で次の問いへ（相づちは定型＝AI待ちゼロ）
  const sendRedpenChat = () => {
    if (!student || studentTyping) return
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
      pushBeats([{ text: fillAsk(student.redpenAskNext, next.i + 1, next.it.question), noteRef: next.i }])
    } else {
      completeRally(items)
    }
  }

  // 赤ペンラリーの締め：ズレの判定はしない（授業の中の判定は先生の○✕だけ）。そのまま授業を締める
  const completeRally = (items: PrintItem[]) => {
    if (!student) return
    finishLesson(items, { leadBeats: [student.redpenClose] })
  }

  // 再開時の取りこぼし対策：赤ペンを全部書き終えた直後に中断されたセッションは、締めから続きを進める
  useEffect(() => {
    if (printStage !== 'redpen' || printItems.length === 0) return
    const pendingAsk = printItems.some((it) => it.teacherMark === false && it.redPen === undefined)
    if (!pendingAsk) completeRally(printItems)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printStage])

  // ノートを開く：段に応じて「いま見るべきページ」から開く
  const openNote = () => {
    let page = 0
    if (printStage === 'grading') {
      const idx = printItems.findIndex((it) => it.teacherMark === undefined)
      page = idx >= 0 ? idx : 0
    } else if (printStage === 'redpen') {
      const idx = printItems.findIndex((it) => it.teacherMark === false && it.redPen === undefined)
      page = idx >= 0 ? idx : 0
    }
    setNotePage(page)
    setShowPrint(true)
  }

  // 丸付け：○✕をつけたら自動で次のページへ（1画面1判断）。
  // つけ直し（見直し）のときは送らない。スタンプの余韻を見せてから送る
  const markAndAdvance = (i: number, val: boolean) => {
    const wasUnmarked = printItems[i]?.teacherMark === undefined
    setPrintItems((prev) => prev.map((it, j) => (j === i ? { ...it, teacherMark: val } : it)))
    if (wasUnmarked && i < printItems.length - 1) setTimeout(() => setNotePage(i + 1), 550)
  }

  // 振り返りの既読ページを記録（全ページを見てから「完了」を判断させる）
  useEffect(() => {
    if (!showPrint || printItems.length === 0) return
    const p = Math.min(notePage, printItems.length - 1)
    setSeenPages((prev) => (prev.has(p) ? prev : new Set(prev).add(p)))
  }, [notePage, showPrint, printItems.length])

  // 振り返りの締め：この単元を「完了」にするか「また今度」にするかは先生が決める
  const decideUnit = (done: boolean) => {
    if (currentHistoryId && lessonUnit !== null) {
      const histId = currentHistoryId
      const unitIdx = lessonUnit
      void (async () => {
        const cardCount = (await loadFactsheet(histId))?.cards?.length ?? 0
        if (cardCount > 0) await setUnitStatus(histId, cardCount, unitIdx, done ? 'done' : 'tried')
      })()
    }
    setUnitDecided(true)
    setShowPrint(false)
  }


  const handleBack = () => {
    if (chatMessages.length > 0 && printStage !== 'done') {
      Alert.alert(
        '授業をとちゅうでやめますか？',
        'やめると、このノートの丸付けはリセットされます。',
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
            <Text style={styles.errorText}><Feather name="alert-triangle" size={13} color={c.danger} /> ノートの用意ができませんでした。教材の準備中かもしれません。少し待ってからもう一度試してください</Text>
            <TouchableOpacity onPress={() => void initPrint()} style={styles.retryBtn}>
              <Text style={styles.retryBtnText}>もう一度接続する</Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    )
  }

  const stageLabel = printStage === 'done' ? '授業終了' : printStage === 'grading' ? 'ノートの丸付け中' : '赤ペンを待っています'

  // チャット内のプリントカード。提出時（先頭）と返却時（末尾）の2回だけ登場する
  const renderPrintCard = (label: string) => (
    <View style={[styles.bubble, styles.bubbleMana]}>
      <Image source={student.avatar} style={styles.bubbleAvatar} />
      <TouchableOpacity onPress={openNote} style={styles.notebookCard}>
        <View style={styles.notebookCardPaper}>
          <Text style={styles.notebookCardTitle} numberOfLines={1}>学習ノート</Text>
          {/* ライブドキュメント：採点の○✕がその場で書き込まれていく */}
          {printItems.slice(0, 3).map((it, i) => {
            const mark = it.teacherMark
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
        <Text style={styles.notebookCardAction}>{label}</Text>
      </TouchableOpacity>
    </View>
  )

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
          <TouchableOpacity onPress={() => router.push('/preview')} style={styles.headerMaterialBtn}>
            <Feather name="book-open" size={13} color={c.link} />
            <Text style={styles.headerMaterialText}>教材</Text>
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
            <Fragment key={i}>
              <View style={[styles.bubble, msg.role === 'user' ? styles.bubbleUser : styles.bubbleMana]}>
                {msg.role === 'mana' && (
                  <Image source={student.avatar} style={styles.bubbleAvatar} />
                )}
                <View style={[
                  styles.bubbleText,
                  msg.role === 'user' ? styles.bubbleTextUser : styles.bubbleTextMana,
                  { maxWidth: msg.role === 'user' ? '75%' : '80%' },
                ]}>
                  {/* ノートの引用カード：どの問題の話かをその場で見せ、タップでそのページに飛ぶ */}
                  {msg.role === 'mana' && msg.noteRef !== undefined && printItems[msg.noteRef] && (
                    <TouchableOpacity
                      onPress={() => { setNotePage(msg.noteRef!); setShowPrint(true) }}
                      style={styles.quoteCard}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.quoteCardQ}><Text style={{ fontWeight: '700' }}>問{msg.noteRef + 1}</Text> {printItems[msg.noteRef].question}</Text>
                      <Text style={styles.quoteCardA} numberOfLines={1}>✎ {printItems[msg.noteRef].studentAnswer}</Text>
                    </TouchableOpacity>
                  )}
                  <Text style={[styles.msgText, msg.role === 'user' && styles.msgTextUser]}>
                    {msg.text}
                  </Text>
                </View>
              </View>
              {/* プリントカードは「提出の瞬間」の位置に固定（毎回チャットの後ろに現れて目線を奪わない）。
                  以後のアクセスは共有ドックが受け持つ */}
              {i === 0 && printItems.length > 0 && renderPrintCard(printStage === 'grading' ? (composeMode === 'return' ? 'ノートをたしかめる' : 'タップして丸付けする') : 'ノートを見る')}
            </Fragment>
          ))}
          {studentTyping && (
            <View style={[styles.bubble, styles.bubbleMana]}>
              <Image source={student.avatar} style={styles.bubbleAvatar} />
              <TypingPaws />
            </View>
          )}
          {printStage === 'done' && !studentTyping && (
            <View style={styles.endedActions}>
              <Text style={styles.endedLabel}>{unitDecided ? '今日の授業は終わりました！' : 'さいごに振り返りをして、授業をしめくくろう'}</Text>
              <TouchableOpacity style={styles.reviewBtn} onPress={openNote}>
                <Text style={styles.reviewBtnText}>{unitDecided ? '今日の振り返りを見る' : '振り返りをひらく'}</Text>
              </TouchableOpacity>
              {unitDecided && (
                <TouchableOpacity style={styles.finishBtn} onPress={handleBack}>
                  <Text style={styles.finishBtnText}>ホームに戻る</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </ScrollView>

        {/* 手元ゾーン：届いたノート（作業中の答案）＋入力欄。上＝相手、下＝自分の手元 */}
        <View style={styles.actionBar}>
          {printStage !== 'done' && (
            <View>
              {(() => {
                const composerAsk = printItems.map((it, i) => ({ it, i })).find(({ it }) => it.teacherMark === false && it.redPen === undefined)
                const canCompose = !studentTyping && (composeMode === 'return' || (composeMode === 'rally' && !!composerAsk))
                const placeholder = studentTyping
                  ? `${student.name}が書いています…`
                  : composeMode === 'rally'
                    ? (composerAsk ? 'ひとことで教えてあげよう…' : 'ノートを返しています…')
                    : composeMode === 'return'
                      ? (composeDraft ?? '')
                      : 'ノートの丸付けがおわったら返せるよ'
                const guide = !studentTyping && composeMode === 'return'
                  ? 'そのまま送信でこの言葉が届くよ。書けば自分の言葉になるよ'
                  : null
                const handleSend = () => { if (composeMode === 'rally') sendRedpenChat(); else sendTeacherLine() }
                return (
                  <View>
                    {/* 虎の巻：入力の補助なので入力欄のそばに残す */}
                    {canCompose && composeMode === 'rally' && composerAsk && (composerAsk.it.choices?.length ?? 0) > 0 && (
                      <View style={{ marginBottom: 8, gap: 6 }}>
                        <TouchableOpacity onPress={() => setShowRedpenHints((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Image source={require('../assets/toranomaki.webp')} style={{ width: 16, height: 16 }} resizeMode="contain" />
                          <Text style={styles.hintToggleText}>虎の巻を開く {showRedpenHints ? '▲' : '▼'}</Text>
                        </TouchableOpacity>
                        {showRedpenHints && (
                          <>
                            <Text style={styles.hintNote}>1つが正解、2つが誤りです。タップすると入力欄に写せます</Text>
                            {composerAsk.it.choices!.map((choice, k) => (
                              <TouchableOpacity key={k} onPress={() => setRedpenInput(choice)} style={styles.hintItem}>
                                <Text style={styles.hintItemText}>{choice}</Text>
                              </TouchableOpacity>
                            ))}
                          </>
                        )}
                      </View>
                    )}
                    {guide && <Text style={[styles.hintNote, { marginBottom: 6 }]}>{guide}</Text>}
                    <View style={styles.inputRow}>
                      <TextInput
                        style={[styles.input, !canCompose && { backgroundColor: c.bgSub }]}
                        editable={canCompose}
                        value={redpenInput}
                        onChangeText={setRedpenInput}
                        placeholder={placeholder}
                        placeholderTextColor={c.faint}
                        multiline
                        maxLength={200}
                      />
                      <BouncyPressable
                        style={[styles.sendBtn, composeMode !== 'rally' && { backgroundColor: c.primaryStrong }, (!canCompose || (composeMode === 'rally' ? !redpenInput.trim() : !redpenInput.trim() && !composeDraft)) && styles.sendBtnDisabled]}
                        onPress={handleSend}
                        disabled={!canCompose || (composeMode === 'rally' ? !redpenInput.trim() : !redpenInput.trim() && !composeDraft)}
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
              })()}
            </View>
          )}
        </View>

        {/* 学習ノート（1問1ページ）：丸付け→メモ→振り返りが同じページに積もっていく */}
        <Modal
          visible={showPrint && printItems.length > 0}
          transparent
          animationType="fade"
          onRequestClose={() => setShowPrint(false)}
        >
          <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            {(() => {
              const total = printItems.length
              if (total === 0) return null
              const page = Math.min(notePage, total - 1)
              const it = printItems[page]
              const isGrading = printStage === 'grading'
              const showAnswers = printStage === 'done'
              const mark = it.teacherMark
              const memo = it.redPen
              // 訂正線：メモを受けて直した答案（振り返りでは✕すべて）
              const corrected = mark === false && (memo !== undefined || showAnswers)
              // 振り返りの強調：○をつけた答案が模範解答と食い違っているページだけ（見逃しの気づき）。
              // ✕のページは「ちがう」ことを先生がもう見抜いているので出さない（メモと模範解答のくらべに集中させる）
              const divergent = showAnswers && it.truth === 'wrong' && it.teacherMark === true
              const allMarked = printItems.every((p) => p.teacherMark !== undefined)
              const deciding = showAnswers && !unitDecided
              // 表示中のページは既読扱い（setSeenPagesの反映を待たない）
              const allSeen = printItems.every((_, j) => seenPages.has(j) || j === page)
              return (
                <View style={styles.notebookModal}>
                  <View style={styles.notebookModalHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Image source={require('../assets/print.webp')} style={{ width: 18, height: 18 }} resizeMode="contain" />
                      <Text style={styles.notebookModalTitle}>{showAnswers ? '今日の振り返り' : `${student.name}のノート`}</Text>
                    </View>
                    {/* 授業のしめくくり（完了の判断）が済むまでは✕で閉じずに、下の2択で締める */}
                    {!deciding && (
                      <TouchableOpacity onPress={() => setShowPrint(false)} hitSlop={8}>
                        <Text style={styles.notebookModalClose}>✕</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {/* ページ送り：番号は採点状態で色づき、模範解答とちがう答案のページには印（輪）がつく */}
                  <View style={styles.pageNav}>
                    <TouchableOpacity onPress={() => setNotePage(Math.max(0, page - 1))} disabled={page === 0} hitSlop={6}>
                      <Text style={[styles.pageNavArrow, page === 0 && styles.pageNavArrowDisabled]}>‹ 前</Text>
                    </TouchableOpacity>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {printItems.map((p, j) => {
                        const m = p.teacherMark
                        const dv = showAnswers && p.truth === 'wrong' && p.teacherMark === true
                        return (
                          <TouchableOpacity key={j} onPress={() => setNotePage(j)}
                            style={[styles.pageDot,
                              j === page ? styles.pageDotActive : m === undefined ? null : m ? styles.pageDotOk : styles.pageDotNg,
                              dv && styles.pageDotDiverge]}>
                            <Text style={[styles.pageDotText,
                              j === page ? { color: '#fff' } : m === undefined ? null : m ? { color: '#059669' } : { color: '#e11d48' }]}>{j + 1}</Text>
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                    <TouchableOpacity onPress={() => setNotePage(Math.min(total - 1, page + 1))} disabled={page === total - 1} hitSlop={6}>
                      <Text style={[styles.pageNavArrow, page === total - 1 && styles.pageNavArrowDisabled]}>次 ›</Text>
                    </TouchableOpacity>
                  </View>
                  <ScrollView style={styles.notebookScroll} keyboardShouldPersistTaps="handled">
                    {isGrading && (
                      <Text style={styles.notebookGradeHint}>
                        模範解答は見ずに、先生の記憶だけで採点します。<Text style={styles.gradeMarkO}>○</Text> か <Text style={styles.gradeMarkX}>✕</Text> をつけると次のページへ進みます。
                      </Text>
                    )}
                    {showAnswers && (
                      <Text style={styles.notebookGradeHint}>
                        自分の採点・メモを、赤い<Text style={styles.modelAnswerWord}>模範解答</Text>と見くらべて振り返ろう。<Text style={styles.modelAnswerWord}>○なのに模範解答とちがう答案</Text>には印がついているよ。
                      </Text>
                    )}
                    <View style={[styles.notebookPaper, { marginBottom: 12 }]}>
                      {/* ちがいの印はページの先頭に置く（下までスクロールしなくても気づけるように） */}
                      {divergent && (
                        <View style={[styles.divergeTag, { marginTop: 0, marginBottom: 10 }]}><Text style={styles.divergeTagText}>この答案は、模範解答とちがうよ</Text></View>
                      )}
                      <Text style={styles.printQuestion}>
                        <Text style={{ fontWeight: '700' }}>問{page + 1} </Text>{it.question}
                      </Text>
                      {/* 生徒の答案（手書き）。メモで訂正した答案には訂正線が入る */}
                      <Text style={[styles.memoLabel, { marginTop: 10 }]}>生徒の答案</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 2 }}>
                        <Text style={[styles.handAnswer, { flex: 1 }, corrected && styles.handAnswerCorrected]}>{it.studentAnswer}</Text>
                        {mark !== undefined && (
                          <StampText active style={[styles.pageMark, { color: mark ? '#059669' : '#e11d48' }]}>{mark ? '○' : '✕'}</StampText>
                        )}
                      </View>
                      {/* 丸付けボタン（つけたら自動で次ページへ） */}
                      {isGrading && (
                        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 12 }}>
                          <TouchableOpacity onPress={() => markAndAdvance(page, true)} style={[styles.bigMarkBtn, it.teacherMark === true && styles.markBtnCorrect]}>
                            <Text style={[styles.bigMarkBtnText, it.teacherMark === true && styles.markBtnTextSel]}>○</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => markAndAdvance(page, false)} style={[styles.bigMarkBtn, it.teacherMark === false && styles.markBtnWrong]}>
                            <Text style={[styles.bigMarkBtnText, it.teacherMark === false && styles.markBtnTextSel]}>✕</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                      {/* 生徒のメモ（先生の説明の書き取り。直しは青ペン） */}
                      {memo !== undefined && (
                        <View style={styles.memoBlock}>
                          <Text style={styles.memoLabel}>先生から教わったこと</Text>
                          <Text style={styles.memoText}>{memo}</Text>
                        </View>
                      )}
                      {/* 模範解答（振り返りで現れる）。ちがいの印はページ先頭に出す（先生の採点の正誤は言わない） */}
                      {showAnswers && (
                        <Text style={[styles.notebookReference, { marginTop: 10 }]}>
                          <Text style={styles.notebookReferenceMark}>模範解答 </Text>{it.modelAnswer}
                        </Text>
                      )}
                    </View>
                  </ScrollView>
                  <View style={styles.notebookModalFooter}>
                    {isGrading ? (
                      <BouncyPressable onPress={() => { if (allMarked) setShowPrint(false) }} style={[styles.returnBtn, !allMarked && styles.returnBtnDisabled]} haptic="success">
                        <Text style={[styles.gradeBtnText, !allMarked && styles.gradeBtnTextDisabled]}>
                          {allMarked ? '丸付けおわり！チャットで返す' : <>すべての問題に <Text style={styles.gradeMarkO}>○</Text> か <Text style={styles.gradeMarkX}>✕</Text> をつけてね</>}
                        </Text>
                      </BouncyPressable>
                    ) : deciding ? (
                      allSeen ? (
                        <View style={{ gap: 8 }}>
                          {/* 単元を完了にするかどうかは先生の判断（アプリは事実だけ見せて、結論は言わない） */}
                          <Text style={styles.decideHint}>見なおしたら、先生としてこの授業をどうするか決めよう</Text>
                          <View style={styles.decisionRow}>
                            <TouchableOpacity onPress={() => decideUnit(false)} style={styles.decisionBtn}>
                              <Text style={styles.decisionBtnText}>また今度もう一度</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => decideUnit(true)} style={[styles.decisionBtn, styles.decisionBtnCorrect]}>
                              <Text style={[styles.decisionBtnText, styles.decisionBtnTextSel]}>この授業を完了にする</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : (
                        <View style={{ gap: 8 }}>
                          {/* 全ページを見てから完了を判断する。未読がある間はフッター自体がナビになる */}
                          <Text style={styles.decideHint}>ぜんぶのページを見なおしてから、しめくくりを決めよう</Text>
                          <BouncyPressable
                            onPress={() => {
                              const after = printItems.findIndex((_, k) => k > page && !seenPages.has(k))
                              const target = after >= 0 ? after : printItems.findIndex((_, k) => k !== page && !seenPages.has(k))
                              if (target >= 0) setNotePage(target)
                            }}
                            style={styles.returnBtn}
                            haptic="light"
                          >
                            <Text style={styles.gradeBtnText}>次のページへ ›</Text>
                          </BouncyPressable>
                        </View>
                      )
                    ) : (
                      <TouchableOpacity onPress={() => setShowPrint(false)} style={styles.closeNotebookBtn}>
                        <Text style={styles.closeNotebookBtnText}>閉じる</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              )
            })()}
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
  quoteCard: {
    backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 6, marginBottom: 8,
  },
  quoteCardQ: { fontSize: 11, color: c.textSub, lineHeight: 15 },
  quoteCardA: { fontFamily: font.hand, fontSize: 12, color: c.textMid, lineHeight: 18, marginTop: 1 },
  headerMaterialBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: c.skyTint, borderWidth: 1, borderColor: c.skyBorder, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 5,
  },
  headerMaterialText: { fontSize: 12, fontWeight: '700', color: c.link },
  noteStrip: {
    flex: 1, backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 12,
    paddingVertical: 8, paddingHorizontal: 10,
  },
  noteStripMain: { flex: 1, fontSize: 12, fontWeight: '700', color: c.textStrong },
  noteStripQuestion: { fontSize: 11.5, color: c.textSub, lineHeight: 16 },
  noteStripAnswer: { fontFamily: font.hand, fontSize: 13, color: c.textMid, lineHeight: 19, marginTop: 2, paddingLeft: 12 },
  noteStripChevron: { fontSize: 13, color: c.faint, fontWeight: '700' },
  printDockChip: { backgroundColor: 'rgba(255,255,255,0.85)', borderWidth: 1, borderColor: '#fde68a', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  printDockChipText: { fontSize: 10, fontWeight: '700', color: '#b45309' },
  previewDock: {
    width: 60, alignItems: 'center', justifyContent: 'center', gap: 3,
    backgroundColor: c.skyTint, borderWidth: 1, borderColor: c.skyBorder, borderRadius: 12,
    paddingVertical: 7, paddingHorizontal: 6,
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
  rallyContext: { borderWidth: 1, borderColor: c.border, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.7)', paddingHorizontal: 10, paddingVertical: 6, marginBottom: 8 },
  rallyContextText: { fontSize: 11.5, color: c.textSub, lineHeight: 17 },
  rallyContextAnswer: { fontFamily: font.hand, fontSize: 13, color: c.textMid, lineHeight: 20, marginTop: 1 },
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
  // 1問1ページのノート
  pageNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingBottom: 6 },
  pageNavArrow: { fontSize: 13, fontWeight: '700', color: c.textSub, paddingHorizontal: 6, paddingVertical: 2 },
  pageNavArrowDisabled: { color: c.border },
  pageDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: c.bgSub, alignItems: 'center', justifyContent: 'center' },
  pageDotActive: { backgroundColor: '#334155' },
  pageDotOk: { backgroundColor: '#d1fae5' },
  pageDotNg: { backgroundColor: '#ffe4e6' },
  pageDotDiverge: { borderWidth: 2, borderColor: '#fda4af' }, // 振り返り：模範解答とちがう答案のページの印
  pageDotText: { fontSize: 11, fontWeight: '700', color: c.faint },
  handAnswer: { fontFamily: font.hand, fontSize: 17, lineHeight: 26, color: c.textStrong },
  handAnswerCorrected: { color: c.faint, textDecorationLine: 'line-through', textDecorationColor: '#fb7185' },
  pageMark: { fontSize: 30, fontWeight: '700', lineHeight: 34 },
  bigMarkBtn: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: c.borderStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  bigMarkBtnText: { fontSize: 24, fontWeight: '700', color: c.borderStrong },
  memoBlock: { marginTop: 10, borderTopWidth: 1, borderTopColor: '#fcd34d', borderStyle: 'dashed', paddingTop: 8 },
  memoLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1, color: c.faint, marginBottom: 2 },
  memoText: { fontFamily: font.hand, fontSize: 14, lineHeight: 22, color: '#1e40af' },
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

  // 振り返り：模範解答とちがう答案の事実表示
  divergeTag: {
    marginTop: 10, borderWidth: 1, borderColor: '#fecdd3', backgroundColor: '#fff1f2',
    borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10, alignItems: 'center',
  },
  divergeTagText: { fontSize: 12, fontWeight: '700', color: '#f43f5e' },
  decideHint: { fontSize: 11, color: c.textSub, textAlign: 'center' },

  decisionRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  decisionBtn: {
    flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 10,
    paddingVertical: 8, alignItems: 'center', backgroundColor: '#fff',
  },
  decisionBtnCorrect: { backgroundColor: '#10b981', borderColor: '#10b981' },
  decisionBtnText: { fontSize: 12, fontWeight: '700', color: c.textSub },
  decisionBtnTextSel: { color: '#fff' },

  endedActions: { marginTop: 16, gap: 10 },
  endedLabel: { fontSize: 13, color: c.textSub, textAlign: 'center', fontWeight: '600' },
  reviewBtn: { backgroundColor: c.primaryStrong, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  reviewBtnText: { color: 'white', fontFamily: font.round, fontSize: 14 },
  finishBtn: { ...btn.secondary, borderRadius: 12, paddingVertical: 14 },
  finishBtnText: { ...btn.secondaryText },
})
