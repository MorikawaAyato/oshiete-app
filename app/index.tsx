import {
  View, Text, TouchableOpacity, ScrollView, Image,
  StyleSheet, ActivityIndicator, Alert, Animated, Modal, Pressable, TextInput,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import { BottomTabBar } from '@/components/BottomTabBar'
import { useEffect, useRef, useState, useCallback } from 'react'
import * as ImagePicker from 'expo-image-picker'
import { Feather } from '@expo/vector-icons'
import { useApp, LESSON_PRESETS, MINUTES_PER_TURN } from '@/lib/AppContext'
import { STUDENTS } from '@/lib/students'
import { TEACHER_AVATARS, TEACHER_TITLES, TEACHER_AVATAR_IMAGES, getTeacherAvatarImage, getUnlockedTitleCount, normalizeAvatarId } from '@/lib/teacherProfile'
import { analyzeImages, analyzeText, fetchPreviewContent, fetchFactsheet, fetchFollowupMail, fetchHomework, fetchHomeworkAnswers } from '@/lib/api'
import { needsFactsheetUpgrade } from '@/lib/factsheet'
import {
  loadHistory, saveToHistory, deleteFromHistory, updateHistoryPreview, updateHistoryFactsheet, HISTORY_MAX,
  loadSavedGroups, saveGroupsList, loadMail, saveMail, markMailRead, addMail,
  loadFollowupSent, saveFollowupSent, loadTeacherName,
  loadHomeworks, saveHomeworks, loadHomeworkWindow, saveHomeworkWindow, saveRecapToHistory,
} from '@/lib/storage'
import type { MailMessage, Homework, HomeworkItem, HomeworkWindow } from '@/lib/storage'
import type { HistoryItem, Recap } from '@/lib/types'
import { btn, c, font } from '@/lib/theme'
import BouncyPressable from '@/components/BouncyPressable'
import StampText from '@/components/StampText'

type ImageData = { data: string; mimeType: string; uri: string }

const MAX_IMAGES = 3

// あとから質問メール（間隔反復）：授業の2日後〜2週間以内のRecapが対象
const FOLLOWUP_MIN_AGE_MS = 2 * 24 * 60 * 60 * 1000
const FOLLOWUP_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

// 昇進試験：校長先生が一問一答バンクから出題する短答記述式テスト。合格で次の称号が解放される
const EXAM_QUESTION_COUNT = 5

// 先生アバターを円で大きく表示すると耳の高いキャラ（うさぎ・きつね）は耳が見切れるため、
// そのキャラだけ画像をごくわずかに下げて耳を収める（縦オフセットpx）
const AVATAR_ZOOM_NUDGE: Record<string, number> = { usagi: 15, kitsune: 11 }

// 宿題：ノート採点で❌にした項目から生成。半日後以降の起動で「届いた」状態になる
const HOMEWORK_ARRIVE_MS = 12 * 60 * 60 * 1000
const HOMEWORK_WINDOW_MS = 24 * 60 * 60 * 1000 // ノート採点から宿題を出せる猶予

export default function HomeScreen() {
  const router = useRouter()
  const {
    imageDescription, setImageDescription,
    setNotes,
    previewContent, setPreviewContent,
    selectedStudentId, setSelectedStudentId,
    teacherProfile, setTeacherProfile,
    thumbnails, setThumbnails,
    currentHistoryId, setCurrentHistoryId,
    pendingMaterialAnimation, setPendingMaterialAnimation,
    lessonMaxTurns, chooseLessonTurns,
    resetChatSession,
  } = useApp()

  // 授業の長さ選択（かっこ表記つき3択・選択は記憶される）
  const openTurnsPicker = () => {
    Alert.alert(
      '授業の長さ',
      '',
      [
        ...LESSON_PRESETS.map((p) => ({
          text: `${p.label}（やりとり${p.turns}回）${lessonMaxTurns === p.turns ? ' ✓' : ''}`,
          onPress: () => chooseLessonTurns(p.turns),
        })),
        { text: 'キャンセル', style: 'cancel' as const },
      ],
    )
  }

  const [analyzing, setAnalyzing] = useState(false)
  const [inputMode, setInputMode] = useState<'photo' | 'text'>('photo')
  const [textInput, setTextInput] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null)
  const [pendingImages, setPendingImages] = useState<ImageData[]>([])
  const [studentSheet, setStudentSheet] = useState<'profile' | 'picker' | null>(null)
  const [teacherSheet, setTeacherSheet] = useState(false)
  const [showTeacherAvatar, setShowTeacherAvatar] = useState(false)
  const [showStudentAvatar, setShowStudentAvatar] = useState(false)
  const [cardFlipped, setCardFlipped] = useState(false)
  const [mailMessages, setMailMessages] = useState<MailMessage[]>([])
  const [showInbox, setShowInbox] = useState(false)
  const [expandedMailId, setExpandedMailId] = useState<string | null>(null)
  const flipScaleAnim = useRef(new Animated.Value(1)).current

  const flipCard = (toFront?: boolean) => {
    const nextBack = toFront === true ? false : toFront === false ? true : !cardFlipped
    Animated.timing(flipScaleAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => {
      setCardFlipped(nextBack)
      Animated.timing(flipScaleAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start()
    })
  }

  const selectedStudent = STUDENTS.find(s => s.id === selectedStudentId) ?? null

  // ライブラリ等で currentHistoryId が変わったら activeHistoryId も追従させる（①）
  useEffect(() => { setActiveHistoryId(currentHistoryId) }, [currentHistoryId])

  const materialScale = useRef(new Animated.Value(1)).current
  const pendingAnimRef = useRef(pendingMaterialAnimation)
  useEffect(() => { pendingAnimRef.current = pendingMaterialAnimation }, [pendingMaterialAnimation])

  const triggerMaterialAnimation = useCallback(() => {
    materialScale.setValue(0.92)
    Animated.spring(materialScale, { toValue: 1, useNativeDriver: true, bounciness: 10, speed: 13 }).start()
  }, [])

  useFocusEffect(
    useCallback(() => {
      loadMail().then(setMailMessages)
      loadHomeworkWindow().then(setHomeworkWindow) // 授業終了後に開くウィンドウを反映
      loadHomeworks().then(setHomeworks) // 宿題の進行状況を反映
      if (pendingAnimRef.current) {
        setPendingMaterialAnimation(false)
        triggerMaterialAnimation()
      }
    }, [])
  )

  useEffect(() => {
    loadHistory().then(setHistory)
    loadMail().then(setMailMessages)
  }, [])

  // あとから質問メール：授業の数日後、生徒がつまずきを思い出して質問してくる（起動ごとに最大1通）
  const followupChecked = useRef(false)
  useEffect(() => {
    if (followupChecked.current) return
    followupChecked.current = true
    void (async () => {
      try {
        const [items, sent, teacherName] = await Promise.all([loadHistory(), loadFollowupSent(), loadTeacherName()])
        let best: { item: HistoryItem; studentId: string; recap: Recap; key: string } | null = null
        for (const item of items) {
          for (const [studentId, recap] of Object.entries(item.recaps ?? {})) {
            const age = Date.now() - recap.savedAt
            if (age < FOLLOWUP_MIN_AGE_MS || age > FOLLOWUP_MAX_AGE_MS) continue
            const key = `${item.id}_${studentId}_${recap.savedAt}`
            if (sent.has(key)) continue
            if (!best || recap.savedAt > best.recap.savedAt) best = { item, studentId, recap, key }
          }
        }
        if (!best) return
        const student = STUDENTS.find((s) => s.id === best!.studentId)
        if (!student) return
        const res = await fetchFollowupMail(best.studentId, best.item.title, best.recap, teacherName)
        if (!res.body) return
        const updated = await addMail({
          id: Date.now().toString(),
          type: 'student',
          from: student.name,
          studentId: student.id,
          subject: res.subject,
          content: res.body,
          timestamp: new Date().toISOString(),
          read: false,
          historyId: best.item.id,
        })
        setMailMessages(updated)
        sent.add(best.key)
        await saveFollowupSent(sent)
      } catch { /* メールは任意機能。失敗時は次回起動時に再挑戦 */ }
    })()
  }, [])

  // 昇進試験は研修タブ（/training）に移設。ここは受験可否の表示と遷移だけ担う
  const examCardPool = () => history.flatMap((h) => h.factsheet?.cards ?? [])

  const goToTraining = () => {
    setShowInbox(false)
    setExpandedMailId(null)
    setTeacherSheet(false)
    router.push('/training')
  }

  // 宿題の進行状態
  const [homeworks, setHomeworks] = useState<Homework[]>([])
  const [gradingHomework, setGradingHomework] = useState<Homework | null>(null) // 添削モーダルで開いている宿題
  const [hwGradeOpen, setHwGradeOpen] = useState(false)
  const [hwSending, setHwSending] = useState(false) // 宿題生成の通信中
  const [homeworkWindow, setHomeworkWindow] = useState<HomeworkWindow | null>(null)

  // まだ出題できる有効なウィンドウか（未失効・その生徒に進行中の宿題が無い・❌項目がある）
  const activeHomeworkWindow = (): HomeworkWindow | null => {
    if (!homeworkWindow) return null
    if (Date.now() - homeworkWindow.endedAt > HOMEWORK_WINDOW_MS) return null
    if (homeworks.some((h) => h.studentId === homeworkWindow.studentId)) return null
    const count = (homeworkWindow.items?.length ?? 0) + (homeworkWindow.wrongLines?.length ?? 0)
    if (count === 0) return null
    return homeworkWindow
  }

  // ❌項目から宿題を出す。カード紐付き（items）は生成済み、非カード（wrongLines）だけAPIで生成
  const sendHomework = async (w: HomeworkWindow) => {
    if (hwSending) return
    setHwSending(true)
    try {
      const material = history.find((h) => h.id === w.historyId)
      let items: HomeworkItem[] = []
      if ((w.items?.length ?? 0) > 0) {
        // カード直結：生徒の答案だけAPIでミックス生成（直せた答案が多め）。失敗時は誤解のままの答案で成立させる
        try {
          const res = await fetchHomeworkAnswers(
            w.studentId,
            w.items!.map((it) => ({ question: it.question, modelAnswer: it.modelAnswer, misconception: it.studentAnswer })),
          )
          items = res.items?.length ? res.items : [...w.items!]
        } catch {
          items = [...w.items!]
        }
      }
      if ((w.wrongLines?.length ?? 0) > 0) {
        const facts = material?.factsheet?.facts ?? []
        const res = await fetchHomework(w.studentId, w.wrongLines!, facts)
        if (res.items?.length) items = [...items, ...res.items]
        else if (items.length === 0) return // API生成が唯一の源で失敗したら中止（ウィンドウは残す）
      }
      if (items.length === 0) return
      const hw: Homework = {
        historyId: w.historyId,
        materialTitle: material?.title ?? '授業',
        studentId: w.studentId,
        items: items.slice(0, 5),
        assignedAt: Date.now(),
        state: 'assigned',
      }
      const next = [...homeworks.filter((h) => h.studentId !== hw.studentId), hw]
      await saveHomeworks(next)
      setHomeworks(next)
      await saveHomeworkWindow(null)
      setHomeworkWindow(null)
    } catch { /* 失敗時はウィンドウを残す */ }
    finally { setHwSending(false) }
  }

  // 起動時：宿題を読み込み、出題から半日たった答案待ちを「届いた」状態にしてメールで知らせる（答案は生成済み）
  const homeworkChecked = useRef(false)
  useEffect(() => {
    if (homeworkChecked.current) return
    homeworkChecked.current = true
    void (async () => {
      try {
        const list = await loadHomeworks()
        if (list.length === 0) return
        setHomeworks(list)
        const due = list.filter((h) => h.state === 'assigned' && Date.now() - h.assignedAt >= HOMEWORK_ARRIVE_MS)
        if (due.length === 0) return
        const updated = list.map((h) => due.includes(h) ? { ...h, state: 'arrived' as const } : h)
        for (const hw of due) {
          const student = STUDENTS.find((s) => s.id === hw.studentId)
          if (!student) continue
          const mails = await addMail({
            id: `homework-${hw.studentId}-${Date.now()}`,
            type: 'student',
            from: student.name,
            studentId: student.id,
            subject: '宿題やってきました！',
            content: `「${hw.materialTitle}」の宿題、がんばって解いてきました！みてもらえますか📝`,
            timestamp: new Date().toISOString(),
            read: false,
            homework: true,
          })
          setMailMessages(mails)
        }
        await saveHomeworks(updated)
        setHomeworks(updated)
      } catch { /* 失敗時は次回起動時に再挑戦 */ }
    })()
  }, [])

  const openHomeworkGrading = (hw: Homework) => {
    setGradingHomework(hw)
    setShowInbox(false)
    setExpandedMailId(null)
    setTimeout(() => setHwGradeOpen(true), 400)
  }

  // 宿題の各設問に⭕❌をつける（①化：模範解答と見比べて人間が採点）
  const setHwItemMark = (i: number, val: boolean) => {
    setGradingHomework((prev) => prev ? { ...prev, items: prev.items.map((it, j) => j === i ? { ...it, teacherMark: val } : it) } : prev)
  }

  const finishHomework = () => {
    if (gradingHomework) {
      // ❌（まだ誤解が残る）項目は、その生徒のrecapのつまずきポイントに書き戻し、次回授業で優先復習させる
      const hw = gradingHomework
      const stillWrong = hw.items.filter((it) => it.teacherMark === false).map((it) => it.modelAnswer)
      const recap = history.find((h) => h.id === hw.historyId)?.recaps?.[hw.studentId]
      if (stillWrong.length > 0 && recap) {
        const merged = [...new Set([...stillWrong, ...recap.struggledPoints])].slice(0, 6)
        void (async () => {
          await saveRecapToHistory(hw.historyId, hw.studentId, { ...recap, struggledPoints: merged })
          setHistory(await loadHistory())
        })()
      }
      const next = homeworks.filter((h) => h.studentId !== hw.studentId)
      void saveHomeworks(next)
      setHomeworks(next)
    }
    setGradingHomework(null)
    setHwGradeOpen(false)
  }

  useEffect(() => {
    if (!teacherSheet) {
      flipScaleAnim.setValue(1)
      setCardFlipped(false)
    }
  }, [teacherSheet])

  // シートが閉じたら入れ子の拡大表示も必ず閉じる（提示状態のズレ防止）
  useEffect(() => {
    if (!studentSheet) setShowStudentAvatar(false)
  }, [studentSheet])

  const hasPending = pendingImages.length > 0
  const hasContent = !!imageDescription
  const unreadCount = mailMessages.filter((m) => !m.read).length

  const openPicker = async (mode: 'replace' | 'add') => {
    const remaining = mode === 'add' ? MAX_IMAGES - pendingImages.length : MAX_IMAGES
    if (remaining <= 0) return
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('写真へのアクセスが必要です', '設定からカメラロールの許可をオンにしてください。')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      base64: true,
      quality: 0.8,
    })
    if (result.canceled || !result.assets.length) return

    const newImages: ImageData[] = result.assets.map(a => ({
      data: a.base64!,
      mimeType: a.mimeType ?? 'image/jpeg',
      uri: a.uri,
    }))

    if (mode === 'replace') {
      const clamped = newImages.slice(0, MAX_IMAGES)
      setPendingImages(clamped)
      setThumbnails(clamped.map(a => a.uri))
      setActiveHistoryId(null)
      setCurrentHistoryId(null)
      setPreviewContent(null)
      setImageDescription('')
      setNotes('')
    } else {
      const combined = [...pendingImages, ...newImages].slice(0, MAX_IMAGES)
      setPendingImages(combined)
      setThumbnails(combined.map(a => a.uri))
      setActiveHistoryId(null)
      setCurrentHistoryId(null)
      setPreviewContent(null)
      setImageDescription('')
      setNotes('')
    }
  }

  // ファクトシートをバックグラウンド生成して履歴に保存（失敗しても授業は劣化動作で成立する）
  const backgroundFetchFactsheet = async (desc: string, notesText: string, histId: string) => {
    try {
      const res = await fetchFactsheet(desc, notesText)
      if (res.factsheet) {
        await updateHistoryFactsheet(histId, res.factsheet)
        setHistory(await loadHistory())
      }
    } catch { /* ファクトシートは任意。失敗は無視 */ }
  }

  const backgroundFetchPreview = async (desc: string, histId: string) => {
    setPreviewLoading(true)
    const attempt = async () => {
      const content = await fetchPreviewContent(desc)
      if ((content as any).error) throw new Error(String((content as any).error))
      return content as any
    }
    try {
      let pc
      try {
        pc = await attempt()
      } catch {
        await new Promise(r => setTimeout(r, 2000))
        pc = await attempt()
      }
      setPreviewContent(pc)
      await updateHistoryPreview(histId, pc)
      setHistory(await loadHistory())
    } catch {
      // 両試行失敗 — 教材を見るボタン押下時にユーザが検知
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleTextAnalyze = async () => {
    const trimmed = textInput.trim()
    if (trimmed.length < 10) return
    setAnalyzing(true)
    resetChatSession()
    setNotes('')
    setImageDescription(trimmed)
    setThumbnails([])
    try {
      const currentHistory = await loadHistory()
      const groupMap: Record<string, string[]> = {}
      for (const item of currentHistory) {
        if (item.groupName) {
          if (!groupMap[item.groupName]) groupMap[item.groupName] = []
          groupMap[item.groupName].push(item.title)
        }
      }
      const existingGroups = Object.entries(groupMap).map(([groupName, titles]) => ({ groupName, titles }))

      const res = await analyzeText(trimmed, existingGroups)
      if (res.error) throw new Error(res.error)

      const finalTitle = res.title || trimmed.split('\n')[0].slice(0, 30) || 'テキスト教材'
      const finalDesc = res.imageDescription || trimmed
      const finalNotes = res.notes || ''

      setImageDescription(finalDesc)
      setNotes(finalNotes)

      let suggestedGroupName: string | undefined = res.suggestedGroupName || undefined
      if (suggestedGroupName) {
        try {
          const groups = await loadSavedGroups()
          if (!groups.includes(suggestedGroupName)) {
            await saveGroupsList([...groups, suggestedGroupName])
          }
        } catch {
          suggestedGroupName = undefined
        }
      }

      const saved = await saveToHistory({
        title: finalTitle,
        imageDescription: finalDesc,
        notes: finalNotes,
        thumbnails: [],
        groupName: suggestedGroupName,
      })
      setCurrentHistoryId(saved.id)
      setActiveHistoryId(saved.id)
      setHistory(await loadHistory())
      setTextInput('')
      triggerMaterialAnimation()
      void backgroundFetchFactsheet(finalDesc, finalNotes, saved.id)
    } catch {
      Alert.alert('エラー', '教材の読み込みに失敗しました。もう一度試してください。')
    } finally {
      setAnalyzing(false)
    }
  }

  const analyzeFromPending = async () => {
    if (!pendingImages.length) return
    setAnalyzing(true)
    resetChatSession()
    try {
      const images = pendingImages.map(({ data, mimeType }) => ({ data, mimeType }))
      const thumbs = pendingImages.map(a => a.uri)

      const currentHistory = await loadHistory()
      const groupMap: Record<string, string[]> = {}
      for (const item of currentHistory) {
        if (item.groupName) {
          if (!groupMap[item.groupName]) groupMap[item.groupName] = []
          groupMap[item.groupName].push(item.title)
        }
      }
      const existingGroups = Object.entries(groupMap).map(([groupName, titles]) => ({ groupName, titles }))

      const res = await analyzeImages(images, existingGroups)
      if (res.error) throw new Error(res.error)

      setImageDescription(res.imageDescription)
      setNotes(res.notes)
      setThumbnails(thumbs)

      let suggestedGroupName: string | undefined = res.suggestedGroupName || undefined
      if (suggestedGroupName) {
        try {
          const groups = await loadSavedGroups()
          if (!groups.includes(suggestedGroupName)) {
            await saveGroupsList([...groups, suggestedGroupName])
          }
        } catch {
          suggestedGroupName = undefined
        }
      }

      const title = res.imageDescription.split('。')[0].slice(0, 30)
      const saved = await saveToHistory({
        title,
        imageDescription: res.imageDescription,
        notes: res.notes,
        thumbnails: thumbs,
        groupName: suggestedGroupName,
      })
      setCurrentHistoryId(saved.id)
      setActiveHistoryId(saved.id)
      setHistory(await loadHistory())
      triggerMaterialAnimation()
      // 教材ビューはバンク（ファクトシート）から描画するため、旧プレビューの生成は行わない
      void backgroundFetchFactsheet(res.imageDescription, res.notes, saved.id)
    } catch (e) {
      console.error('analyzeFromPending error:', e)
      Alert.alert('エラー', '教材の読み込みに失敗しました。もう一度試してください。')
    } finally {
      setAnalyzing(false)
    }
  }

  const clearSelection = () => {
    setPendingImages([])
    setActiveHistoryId(null)
    setCurrentHistoryId(null)
    setImageDescription('')
    setNotes('')
    setPreviewContent(null)
    setThumbnails([])
    resetChatSession()
  }

  const selectHistory = (item: HistoryItem) => {
    if (activeHistoryId === item.id) return
    setPendingImages([])
    resetChatSession()
    setActiveHistoryId(item.id)
    setCurrentHistoryId(item.id)
    triggerMaterialAnimation()
    setImageDescription(item.imageDescription)
    setNotes(item.notes)
    setThumbnails(item.thumbnails)
    // 教材ビューはバンク描画が主。旧プレビューは保存済みのものだけフォールバック表示に使う（新規生成はしない）
    setPreviewContent(item.previewContent ?? null)
    // ファクトシート（一問一答バンク）が未生成・または旧版の教材はここで自動更新（FACTSHEET_AUTO_UPGRADE）
    if (needsFactsheetUpgrade(item.factsheet)) {
      void backgroundFetchFactsheet(item.imageDescription, item.notes, item.id)
    }
  }

  const handleDeleteHistory = (id: string) => {
    Alert.alert('削除', 'この教材を履歴から削除しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除',
        style: 'destructive',
        onPress: async () => {
          await deleteFromHistory(id)
          setHistory(await loadHistory())
          if (activeHistoryId === id) clearSelection()
        },
      },
    ])
  }

  const handlePreview = async () => {
    if (previewContent) { router.push('/preview'); return }
    if (previewLoading) return
    setPreviewLoading(true)
    try {
      const content = await fetchPreviewContent(imageDescription)
      if ((content as any).error) throw new Error(String((content as any).error))
      const pc = content as any
      setPreviewContent(pc)
      if (currentHistoryId) await updateHistoryPreview(currentHistoryId, pc)
      setHistory(await loadHistory())
      router.push('/preview')
    } catch {
      Alert.alert('エラー', '教材の読み込みに失敗しました。もう一度試してください。')
    } finally {
      setPreviewLoading(false)
    }
  }

  // 履歴に保存されたタイトルを優先（アップロード直後と履歴選択時でタイトルが食い違わないように）
  const shortTitle = (() => {
    const saved = history.find((h) => h.id === currentHistoryId)?.title
    const raw = saved ?? (imageDescription ? imageDescription.split('。')[0] : '')
    return raw ? raw.replace(/^この(教材|文書|画像|写真)は[、,，]?\s*/u, '').slice(0, 36) : ''
  })()

  const toastOpacity = useRef(new Animated.Value(0)).current
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = () => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    Animated.timing(toastOpacity, { toValue: 1, duration: 180, useNativeDriver: true }).start()
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start()
    }, 1800)
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* ヘッダー */}
        <View style={styles.header}>
          <View>
            <Text style={styles.appSubtitle}>せんせいごっこ</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <TouchableOpacity onPress={() => setShowTeacherAvatar(true)} activeOpacity={0.75}>
                <Image source={getTeacherAvatarImage(teacherProfile.avatarId)} style={{ width: 36, height: 36, borderRadius: 18 }} />
              </TouchableOpacity>
              <View style={{ gap: 1 }}>
                <Text style={styles.appTitle}>
                  {teacherProfile.name ? `${teacherProfile.name}先生` : '先生'}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.success }} />
                  <Text style={{ fontSize: 10, fontWeight: '700', color: c.successText }}>オンライン</Text>
                </View>
              </View>
            </View>
          </View>
          <View style={styles.headerIcons}>
            <TouchableOpacity style={styles.mailIconBtn} onPress={() => setShowInbox(true)}>
              <View style={styles.mailIconCircle}>
                <Feather name="mail" size={18} color={c.sky} />
              </View>
              <Text style={styles.teacherIconLabel}>メール</Text>
              {unreadCount > 0 && (
                <View style={styles.mailBadge}>
                  <Text style={styles.mailBadgeText}>{unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.teacherIconBtn} onPress={() => setTeacherSheet(true)}>
              <View style={styles.teacherIconCircle}>
                <Image source={require('../assets/senseishou.jpg')} style={styles.teacherIconImage} />
              </View>
              <Text style={styles.teacherIconLabel}>先生証</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 宿題ステータス：トップに常駐する時計スロット。
            優先度 答案の添削（arrived）＞ 宿題の受付（授業後の一定時間）＞ 答案待ち（assigned） */}
        {(() => {
          // ① いずれかの答案が届いている → その子の添削へ（複数届いていれば1件ずつ捌く）
          const arrived = homeworks.find((h) => h.state === 'arrived')
          if (arrived) {
            const st = STUDENTS.find((s) => s.id === arrived.studentId)
            return (
              <TouchableOpacity style={styles.hwBadge} onPress={() => openHomeworkGrading(arrived)} activeOpacity={0.85}>
                <View style={styles.hwBadgeIconWrap}><Text style={styles.hwBadgeClock}>📝</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.hwBadgeTitle}>{st?.name ?? '生徒'}から答案が届きました</Text>
                  <Text style={styles.hwBadgeSub} numberOfLines={1}>タップして添削してあげましょう</Text>
                </View>
                <Text style={styles.hwBadgeChevron}>›</Text>
              </TouchableOpacity>
            )
          }
          // ② 受付時間内で、その生徒にまだ宿題が無い → 復習の宿題を送る（タップで生成）
          const w = activeHomeworkWindow()
          if (w) {
            const st = STUDENTS.find((s) => s.id === w.studentId)
            return (
              <TouchableOpacity style={styles.hwBadge} onPress={() => void sendHomework(w)} disabled={hwSending} activeOpacity={0.85}>
                <View style={styles.hwBadgeIconWrap}><Text style={styles.hwBadgeClock}>⏰</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.hwBadgeTitle}>{hwSending ? '宿題を用意しています…' : '復習の宿題を送れます'}</Text>
                  <Text style={styles.hwBadgeSub} numberOfLines={1}>{st?.name ?? '生徒'}がつまずいた{(w.items?.length ?? 0) + (w.wrongLines?.length ?? 0)}個を宿題にします</Text>
                </View>
                <Text style={styles.hwBadgeChevron}>›</Text>
              </TouchableOpacity>
            )
          }
          // ③ 出題中（答案待ち）→ 出している生徒名を列挙（人数に依らず変数で表示）
          const waiting = homeworks.filter((h) => h.state === 'assigned')
          if (waiting.length > 0) {
            const names = waiting.map((h) => STUDENTS.find((s) => s.id === h.studentId)?.name ?? '生徒').join('、')
            return (
              <View style={[styles.hwBadge, styles.hwBadgeMuted]}>
                <View style={[styles.hwBadgeIconWrap, styles.hwBadgeIconMuted]}><Text style={styles.hwBadgeClock}>⏳</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.hwBadgeTitleMuted}>宿題を出しました</Text>
                  <Text style={styles.hwBadgeSubMuted} numberOfLines={1}>{names}の答案を待っています</Text>
                </View>
              </View>
            )
          }
          return null
        })()}

        {/* 今日の授業 */}
        <View style={styles.todaySection}>
          {/* 教材が用意できてから「次の授業」を表示する（作成中は出さない） */}
          {hasContent && (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>次の授業</Text>
              {/* カード内の「新しい教材を作る」と同一動作だったため、ここに一本化 */}
              <TouchableOpacity onPress={clearSelection}>
                <Text style={styles.sectionClear}>＋ 新しい教材を作る</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* 入力モード タブ */}
          {!hasContent && (
            <View style={styles.inputModeTabs}>
              <TouchableOpacity style={[styles.inputModeTab, styles.inputModeTabInner, inputMode === 'photo' && styles.inputModeTabActive]} onPress={() => { setInputMode('photo'); setTextInput('') }}>
                <Feather name="camera" size={15} color={inputMode === 'photo' ? 'white' : c.textSub} />
                <Text style={[styles.inputModeTabText, inputMode === 'photo' && styles.inputModeTabTextActive]}>写真</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.inputModeTab, styles.inputModeTabInner, inputMode === 'text' && styles.inputModeTabActive]} onPress={() => { setInputMode('text'); setPendingImages([]); setThumbnails([]) }}>
                <Feather name="file-text" size={15} color={inputMode === 'text' ? 'white' : c.textSub} />
                <Text style={[styles.inputModeTabText, inputMode === 'text' && styles.inputModeTabTextActive]}>テキスト</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* 状態1a: 写真 */}
          {!hasPending && !hasContent && inputMode === 'photo' && (
            <TouchableOpacity style={styles.uploadCard} onPress={() => openPicker('replace')}>
              <Feather name="camera" size={30} color={c.faint} style={{ marginBottom: 6 }} />
              <Text style={styles.uploadCardText}>教材の写真を選ぶ</Text>
              <Text style={styles.uploadCardSub}>PNG / JPG・最大{MAX_IMAGES}枚</Text>
            </TouchableOpacity>
          )}

          {/* 状態1b: テキスト入力 */}
          {!hasPending && !hasContent && inputMode === 'text' && (
            <View style={styles.textInputCard}>
              <TextInput
                style={styles.textInputArea}
                value={textInput}
                onChangeText={(t) => setTextInput(t.slice(0, 3000))}
                placeholder="テキストで入力する"
                placeholderTextColor={c.faint}
                multiline
                textAlignVertical="top"
              />
              <Text style={styles.textInputCount}>{textInput.length} / 3000字</Text>
              <BouncyPressable
                style={[styles.analyzeBtn, textInput.trim().length < 10 && styles.analyzeBtnLoading]}
                onPress={handleTextAnalyze}
                disabled={textInput.trim().length < 10}
                haptic="light"
              >
                <Text style={styles.analyzeBtnText}>この内容で教材を作る</Text>
              </BouncyPressable>
            </View>
          )}

          {/* 状態2: 写真選択済み・未分析 */}
          {hasPending && !hasContent && (
            <View style={styles.pendingCard}>
              <View style={styles.thumbRowWrap}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbRow}>
                  {pendingImages.map((img, i) => (
                    <Image key={i} source={{ uri: img.uri }} style={styles.thumb} />
                  ))}
                </ScrollView>
                <Text style={styles.thumbCounter}>{pendingImages.length}/{MAX_IMAGES}</Text>
              </View>
              <BouncyPressable
                style={[styles.analyzeBtn, analyzing && styles.analyzeBtnLoading]}
                onPress={analyzeFromPending}
                disabled={analyzing}
                haptic="light"
              >
                {analyzing ? (
                  <View style={styles.row}>
                    <ActivityIndicator color="white" />
                    <Text style={[styles.analyzeBtnText, { marginLeft: 8 }]}>読み込み中...</Text>
                  </View>
                ) : (
                  <Text style={styles.analyzeBtnText}>この写真で教材を作る</Text>
                )}
              </BouncyPressable>
              <View style={styles.photoActions}>
                {pendingImages.length < MAX_IMAGES && (
                  <>
                    <TouchableOpacity style={styles.photoActionBtn} onPress={() => openPicker('add')}>
                      <Text style={styles.photoActionText}>＋ 写真を追加する</Text>
                    </TouchableOpacity>
                    <View style={styles.photoActionDivider} />
                  </>
                )}
                <TouchableOpacity style={styles.photoActionBtn} onPress={() => openPicker('replace')}>
                  <Text style={styles.photoActionText}>写真を変更する</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* 状態3: 分析済み */}
          {hasContent && (
            <Animated.View style={{ transform: [{ scale: materialScale }] }}>
              {/* 教材＋生徒 分割カード（脚部に授業の長さ。カード＝授業の設定、下のボタン＝実行） */}
              <View style={styles.lessonCard}>
                <View style={styles.lessonCardRow}>
                  {/* 左：教材 */}
                  <View style={styles.lessonMaterial}>
                    {thumbnails[0] ? (
                      <Image source={{ uri: thumbnails[0] }} style={styles.lessonThumb} />
                    ) : (
                      <View style={[styles.lessonThumb, { backgroundColor: c.pinkBorder, overflow: 'hidden' }]}>
                        <View style={{ position: 'absolute', top: -30, left: 0, right: 0, bottom: -70 }}>
                          <Image source={require('../assets/text.webp')} style={{ width: '100%', height: '100%', opacity: 0.9 }} resizeMode="cover" />
                        </View>
                      </View>
                    )}
                    <Text style={styles.lessonMaterialTitle} numberOfLines={2}>{shortTitle}</Text>
                  </View>

                  {/* 縦区切り */}
                  <View style={styles.lessonDivider} />

                  {/* 右：生徒 */}
                  <TouchableOpacity
                    style={styles.lessonStudent}
                    onPress={() => setStudentSheet(selectedStudent ? 'profile' : 'picker')}
                    activeOpacity={0.85}
                  >
                    {selectedStudent ? (
                      <>
                        <Image source={{ uri: selectedStudent.avatar }} style={[styles.lessonStudentAvatar, { borderColor: c.border }]} />
                        <View style={{ gap: 1, alignItems: 'center' }}>
                          <Text style={styles.lessonStudentName}>{selectedStudent.name}</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.success }} />
                            <Text style={{ fontSize: 10, fontWeight: '700', color: c.successText }}>オンライン</Text>
                          </View>
                        </View>
                        <Text style={styles.lessonStudentAppeal} numberOfLines={3}>
                          {selectedStudent.appeal}
                        </Text>
                      </>
                    ) : (
                      <>
                        <View style={styles.lessonStudentEmpty}>
                          <Text style={{ fontSize: 26 }}>🐾</Text>
                        </View>
                        <Text style={styles.lessonStudentPickText}>生徒を{'\n'}選ぶ</Text>
                        <Text style={styles.lessonStudentPickSub}>タップ →</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>

                {/* 脚部：授業の長さ（選択は記憶される） */}
                <TouchableOpacity style={styles.lessonLengthRow} onPress={openTurnsPicker} activeOpacity={0.7}>
                  <Text style={styles.lessonLengthLabel}>授業の長さ</Text>
                  <Text style={styles.lessonLengthValue}>
                    {(LESSON_PRESETS.find((p) => p.turns === lessonMaxTurns) ?? LESSON_PRESETS[1]).label}（やりとり{lessonMaxTurns}回） ▾
                  </Text>
                </TouchableOpacity>
              </View>

              {/* 教材を確認するボタン */}
              <TouchableOpacity
                style={styles.lessonPreviewBtn}
                onPress={handlePreview}
                disabled={previewLoading}
              >
                {previewLoading ? (
                  <ActivityIndicator color={c.link} size="small" />
                ) : (
                  <Text style={styles.lessonPreviewBtnText}>教材を見る</Text>
                )}
              </TouchableOpacity>

              {/* 授業をするボタン（長さの設定は「次の授業」カードの脚部へ） */}
              <BouncyPressable
                style={[styles.startBtn, !selectedStudentId && styles.startBtnDisabled]}
                onPress={() => selectedStudentId ? router.push('/chat') : showToast()}
                haptic="medium"
              >
                <Text style={[styles.startBtnText, !selectedStudentId && styles.startBtnTextDisabled]}>
                  {selectedStudentId ? '授業をする' : '生徒を選んでからスタート →'}
                </Text>
              </BouncyPressable>

            </Animated.View>
          )}
        </View>

        {/* 最近の教材 */}
        <View style={styles.recentSection}>
          <View style={[styles.sectionHeader, { marginBottom: 12 }]}>
            <Text style={styles.sectionTitle}>最近の教材</Text>
            <TouchableOpacity onPress={() => router.push('/library')}>
              <Text style={styles.sectionAction}>すべて見る →</Text>
            </TouchableOpacity>
          </View>

          {history.length === 0 ? (
            <Text style={styles.recentEmpty}>教材をアップロードすると履歴が表示されます</Text>
          ) : (
            <View style={{ gap: 10 }}>
              {history.slice(0, 3).map((item) => {
                const isActive = activeHistoryId === item.id
                const itemTitle = item.title
                  .replace(/^この(教材|文書|画像)は[、,]?\s*/u, '')
                  .slice(0, 30)
                return (
                  <View key={item.id} style={[styles.recentItem, isActive && styles.recentItemActive]}>
                    <TouchableOpacity style={styles.recentMain} onPress={() => selectHistory(item)}>
                      {item.thumbnails[0] ? (
                        <Image source={{ uri: item.thumbnails[0] }} style={styles.recentThumb} />
                      ) : (
                        <View style={[styles.recentThumb, { backgroundColor: c.pinkBorder, overflow: 'hidden' }]}>
                          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: -8 }}>
                            <Image source={require('../assets/text.webp')} style={{ width: '100%', height: '100%', opacity: 0.9 }} resizeMode="cover" />
                          </View>
                        </View>
                      )}
                      <View style={styles.recentInfo}>
                        <Text numberOfLines={1} style={[styles.recentTitle, isActive && { color: c.primary }]}>
                          {itemTitle}
                        </Text>
                        <Text style={styles.recentDate}>
                          {item.groupName ? <><Feather name="folder" size={10} color={c.faint} /> {`${item.groupName}　`}</> : null}{new Date(item.savedAt).toLocaleDateString('ja-JP')}
                        </Text>
                      </View>
                      {isActive && <Text style={styles.checkMark}>✓</Text>}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.deleteBtn}
                      onPress={() => handleDeleteHistory(item.id)}
                    >
                      <Text style={styles.deleteBtnText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                )
              })}
              {history.length > 3 && (
                <TouchableOpacity style={styles.seeAllBtn} onPress={() => router.push('/library')}>
                  <Text style={styles.seeAllText}>他 {history.length - 3} 件を見る →</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      {/* トースト */}
      <Animated.View style={[styles.toast, { opacity: toastOpacity }]} pointerEvents="none">
        <Text style={styles.toastText}>先に生徒を選んでください</Text>
      </Animated.View>

      {/* 生徒シート */}
      <Modal
        visible={!!studentSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setStudentSheet(null)}
      >
        <View style={styles.studentSheetContainer}>
          <Pressable style={styles.studentSheetOverlay} onPress={() => setStudentSheet(null)} />
          <View style={styles.studentSheetBottom}>
            <View style={styles.studentSheetHandle} />

            {studentSheet === 'profile' && selectedStudent && (
              <>
                <View style={styles.profileRow}>
                  <TouchableOpacity onPress={() => setShowStudentAvatar(true)} activeOpacity={0.75}>
                    <Image source={{ uri: selectedStudent.avatar }} style={styles.profileAvatar} />
                  </TouchableOpacity>
                  <View>
                    <Text style={styles.profileName}>{selectedStudent.name}</Text>
                    <Text style={styles.profileTagline}>{selectedStudent.tagline}</Text>
                  </View>
                </View>
                <TouchableOpacity style={styles.sheetChangeBtn} onPress={() => setStudentSheet('picker')}>
                  <Text style={styles.sheetChangeBtnText}>生徒を変える</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.sheetCloseBtn} onPress={() => setStudentSheet(null)}>
                  <Text style={styles.sheetCloseBtnText}>閉じる</Text>
                </TouchableOpacity>
              </>
            )}

            {studentSheet === 'picker' && (
              <>
                <Text style={styles.pickerLabel}>生徒を選ぶ</Text>
                {STUDENTS.map(s => {
                  const isSel = selectedStudentId === s.id
                  return (
                    <TouchableOpacity
                      key={s.id}
                      style={[styles.pickerItem, isSel && styles.pickerItemSel]}
                      onPress={() => { setSelectedStudentId(s.id); setStudentSheet(null) }}
                    >
                      <Image source={{ uri: s.avatar }} style={styles.pickerItemAvatar} />
                      <View style={styles.pickerItemInfo}>
                        <Text style={[styles.pickerItemName, isSel && styles.pickerItemNameSel]}>{s.name}</Text>
                        <Text style={styles.pickerItemTagline}>{s.tagline}</Text>
                      </View>
                      {isSel && <Text style={styles.pickerItemCheck}>✓</Text>}
                    </TouchableOpacity>
                  )
                })}
                <TouchableOpacity style={styles.sheetCloseBtn} onPress={() => setStudentSheet(null)}>
                  <Text style={styles.sheetCloseBtnText}>閉じる</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* 生徒アバター拡大表示（シートの上に重ねるため入れ子にする。兄弟 Modal の同時表示は iOS で提示に失敗し、以降タッチが効かなくなる） */}
          <Modal visible={showStudentAvatar} transparent animationType="fade" onRequestClose={() => setShowStudentAvatar(false)}>
            <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }} onPress={() => setShowStudentAvatar(false)}>
              <View style={{ width: 208, height: 208, borderRadius: 104, overflow: 'hidden', borderWidth: 4, borderColor: 'white' }}>
                {selectedStudent && <Image source={{ uri: selectedStudent.avatar }} style={{ width: '100%', height: '100%' }} />}
              </View>
            </Pressable>
          </Modal>
        </View>
      </Modal>

      {/* アバター拡大表示 */}
      <Modal visible={showTeacherAvatar} transparent animationType="fade" onRequestClose={() => setShowTeacherAvatar(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }} onPress={() => setShowTeacherAvatar(false)}>
          <View style={{ width: 208, height: 208, borderRadius: 104, overflow: 'hidden', borderWidth: 4, borderColor: 'white', backgroundColor: 'white' }}>
            <Image source={getTeacherAvatarImage(teacherProfile.avatarId)} style={{ width: '100%', height: '100%', transform: [{ translateY: AVATAR_ZOOM_NUDGE[normalizeAvatarId(teacherProfile.avatarId)] ?? 0 }] }} />
          </View>
        </Pressable>
      </Modal>

      {/* 受信トレイ */}
      <Modal visible={showInbox} transparent animationType="slide" onRequestClose={() => { setShowInbox(false); setExpandedMailId(null); }}>
        <View style={styles.studentSheetContainer}>
          <Pressable style={styles.studentSheetOverlay} onPress={() => { setShowInbox(false); setExpandedMailId(null); }} />
          <View style={[styles.studentSheetBottom, { maxHeight: '75%', paddingHorizontal: 0, paddingBottom: 32 }]}>
            <View style={styles.inboxHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Feather name="mail" size={17} color={c.textSub} />
                <Text style={styles.inboxTitle}>メールボックス</Text>
              </View>
              <TouchableOpacity onPress={() => { setShowInbox(false); setExpandedMailId(null); }}>
                <Text style={styles.inboxClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {mailMessages.map((msg) => {
                const student = msg.studentId ? STUDENTS.find((s) => s.id === msg.studentId) : null
                const isExpanded = expandedMailId === msg.id
                return (
                  <TouchableOpacity
                    key={msg.id}
                    style={styles.inboxItem}
                    onPress={() => {
                      if (!msg.read) {
                        markMailRead(msg.id).then(setMailMessages)
                      }
                      setExpandedMailId(isExpanded ? null : msg.id)
                    }}
                  >
                    <View style={styles.inboxAvatar}>
                      {student ? (
                        <Image source={{ uri: student.avatar }} style={styles.inboxAvatarImg} />
                      ) : msg.from === '校長先生' ? (
                        <Image source={require('../assets/tora_koutyou.webp')} style={styles.inboxAvatarImg} />
                      ) : (
                        <Feather name="bell" size={18} color={c.sky} />
                      )}
                    </View>
                    <View style={styles.inboxBody}>
                      <View style={styles.inboxMeta}>
                        <Text style={styles.inboxFrom}>{msg.from}</Text>
                        {!msg.read && <View style={styles.inboxUnreadDot} />}
                        {new Date(msg.timestamp).getTime() !== 0 && (
                          <Text style={styles.inboxDate}>
                            {new Date(msg.timestamp).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}
                          </Text>
                        )}
                      </View>
                      <Text style={styles.inboxSubject} numberOfLines={isExpanded ? undefined : 1}>{msg.subject ?? msg.content}</Text>
                      {isExpanded && msg.subject && <Text style={styles.inboxContent}>{msg.content}</Text>}
                      {isExpanded && msg.historyId && history.some((h) => h.id === msg.historyId) && (
                        <TouchableOpacity
                          onPress={() => {
                            const item = history.find((h) => h.id === msg.historyId)
                            if (!item) return
                            setShowInbox(false)
                            setExpandedMailId(null)
                            selectHistory(item)
                          }}
                          style={[styles.inboxOpenBtn, styles.inboxOpenBtnRow]}
                        >
                          <Feather name="book-open" size={14} color="#fff" />
                          <Text style={styles.inboxOpenBtnText}>この教材をひらいて教えてあげる</Text>
                        </TouchableOpacity>
                      )}
                      {isExpanded && msg.examInvite && examCardPool().length >= EXAM_QUESTION_COUNT && !!TEACHER_TITLES[getUnlockedTitleCount(teacherProfile)] && (
                        <TouchableOpacity onPress={goToTraining} style={[styles.inboxOpenBtn, { backgroundColor: '#d97706' }]}>
                          <Text style={styles.inboxOpenBtnText}>昇進試験を受ける</Text>
                        </TouchableOpacity>
                      )}
                      {isExpanded && msg.homework && (() => {
                        const hw = homeworks.find((h) => h.studentId === msg.studentId && h.state === 'arrived')
                        return hw ? (
                          <TouchableOpacity onPress={() => openHomeworkGrading(hw)} style={[styles.inboxOpenBtn, styles.inboxOpenBtnRow, { backgroundColor: '#d97706' }]}>
                            <Feather name="edit-3" size={14} color="#fff" />
                            <Text style={styles.inboxOpenBtnText}>答案を添削する</Text>
                          </TouchableOpacity>
                        ) : null
                      })()}
                    </View>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 先生証シート */}
      <Modal visible={teacherSheet} transparent animationType="slide" onRequestClose={() => setTeacherSheet(false)}>
        <View style={styles.studentSheetContainer}>
          <Pressable style={styles.studentSheetOverlay} onPress={() => setTeacherSheet(false)} />
          <View style={[styles.studentSheetBottom, styles.tcSheetBottom]}>
            <View style={styles.studentSheetHandle} />

            <Animated.View style={[styles.tcCardContainer, { transform: [{ scaleX: flipScaleAnim }] }]}>
              {!cardFlipped ? (
                <TouchableOpacity style={styles.tcCard} onPress={() => flipCard()} activeOpacity={0.92}>
                  <View style={[styles.tcDeco, { right: -30, top: -30, width: 120, height: 120 }]} />
                  <View style={[styles.tcDeco, { right: -12, top: -12, width: 68, height: 68 }]} />
                  <View style={[styles.tcDeco, { left: -20, bottom: -20, width: 88, height: 88 }]} />
                  <View style={styles.tcHeader}>
                    <View>
                      <Text style={styles.tcAppLabel}></Text>
                      <Text style={styles.tcCardLabel}>先生証</Text>
                    </View>
                  </View>
                  <View style={styles.tcAvatarWrap}>
                    <View style={styles.tcAvatarCircle}>
                      <Image source={getTeacherAvatarImage(teacherProfile.avatarId)} style={styles.tcAvatarImage} />
                    </View>
                  </View>
                  <View style={styles.tcNameArea}>
                    <Text style={styles.tcName}>
                      {teacherProfile.name
                        ? <>{teacherProfile.name}<Text style={styles.tcNameSuffix}> 先生</Text></>
                        : <Text style={styles.tcNameEmpty}>（名前未設定）</Text>
                      }
                    </Text>
                    <View style={styles.tcTitleBadge}>
                      <Text style={styles.tcTitleText}>{teacherProfile.title}</Text>
                    </View>
                  </View>
                  <View style={styles.tcChip} />
                  <View style={styles.tcEditHint}>
                    <Text style={styles.tcEditHintText}>タップして編集</Text>
                  </View>
                </TouchableOpacity>
              ) : (
                <View style={[styles.tcCard, styles.tcCardBack]}>
                  <View style={styles.tcBackHeader}>
                    <TouchableOpacity onPress={() => flipCard(true)} style={styles.tcBackBtn}>
                      <Text style={styles.tcBackBtnText}>← 先生証を見る</Text>
                    </TouchableOpacity>
                  </View>
                  <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 24 }}>
                    <View>
                      <Text style={styles.teacherSectionLabel}>お名前</Text>
                      <TextInput
                        style={styles.teacherNameInput}
                        value={teacherProfile.name}
                        onChangeText={(t) => setTeacherProfile({ ...teacherProfile, name: t })}
                        placeholder="例：田中"
                        placeholderTextColor={c.borderStrong}
                        maxLength={20}
                      />
                    </View>
                    <View>
                      <Text style={styles.teacherSectionLabel}>キャラクター</Text>
                      <View style={styles.avatarGrid}>
                        {TEACHER_AVATARS.map(({ id, label }) => (
                          <TouchableOpacity
                            key={id}
                            style={[styles.avatarCell, teacherProfile.avatarId === id && styles.avatarCellSel]}
                            onPress={() => setTeacherProfile({ ...teacherProfile, avatarId: id })}
                          >
                            <Image source={getTeacherAvatarImage(id)} style={styles.avatarCellImage} />
                            <Text style={styles.avatarCellLabel}>{label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  </ScrollView>
                </View>
              )}
            </Animated.View>

            <TouchableOpacity style={[styles.sheetCloseBtn, styles.tcCloseBtn]} onPress={() => setTeacherSheet(false)}>
              <Text style={styles.tcCloseBtnText}>閉じる</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 宿題の採点（①化：模範解答と見比べて先生が⭕❌） */}
      <Modal visible={hwGradeOpen && !!gradingHomework} transparent animationType="slide" onRequestClose={() => setHwGradeOpen(false)}>
        <View style={styles.studentSheetContainer}>
          <Pressable style={styles.studentSheetOverlay} onPress={() => setHwGradeOpen(false)} />
          <View style={[styles.studentSheetBottom, { maxHeight: '88%', paddingBottom: 28 }]}>
            {(() => {
              const hw = gradingHomework
              if (!hw) return null
              const st = STUDENTS.find((s) => s.id === hw.studentId)
              const allGraded = hw.items.every((it) => it.teacherMark !== undefined)
              return (
                <>
                  <View style={styles.inboxHeader}>
                    <Text style={styles.inboxTitle}>📝 {st?.name ?? '生徒'}の宿題</Text>
                    <TouchableOpacity onPress={() => setHwGradeOpen(false)}>
                      <Text style={styles.inboxClose}>✕</Text>
                    </TouchableOpacity>
                  </View>
                  <ScrollView>
                    <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
                      <Text style={styles.hwHint}>
                        前回うまく説明できなかったところを{st?.name ?? '生徒'}が解いてきました。
                        前回つまずいた項目の解き直しです。赤い<Text style={styles.hwModelWord}>答</Text>と見くらべて、直せていたら <Text style={styles.hwMarkO}>○</Text>、まだなら <Text style={styles.hwMarkX}>✕</Text>（<Text style={styles.hwMarkX}>✕</Text>は次の授業で復習します）。
                      </Text>
                      {hw.items.map((it, i) => (
                        <View key={i} style={styles.hwAnswerCard}>
                          <Text style={styles.hwAnswerQ}>問{i + 1}: {it.question}</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.hwAnswerText}><Text style={styles.hwPenMark}>✎ </Text>{it.studentAnswer}</Text>
                              <Text style={styles.hwModelText}>
                                <Text style={styles.hwModelMark}>答 </Text>{it.modelAnswer}
                              </Text>
                            </View>
                            <View style={{ flexDirection: 'row', gap: 6 }}>
                              <TouchableOpacity style={[styles.hwMarkBtn, it.teacherMark === true && styles.hwMarkBtnCorrect]} onPress={() => setHwItemMark(i, true)}>
                                <StampText active={it.teacherMark === true} style={[styles.hwMarkBtnText, it.teacherMark === true && styles.hwMarkBtnTextSel]}>○</StampText>
                              </TouchableOpacity>
                              <TouchableOpacity style={[styles.hwMarkBtn, it.teacherMark === false && styles.hwMarkBtnWrong]} onPress={() => setHwItemMark(i, false)}>
                                <StampText active={it.teacherMark === false} style={[styles.hwMarkBtnText, it.teacherMark === false && styles.hwMarkBtnTextSel]}>✕</StampText>
                              </TouchableOpacity>
                            </View>
                          </View>
                        </View>
                      ))}
                      <View style={styles.hwThanksRow}>
                        {st ? <Image source={{ uri: st.avatar }} style={styles.hwThanksAvatar} /> : null}
                        <Text style={styles.hwThanksText}>{allGraded ? 'みてくれてありがとうございます！なおすところ、しっかり覚え直します！' : '先生、宿題どうでしたか…？'}</Text>
                      </View>
                      <TouchableOpacity style={[styles.examCloseBtn, !allGraded && styles.hwAssignBtnDisabled]} disabled={!allGraded} onPress={finishHomework}>
                        <Text style={styles.examCloseBtnText}>{allGraded ? '採点して返す' : <>すべてに <Text style={styles.hwMarkO}>○</Text> か <Text style={styles.hwMarkX}>✕</Text> をつけてね</>}</Text>
                      </TouchableOpacity>
                    </View>
                  </ScrollView>
                </>
              )
            })()}
          </View>
        </View>
      </Modal>

      {/* 画像プリロード：初回表示を高速化 */}
      <View style={{ width: 0, height: 0, overflow: 'hidden', position: 'absolute' }}>
        {Object.values(TEACHER_AVATAR_IMAGES).map((src, i) => (
          <Image key={i} source={src} style={{ width: 1, height: 1 }} />
        ))}
      </View>

      <BottomTabBar active="home" />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.skyBg },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingVertical: 24, gap: 16 },

  // ヘッダー
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  appTitle: { fontSize: 18, fontFamily: font.roundHeavy, color: c.skyStrong, letterSpacing: -0.3 },
  appSubtitle: { fontSize: 10, color: c.link, fontWeight: '700', letterSpacing: 0.3 },
  headerIcons: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  mailIconBtn: { alignItems: 'center', gap: 2, position: 'relative' },
  mailIconCircle: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: c.skyTint, borderWidth: 1, borderColor: c.skyBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  mailIconEmoji: { fontSize: 20 },
  mailBadge: {
    position: 'absolute', top: -4, right: -4,
    backgroundColor: c.danger, borderRadius: 8,
    minWidth: 16, height: 16,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
  },
  mailBadgeText: { color: 'white', fontSize: 9, fontWeight: '900' },
  teacherIconBtn: { alignItems: 'center', gap: 2 },
  teacherIconCircle: {
    width: 40, height: 40, borderRadius: 20, overflow: 'hidden',
    backgroundColor: c.skyTint, borderWidth: 1, borderColor: c.skyBorder,
  },
  teacherIconImage: { width: 40, height: 40 },
  teacherIconLabel: { fontSize: 9, fontWeight: '700', color: c.link, letterSpacing: 0.5 },

  // セクション共通
  todaySection: { gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 13, fontFamily: font.round, color: c.skyStrong, letterSpacing: 0.8 },
  sectionAction: { fontSize: 12, color: c.link, fontWeight: '500' },
  sectionClear: { fontSize: 11, color: c.textSub, fontWeight: '500' },

  // 状態1：アップロード
  inputModeTabs: { flexDirection: 'row', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: c.border, marginBottom: 12 },
  inputModeTab: { flex: 1, paddingVertical: 8, alignItems: 'center', backgroundColor: 'white' },
  inputModeTabActive: { backgroundColor: c.primaryStrong },
  inputModeTabInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  inputModeTabText: { fontSize: 13, fontWeight: '600', color: c.textSub },
  inputModeTabTextActive: { color: 'white' },
  textInputCard: { backgroundColor: 'white', borderRadius: 20, borderWidth: 2, borderStyle: 'dashed', borderColor: c.skySoft, padding: 16, gap: 10 },
  textInputArea: { height: 120, fontSize: 14, color: c.text, lineHeight: 22 },
  textInputFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  textInputCount: { fontSize: 11, color: c.textSub, textAlign: 'right' },
  uploadCard: {
    backgroundColor: 'white',
    borderRadius: 20,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: c.skySoft,
    height: 226,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowColor: c.skySoft,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  uploadCardIcon: { fontSize: 32 },
  uploadCardText: { fontSize: 19, color: c.link, fontWeight: '800' },
  uploadCardSub: { fontSize: 12, color: c.textSub, fontWeight: '400' },

  // 状態2：ペンディング
  pendingCard: {
    backgroundColor: 'white', borderRadius: 20, padding: 16, gap: 12,
    shadowColor: c.faint, shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15, shadowRadius: 8, elevation: 4,
  },
  thumbRowWrap: { flexDirection: 'row', alignItems: 'center' },
  thumbRow: { flex: 1 },
  thumb: { width: 72, height: 72, borderRadius: 12, marginRight: 8 },
  thumbCounter: { paddingLeft: 10, fontSize: 15, fontWeight: '700', color: c.textSub },
  analyzeBtn: { ...btn.primary, borderRadius: 14, paddingVertical: 16 },
  analyzeBtnLoading: { backgroundColor: c.pinkMuted },
  analyzeBtnText: { ...btn.primaryText, fontSize: 16 },
  photoActions: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: c.pinkBorder, borderRadius: 14, overflow: 'hidden',
  },
  photoActionBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, backgroundColor: c.pinkTint },
  photoActionText: { fontSize: 14, color: c.primary, fontWeight: '600' },
  photoActionDivider: { width: 1, height: 28, backgroundColor: c.pinkBorder },

  // 状態3：分割カード
  lessonCard: {
    backgroundColor: 'white',
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: c.link,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
    elevation: 5,
  },
  lessonCardRow: { flexDirection: 'row' },
  lessonLengthRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: c.bgSub,
  },
  lessonLengthLabel: { fontSize: 11, fontWeight: '600', color: c.textSub },
  lessonLengthValue: { fontSize: 12, fontWeight: '700', color: c.textStrong },
  lessonMaterial: { flex: 1, padding: 14, gap: 8 },
  lessonThumb: { width: '100%', aspectRatio: 1.4, borderRadius: 12 },
  lessonThumbText: { backgroundColor: c.pinkSoft, alignItems: 'center', justifyContent: 'center' },
  lessonMaterialTitle: { fontSize: 13, fontWeight: '700', color: c.textStrong, lineHeight: 18 },
  lessonPreviewBtn: {
    backgroundColor: c.skyTint,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.skyBorder,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  lessonPreviewBtnText: { fontSize: 14, fontFamily: font.round, color: c.link },
  lessonDivider: { width: 1, backgroundColor: c.border, marginVertical: 16 },
  lessonStudent: {
    width: 118, padding: 14,
    alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: c.pinkTint,
  },
  lessonStudentAvatar: { width: 64, height: 64, borderRadius: 32, borderWidth: 1 },
  lessonStudentName: { fontSize: 12, fontFamily: font.round, color: c.textStrong },
  lessonStudentAppeal: { fontSize: 11, color: c.primaryStrong, textAlign: 'center', lineHeight: 16 },
  lessonStudentEmpty: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: c.pinkSoft, alignItems: 'center', justifyContent: 'center',
  },
  lessonStudentPickText: { fontSize: 13, fontWeight: '700', color: c.primary, textAlign: 'center' },
  lessonStudentPickSub: { fontSize: 10, color: c.primary },

  // 授業スタートボタン
  startBtn: {
    backgroundColor: c.primaryStrong,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 10,
    shadowColor: c.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  startBtnDisabled: { backgroundColor: c.pinkTint, borderWidth: 1.5, borderColor: c.pinkBorder, shadowOpacity: 0, elevation: 0 },
  startBtnText: { fontSize: 18, fontFamily: font.roundHeavy, color: 'white' },
  startBtnTextDisabled: { color: c.primary, fontSize: 15, fontFamily: font.round },

  row: { flexDirection: 'row', alignItems: 'center' },

  // トースト
  toast: {
    position: 'absolute', bottom: 32, alignSelf: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 24,
  },
  toastText: { color: 'white', fontSize: 14, fontWeight: '600' },

  // 最近の授業
  recentSection: {
    marginHorizontal: -20,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 32,
    backgroundColor: c.bgSub,
    borderTopWidth: 1.5,
    borderTopColor: c.skyBorder,
  },
  recentEmpty: { fontSize: 13, color: c.textSub, textAlign: 'center', paddingVertical: 16 },
  recentItem: {
    backgroundColor: 'white', borderRadius: 14, flexDirection: 'row', alignItems: 'center', overflow: 'hidden',
    shadowColor: c.faint, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 4, elevation: 2,
  },
  recentItemActive: { backgroundColor: c.pinkTint, borderWidth: 1.5, borderColor: c.pinkBorder },
  recentMain: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  recentThumb: { width: 52, height: 52, borderRadius: 10, flexShrink: 0 },
  recentInfo: { flex: 1, minWidth: 0 },
  recentTitle: { fontSize: 13, fontWeight: '600', color: c.text },
  recentDate: { fontSize: 10, color: c.textSub, marginTop: 2, fontWeight: '300' },
  checkMark: { fontSize: 14, color: c.primary, fontWeight: 'bold' },
  deleteBtn: { paddingHorizontal: 14, paddingVertical: 12 },
  deleteBtnText: { fontSize: 13, color: c.faint },
  seeAllBtn: { paddingVertical: 10, alignItems: 'center' },
  seeAllText: { fontSize: 13, color: c.link, fontWeight: '500' },

  // 生徒シート
  studentSheetContainer: { flex: 1, justifyContent: 'flex-end' },
  studentSheetOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  studentSheetBottom: {
    backgroundColor: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 16, paddingBottom: 40, paddingTop: 8,
  },
  studentSheetHandle: {
    width: 36, height: 4, backgroundColor: c.border,
    borderRadius: 2, alignSelf: 'center', marginBottom: 16,
  },
  profileRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.bgSub, marginBottom: 12,
  },
  profileAvatar: { width: 56, height: 56, borderRadius: 28 },
  profileName: { fontSize: 16, fontFamily: font.round, color: c.textStrong },
  profileTagline: { fontSize: 12, color: c.textSub, marginTop: 3 },
  sheetChangeBtn: {
    backgroundColor: c.bgSub, borderRadius: 14,
    paddingVertical: 14, alignItems: 'center', marginBottom: 8,
  },
  sheetChangeBtnText: { fontSize: 14, fontFamily: font.round, color: c.textMid },
  sheetCloseBtn: {
    backgroundColor: c.bg, borderRadius: 14,
    paddingVertical: 14, alignItems: 'center',
  },
  sheetCloseBtnText: { fontSize: 14, fontWeight: '500', color: c.textSub },
  pickerLabel: {
    fontSize: 13, fontWeight: '600', color: c.textSub,
    paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.bgSub, marginBottom: 4,
  },
  pickerItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 4, paddingVertical: 12, borderRadius: 14,
  },
  pickerItemSel: { backgroundColor: c.pinkTint },
  pickerItemAvatar: { width: 48, height: 48, borderRadius: 24 },
  pickerItemInfo: { flex: 1, minWidth: 0 },
  pickerItemName: { fontSize: 14, fontFamily: font.round, color: c.textStrong },
  pickerItemNameSel: { color: c.primary },
  pickerItemTagline: { fontSize: 12, color: c.textSub, marginTop: 2 },
  pickerItemCheck: { fontSize: 16, color: c.primary, fontWeight: '700' },

  // 受信トレイ
  inboxHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: c.bgSub,
  },
  inboxTitle: { fontSize: 15, fontFamily: font.roundHeavy, color: c.textStrong },
  inboxClose: { fontSize: 18, color: c.faint },
  inboxItem: {
    flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: c.bg,
  },
  inboxAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: c.skyBg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    flexShrink: 0, marginTop: 2,
  },
  inboxAvatarImg: { width: 40, height: 40 },
  inboxBody: { flex: 1 },
  inboxMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  inboxFrom: { fontSize: 12, fontWeight: '700', color: c.text },
  inboxUnreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: c.danger },
  inboxDate: { fontSize: 10, color: c.textSub, marginLeft: 'auto' },
  inboxSubject: { fontSize: 12, fontWeight: '600', color: c.text, marginTop: 1 },
  inboxContent: { fontSize: 13, color: c.textMid, lineHeight: 19, marginTop: 6 },
  inboxOpenBtn: { alignSelf: 'flex-start', backgroundColor: c.primary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, marginTop: 10 },
  inboxOpenBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  inboxOpenBtnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },

  // 昇進試験
  titleChipLocked: { backgroundColor: c.bg },
  titleChipTextLocked: { color: c.borderStrong },
  examBtn: { backgroundColor: '#f59e0b', borderRadius: 12, paddingVertical: 10, alignItems: 'center', marginTop: 12 },
  examBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  examHint: { fontSize: 10, color: c.faint, marginTop: 10 },
  examSpeech: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: c.bgSub, borderRadius: 14, padding: 12, marginBottom: 14 },
  examSpeechText: { flex: 1, fontSize: 13, color: c.textMid, lineHeight: 19 },
  examProgress: { fontSize: 11, fontWeight: '700', color: c.faint, marginBottom: 4 },
  examQuestion: { fontSize: 14, fontWeight: '700', color: c.text, lineHeight: 21, marginBottom: 10 },
  examInput: { borderWidth: 1, borderColor: c.borderStrong, borderRadius: 12, padding: 12, fontSize: 14, color: c.text, minHeight: 80, textAlignVertical: 'top' },
  examNavBtn: { borderWidth: 1, borderColor: c.borderStrong, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#fff' },
  examNavBtnText: { fontSize: 12, fontWeight: '700', color: c.textMid },
  examNextBtn: { flex: 1, backgroundColor: '#d97706', borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  examNextBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
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
  examCloseBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },

  // 宿題
  hwBadge: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, marginHorizontal: 16, marginTop: 12 },
  hwBadgeIconWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fef3c7', borderWidth: 1, borderColor: '#fcd34d', alignItems: 'center', justifyContent: 'center' },
  hwBadgeClock: { fontSize: 20 },
  hwBadgeTitle: { fontSize: 12, fontWeight: '700', color: '#92400e' },
  hwBadgeSub: { fontSize: 11, color: '#b45309', marginTop: 1 },
  hwBadgeChevron: { fontSize: 20, color: '#d97706', fontWeight: '400' },
  hwBadgeMuted: { backgroundColor: c.bgSub, borderColor: c.border },
  hwBadgeIconMuted: { backgroundColor: c.bg, borderColor: c.border },
  hwBadgeTitleMuted: { fontSize: 12, fontWeight: '700', color: c.textMid },
  hwBadgeSubMuted: { fontSize: 11, color: c.faint, marginTop: 1 },
  hwHint: { fontSize: 12, color: c.textSub, marginBottom: 10, lineHeight: 18 },
  hwCandidate: { borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, marginBottom: 8, backgroundColor: '#fff' },
  hwCandidateSel: { borderColor: '#fbbf24', backgroundColor: '#fffbeb' },
  hwCandidateText: { fontSize: 13, color: c.textMid, lineHeight: 19 },
  hwCandidateTextSel: { color: '#92400e', fontWeight: '600' },
  hwAssignBtn: { backgroundColor: '#f59e0b', borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 8, marginBottom: 12 },
  hwAssignBtnDisabled: { backgroundColor: c.bgSub },
  hwAssignBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  hwAnswerCard: { borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 12, marginBottom: 10 },
  hwAnswerQ: { fontSize: 12, fontWeight: '700', color: c.textMid, marginBottom: 4, lineHeight: 18 },
  hwAnswerText: { fontSize: 13, color: c.text, lineHeight: 19, fontWeight: '600' },
  hwPenMark: { color: c.textSub, fontWeight: '400' },
  hwModelText: { fontSize: 11, color: '#e11d48', lineHeight: 17, marginTop: 3 },
  hwModelMark: { fontWeight: '700' },
  hwModelWord: { fontWeight: '700', color: '#e11d48' },
  hwMarkO: { fontWeight: '700', color: '#10b981' },
  hwMarkX: { fontWeight: '700', color: '#f43f5e' },
  hwMarkBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: c.borderStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  hwMarkBtnCorrect: { backgroundColor: '#10b981', borderColor: '#10b981' },
  hwMarkBtnWrong: { backgroundColor: '#f43f5e', borderColor: '#f43f5e' },
  hwMarkBtnText: { fontSize: 16, fontWeight: '700', color: c.borderStrong },
  hwMarkBtnTextSel: { color: '#fff' },
  hwResultText: { fontSize: 11, color: c.textSub, lineHeight: 17 },
  hwThanksRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 6, marginBottom: 4 },
  hwThanksAvatar: { width: 32, height: 32, borderRadius: 16 },
  hwThanksText: { flex: 1, fontSize: 12, color: c.textMid, lineHeight: 18, backgroundColor: c.bgSub, borderRadius: 12, padding: 10 },

  // 先生証シート
  tcSheetBottom: { backgroundColor: c.ink, paddingHorizontal: 0, paddingBottom: 0, paddingTop: 0 },
  tcCardContainer: {
    width: 240, height: 353, alignSelf: 'center', marginVertical: 24,
    overflow: 'hidden', borderRadius: 22,
  },
  tcCard: {
    flex: 1,
    borderRadius: 22, backgroundColor: c.skyStrong,
    overflow: 'hidden', padding: 20, justifyContent: 'space-between',
    shadowColor: '#000', shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.5, shadowRadius: 28, elevation: 18,
  },
  tcCardBack: { backgroundColor: 'white', padding: 0 },
  tcDeco: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)' },
  tcHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  tcAppLabel: { fontSize: 7, fontWeight: '900', color: 'rgba(255,255,255,0.3)', letterSpacing: 3.5 },
  tcCardLabel: { fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.85)', letterSpacing: 3, marginTop: 2 },
  tcStar: { fontSize: 14, color: 'rgba(255,255,255,0.18)' },
  tcAvatarWrap: { alignItems: 'center' },
  tcAvatarCircle: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.65)',
    alignItems: 'center', justifyContent: 'center',
  },
  tcAvatarImage: { width: 82, height: 82, borderRadius: 41 },
  tcNameArea: { alignItems: 'center', gap: 8 },
  tcName: { fontSize: 22, fontFamily: font.roundHeavy, color: 'white', letterSpacing: 0.5 },
  tcNameSuffix: { fontSize: 14, fontWeight: '400', color: 'rgba(255,255,255,0.7)' },
  tcNameEmpty: { fontSize: 14, fontWeight: '400', color: 'rgba(255,255,255,0.35)' },
  tcTitleBadge: {
    paddingHorizontal: 14, paddingVertical: 4, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  tcTitleText: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.75)', letterSpacing: 1.5 },
  tcChip: {
    alignSelf: 'flex-end', width: 36, height: 24, borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  tcEditHint: { position: 'absolute', bottom: 10, left: 0, right: 0, alignItems: 'center' },
  tcEditHintText: { fontSize: 11, color: 'rgba(255,255,255,0.7)', letterSpacing: 0.5 },
  tcBackHeader: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: c.bgSub,
  },
  tcBackBtn: { flexDirection: 'row', alignItems: 'center' },
  tcBackBtnText: { fontSize: 12, fontFamily: font.round, color: c.link },
  teacherSectionLabel: { fontSize: 10, fontWeight: '700', color: c.textSub, letterSpacing: 1, marginBottom: 8 },
  teacherNameInput: {
    paddingHorizontal: 14, paddingVertical: 11,
    borderRadius: 12, borderWidth: 1, borderColor: c.border,
    fontSize: 14, fontWeight: '500', color: c.textStrong, backgroundColor: c.bgSub,
  },
  avatarGrid: { flexDirection: 'row', gap: 6 },
  avatarCell: {
    flex: 1, borderRadius: 12, paddingVertical: 6,
    backgroundColor: c.bg, borderWidth: 2, borderColor: 'transparent',
    alignItems: 'center', gap: 4, overflow: 'hidden',
  },
  avatarCellSel: { backgroundColor: c.skyBg, borderColor: c.sky },
  avatarCellImage: { width: 38, height: 38, borderRadius: 19 },
  avatarCellLabel: { fontSize: 9, fontWeight: '700', color: c.textSub },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  titleChip: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 20, backgroundColor: c.bgSub },
  titleChipSel: { backgroundColor: c.link },
  titleChipText: { fontSize: 12, fontWeight: '600', color: c.textMid },
  titleChipTextSel: { color: 'white' },
  tcCloseBtn: { marginHorizontal: 16, marginTop: 0, marginBottom: 36, backgroundColor: 'rgba(255,255,255,0.08)' },
  tcCloseBtnText: { fontSize: 14, fontWeight: '500', color: 'rgba(255,255,255,0.45)', textAlign: 'center', paddingVertical: 14 },
})
