import {
  View, Text, TouchableOpacity, ScrollView, Image,
  StyleSheet, ActivityIndicator, Alert, Animated, Modal, Pressable, TextInput,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import { BottomTabBar } from '@/components/BottomTabBar'
import { useEffect, useRef, useState, useCallback } from 'react'
import * as ImagePicker from 'expo-image-picker'
import { Feather, MaterialCommunityIcons, Ionicons } from '@expo/vector-icons'
import PawGlyph from '@/components/PawGlyph'
import { useApp } from '@/lib/AppContext'
import { STUDENTS } from '@/lib/students'
import { TEACHER_AVATARS, TEACHER_AVATAR_IMAGES, getTeacherAvatarImage, normalizeAvatarId } from '@/lib/teacherProfile'
import { analyzeImages, analyzeText, fetchPreviewContent, fetchFactsheet } from '@/lib/api'
import { needsFactsheetUpgrade } from '@/lib/factsheet'
import { onSyncComplete } from '@/lib/sync'
import {
  loadHistory, saveToHistory, deleteFromHistory, updateHistoryPreview, updateHistoryFactsheet, HISTORY_MAX,
  loadSavedGroups, saveGroupsList, loadMail, saveMail, markMailRead, addMail,
  loadDrillPending, drillKey,
  splitUnits, unitLabel, defaultUnitIndex, loadUnitProgressMap, getUnitStatuses,
  loadWorkLog, workDateKey,
  loadExamDays, saveExamDays, makeExamEntry, ensureExamDay, examMailFor, examDateLabel, todayDateKey, dateKeyAfterDays,
  loadExamSuccessCount, bumpExamSuccessCount,
  loadExamSuccessLog, appendExamSuccessLog,
} from '@/lib/storage'
import type { ExamEntry, ExamSuccessRecord, MailMessage, WorkLog } from '@/lib/storage'
import type { HistoryItem, UnitProgress, UnitStatus } from '@/lib/types'
import { btn, c, font } from '@/lib/theme'
import BouncyPressable from '@/components/BouncyPressable'
import StampText from '@/components/StampText'

// オンライン表示の脈動ドット（「画面の向こうに誰かがいる」気配。Webのanimate-pulseと同等）
function PulseDot({ color, size = 6 }: { color: string; size?: number }) {
  const v = useRef(new Animated.Value(1)).current
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 0.35, duration: 900, useNativeDriver: true }),
      Animated.timing(v, { toValue: 1, duration: 900, useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [])
  return <Animated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: v }} />
}

type ImageData = { data: string; mimeType: string; uri: string }

const MAX_IMAGES = 3

// 先生アバターを円で表示すると耳の高いキャラ（うさぎ・きつね）は耳が見切れるため、
// そのキャラだけ画像をごくわずかに下げて耳を収める（表示サイズに対する縦オフセット比）
const AVATAR_NUDGE: Record<string, number> = { usagi: 0.07, kitsune: 0.05, neko: 0.03 }
const avatarNudgeY = (avatarId: string, size: number) => (AVATAR_NUDGE[normalizeAvatarId(avatarId)] ?? 0) * size

// 教材のプレースホルダー（縦長のノート画像）。横長ボックスに入れると縦中央band＝ノート下部が
// 見えてしまうので、ボックス幅を測ってノートの中心（画像の縦42%あたり）をボックス中央に合わせる
const TEXT_ASSET = require('../assets/text.webp')
const TEXT_ASSET_SRC = Image.resolveAssetSource(TEXT_ASSET)
const TEXT_ASSET_RATIO = TEXT_ASSET_SRC ? TEXT_ASSET_SRC.height / TEXT_ASSET_SRC.width : 1.5 // 縦/横
function NotePlaceholder({ style }: { style?: object }) {
  const [w, setW] = useState(0)
  const imgH = w * TEXT_ASSET_RATIO
  const boxH = w / 1.7 // lessonThumb の aspectRatio
  const top = boxH / 2 - 0.44 * imgH // ノートの中心（画像の縦44%）をボックス中央へ
  return (
    <View style={[style, { backgroundColor: c.bgSub, overflow: 'hidden' }]} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && <Image source={TEXT_ASSET} style={{ position: 'absolute', left: 0, width: w, height: imgH, top, opacity: 0.9 }} resizeMode="cover" />}
    </View>
  )
}

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
    setLessonUnit,
    resetChatSession,
  } = useApp()

  const [analyzing, setAnalyzing] = useState(false)
  // ファクトシート生成に失敗した教材のID。CTAを無限スピナーにせず再試行に切り替えるための状態
  const [factsheetErrorIds, setFactsheetErrorIds] = useState<Set<string>>(new Set())
  const factsheetInFlight = useRef<Set<string>>(new Set())
  const [inputMode, setInputMode] = useState<'photo' | 'text'>('photo')
  const [textInput, setTextInput] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [drillPendingKeys, setDrillPendingKeys] = useState<Set<string>>(new Set()) // 研修導線の「まだN」用
  const [unitProgress, setUnitProgress] = useState<Record<string, UnitProgress>>({}) // 単元マップ（授業①〜の完了状況）
  const [homeUnitIdx, setHomeUnitIdx] = useState<number | null>(null) // 選択中の単元（null=おまかせ＝最初の未完了）
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null)
  const [pendingImages, setPendingImages] = useState<ImageData[]>([])
  const [studentSheet, setStudentSheet] = useState<'profile' | 'picker' | null>(null)
  const [teacherSheet, setTeacherSheet] = useState(false)
  const [workLog, setWorkLog] = useState<WorkLog>({}) // 業務日誌（ヘッダーの独立シート）
  const [journalOpen, setJournalOpen] = useState(false)
  const [journalMonth, setJournalMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })
  const [journalDay, setJournalDay] = useState<string | null>(null) // タップした日付（その日の詳細を出す）
  const [examDays, setExamDays] = useState<Record<string, ExamEntry>>({}) // 生徒のテストの予定
  const [examSuccess, setExamSuccess] = useState(0) // 生徒のテスト大成功の累計（先生証の実績）
  const [examSuccessLog, setExamSuccessLog] = useState<ExamSuccessRecord[]>([]) // 大成功の記録簿（追記専用）
  const [showExamLog, setShowExamLog] = useState(false) // 記録簿シート（先生証のバッジから開く）
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
      loadHistory().then(setHistory) // 研修導線の「まだN」等を最新化
      loadDrillPending().then(setDrillPendingKeys)
      loadUnitProgressMap().then(setUnitProgress) // 授業から戻ったら単元マップを最新化
      loadExamDays().then(setExamDays) // テストの予定（授業中に新規作成されることがある）
      if (pendingAnimRef.current) {
        setPendingMaterialAnimation(false)
        triggerMaterialAnimation()
      }
    }, [])
  )

  // サーバ同期の完了時：キャッシュが作り直されているので画面stateを読み直す
  useEffect(() => {
    return onSyncComplete(() => {
      loadMail().then(setMailMessages)
      loadHistory().then(setHistory)
      loadDrillPending().then(setDrillPendingKeys)
      loadUnitProgressMap().then(setUnitProgress)
      loadExamDays().then(setExamDays)
      loadExamSuccessCount().then(setExamSuccess)
    })
  }, [])

  useEffect(() => {
    loadHistory().then(setHistory)
    loadMail().then(setMailMessages)
  }, [])

  // テストの当日処理：期日が来た教材に結果メールを届け、未完了なら追試日を自動で立てる。
  // 教材が消えている試験日はここで掃除する（削除時の消し忘れの保険）
  const examChecked = useRef(false)
  useEffect(() => {
    if (examChecked.current) return
    examChecked.current = true
    void (async () => {
      try {
        const [items, map] = await Promise.all([loadHistory(), loadExamDays()])
        const today = todayDateKey()
        const student = STUDENTS.find((s) => s.id === selectedStudentId) ?? STUDENTS[0]
        const mails: MailMessage[] = []
        let changed = false
        for (const [hid, entry] of Object.entries(map)) {
          const item = items.find((h) => h.id === hid)
          if (!item) { delete map[hid]; changed = true; continue }
          if (entry.doneAt) continue
          const cards = item.factsheet?.cards ?? []
          const units = splitUnits(cards.length)
          const statuses = await getUnitStatuses(hid, cards.length)
          const doneCount = units.filter((_, i) => statuses[i] === 'done').length
          // 差出人はテストを受けた生徒（entryに記録済み）。selectedStudentId はこの時点で
          // まだAsyncStorageから読み込まれていないことがあるため、フォールバックにのみ使う
          const sender = STUDENTS.find((s) => s.id === entry.studentId) ?? student
          if (entry.date > today) {
            // 期日間近の予告：2日前から、授業が終わっていなければ一度だけ催促メール
            if (!entry.remindedAt && entry.date <= dateKeyAfterDays(2) && units.length > 0 && doneCount < units.length) {
              map[hid] = { ...entry, remindedAt: Date.now() }
              mails.push(examMailFor(sender, item, 'remind', examDateLabel(entry.date), entry.round))
              changed = true
            }
            continue
          }
          if (units.length > 0 && doneCount === units.length) {
            map[hid] = { ...entry, doneAt: Date.now() }
            await bumpExamSuccessCount()
            // 記録簿へ刻む（教材削除後も残るようタイトルをスナップショット）
            await appendExamSuccessLog({
              id: `${hid}-${entry.round}-${Date.now()}`,
              d: today,
              s: entry.studentId ?? sender.id,
              t: item.title.replace(/^この(教材|文書|画像|写真)は[、，]?\s*/u, '').slice(0, 24),
            })
            mails.push(examMailFor(sender, item, 'full', '', entry.round))
          } else {
            const next = makeExamEntry(Math.max(1, units.length - doneCount), entry.round + 1, entry.studentId, hid)
            map[hid] = next
            mails.push(examMailFor(sender, item, doneCount === 0 ? 'none' : 'partial', examDateLabel(next.date), next.round))
          }
          changed = true
        }
        // メールを届けてから処理済みを保存する。逆順だと途中終了で結果メールが永久に消える
        // （この順なら最悪でも重複して届くだけで、行き止まりにならない）
        for (const m of mails) await addMail(m)
        if (changed) await saveExamDays(map)
        if (mails.length > 0) setMailMessages(await loadMail())
        setExamDays(await loadExamDays())
        setExamSuccess(await loadExamSuccessCount())
        setExamSuccessLog(await loadExamSuccessLog())
      } catch { /* メールは任意機能。失敗は無視 */ }
    })()
  }, [])

  useEffect(() => {
    if (!teacherSheet) {
      flipScaleAnim.setValue(1)
      setCardFlipped(false)
    } else {
      // 業務日誌・記録簿を最新化してから見せる
      void loadWorkLog().then(setWorkLog)
      void loadExamSuccessLog().then(setExamSuccessLog)
      const d = new Date()
      setJournalMonth({ y: d.getFullYear(), m: d.getMonth() })
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
    // 同じ教材への多重生成を防ぐ（並行生成はカード枚数の揺れで単元進度の count 不一致リセットを招く）
    if (factsheetInFlight.current.has(histId)) return
    factsheetInFlight.current.add(histId)
    setFactsheetErrorIds((prev) => {
      if (!prev.has(histId)) return prev
      const next = new Set(prev)
      next.delete(histId)
      return next
    })
    try {
      const res = await fetchFactsheet(desc, notesText)
      // サーバは生成不能でも200+factsheetなし/カード0で返すことがある。その場合も失敗としてCTAの再試行に回す
      const cardCount = res.factsheet?.cards?.length ?? 0
      if (res.factsheet) {
        await updateHistoryFactsheet(histId, res.factsheet)
        const items = await loadHistory()
        setHistory(items)
        // カードバンクが揃った＝授業の予定が立つ。生徒のテストの日取りもここで決まる
        if (cardCount > 0) {
          const student = STUDENTS.find((s) => s.id === selectedStudentId) ?? STUDENTS[0]
          const entry = await ensureExamDay(histId, splitUnits(cardCount).length, student.id)
          if (entry) {
            const title = items.find((h) => h.id === histId)?.title ?? '教材'
            await addMail(examMailFor(student, { id: histId, title }, 'propose', examDateLabel(entry.date), 1))
            setMailMessages(await loadMail())
            setExamDays(await loadExamDays())
          }
        }
      }
      if (cardCount === 0) setFactsheetErrorIds((prev) => new Set(prev).add(histId))
    } catch {
      // 授業は劣化動作で成立するが、失敗はCTAに表示して再試行できるようにする
      setFactsheetErrorIds((prev) => new Set(prev).add(histId))
    } finally {
      factsheetInFlight.current.delete(histId)
    }
  }

  // ホームCTAからの再試行（失敗した教材のファクトシートを作り直す）
  const retryFactsheet = () => {
    const it = history.find((h) => h.id === currentHistoryId)
    if (it) void backgroundFetchFactsheet(it.imageDescription, it.notes, it.id)
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
    } catch (e) {
      // 冒頭で先行して立てた「教材あり」状態を戻す。戻さないと履歴未保存のまま
      // 入力UIが消え、CTAが「準備しています…」で行き止まりになる（入力テキストは残っているので作業は消えない）
      setImageDescription('')
      setNotes('')
      Alert.alert('エラー', e instanceof Error ? e.message : '教材の読み込みに失敗しました。もう一度試してください。')
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
      // 空応答＝サーバは成功したが読み取れる文字が無かった（非教材写真など）。再試行を促さず理由を伝える
      if (!res.imageDescription) throw new Error('教材として読み取れる文字が見つかりませんでした。文字の写った教材の写真を選んでください。')

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
      Alert.alert('エラー', e instanceof Error ? e.message : '教材の読み込みに失敗しました。もう一度試してください。')
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
    if (analyzing) return // 教材の読み込み中は選択を切り替えない（解析完了時の後勝ち上書きを防ぐ）
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

  // 教材を切り替えたらホームの単元選択をリセット（既定＝最初の未完了単元）
  useEffect(() => { setHomeUnitIdx(null) }, [currentHistoryId])

  // 単元マップ：選択中教材のカードを授業①〜に分け、選択単元（既定=最初の未完了）を解決する。
  // カード枚数が変わった教材（バンク再生成など）は区切りがズレるためステータスをリセット扱いにする
  const unitInfo = (() => {
    const cards = history.find((h) => h.id === currentHistoryId)?.factsheet?.cards ?? []
    const units = splitUnits(cards.length)
    if (units.length === 0) return null
    const entry = currentHistoryId ? unitProgress[currentHistoryId] : undefined
    const statuses: Record<number, UnitStatus> = entry && entry.count === cards.length ? entry.status : {}
    const selected = Math.min(homeUnitIdx ?? defaultUnitIndex(cards.length, statuses), units.length - 1)
    return { units, statuses, selected, doneCount: units.filter((_, i) => statuses[i] === 'done').length }
  })()

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
            <Text style={styles.appSubtitle}>オシエテ先生</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <TouchableOpacity onPress={() => setShowTeacherAvatar(true)} activeOpacity={0.75}>
                <View style={{ width: 36, height: 36, borderRadius: 18, overflow: 'hidden', backgroundColor: 'white' }}>
                  <Image source={getTeacherAvatarImage(teacherProfile.avatarId)} style={{ width: 36, height: 36, transform: [{ translateY: avatarNudgeY(teacherProfile.avatarId, 36) }] }} />
                </View>
              </TouchableOpacity>
              <View style={{ gap: 1 }}>
                <Text style={styles.appTitle}>
                  {teacherProfile.name ? `${teacherProfile.name}先生` : '先生'}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <PulseDot color={c.success} size={6} />
                  <Text style={{ fontSize: 10, fontWeight: '700', color: c.successText }}>オンライン</Text>
                </View>
              </View>
            </View>
          </View>
          <View style={styles.headerIcons}>
            <TouchableOpacity style={styles.mailIconBtn} onPress={() => setShowInbox(true)}>
              <View style={styles.mailIconCircle}>
                <Feather name="mail" size={18} color={c.blazer} />
              </View>
              <Text style={styles.teacherIconLabel}>メール</Text>
              {unreadCount > 0 && (
                <View style={styles.mailBadge}>
                  <Text style={styles.mailBadgeText}>{unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.teacherIconBtn} onPress={() => { const d = new Date(); setJournalMonth({ y: d.getFullYear(), m: d.getMonth() }); setJournalDay(null); void loadWorkLog().then(setWorkLog); void loadExamDays().then(setExamDays); setJournalOpen(true) }}>
              <View style={styles.teacherIconCircle}>
                <Feather name="calendar" size={18} color={c.blazer} />
              </View>
              <Text style={styles.teacherIconLabel}>日誌</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.teacherIconBtn} onPress={() => setTeacherSheet(true)}>
              <View style={styles.teacherIconCircle}>
                <MaterialCommunityIcons name="badge-account-outline" size={20} color={c.blazer} />
              </View>
              <Text style={styles.teacherIconLabel}>先生証</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 初回のみ：コンセプトの一言（生徒の顔は下の生徒カードが担う）。
            「AI」は約束しない：ラリーは定型なので、語るのは役割と教材だけ */}
        {history.length === 0 && (
          <View style={styles.heroCard}>
            <Text style={styles.heroTitle}>教えて、先生！</Text>
            <Text style={styles.heroSub}>あなたが先生。覚えたい教材で、生徒に授業をしてみましょう。</Text>
          </View>
        )}

        {/* 今日の授業 */}
        <View style={styles.todaySection}>
          {/* ゾーン見出しは常時表示（アップロード前でもしごとゾーンの物語を保つ）。
              ＋教材を作るリンクは教材選択後のみ（選択前はアップロードUI自体が"作る"） */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>今日の仕事</Text>
            {hasContent && (
              <TouchableOpacity onPress={clearSelection}>
                <Text style={styles.sectionClear}>＋ 教材を作る</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* 組み立て台：生徒＋教材＝授業。生徒カード→＋→教材窓が縦に並び、
              教材を取り込むと既存の一体カード（左＝教材／右＝生徒）に合体する */}
          {!hasContent && (
            <>
              <View style={styles.studentBand}>
                {/* 「今日の」＝生徒選択は日単位の割り当てであって、作る教材に紐付くものではない（誤認対策） */}
                <Text style={styles.lessonEyebrow}>今日の生徒</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 36, paddingVertical: 4 }}>
                  {STUDENTS.map((s) => {
                    const sel = selectedStudentId === s.id
                    const dim = !!selectedStudentId && !sel
                    return (
                      <TouchableOpacity key={s.id} onPress={() => setSelectedStudentId(s.id)} activeOpacity={0.8}
                        style={{ alignItems: 'center', gap: 5, width: 88, opacity: dim ? 0.55 : 1 }}>
                        <View style={[styles.bandAvatarWrap, sel && styles.bandAvatarSel]}>
                          <Image source={s.avatar} style={[styles.bandAvatar, { backgroundColor: s.tint }]} />
                        </View>
                        <Text style={[styles.bandName, dim && { color: c.textSub }]}>{s.name}</Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </View>
              {/* ＋＝授業の方程式（生徒＋教材）。装飾であり操作ではない */}
              <Text style={styles.plusGlyph}>＋</Text>
            </>
          )}

          {/* 教材未選択：アップロードUIも「アイブロウ付き白カード」の文法に揃える */}
          {!hasContent && (
          <View style={styles.createCard}>
            {/* ラベルは「今日の生徒」と対句の名詞（作成ダイアログでなく「今日の仕事の材料置き場」の顔にする） */}
            <Text style={styles.lessonEyebrow}>今日の教材</Text>

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
              <Text style={styles.uploadCardSub}>PNG / JPG / WEBP・最大{MAX_IMAGES}枚</Text>
              {/* 守備範囲の一言：計算演習でなく「覚える勉強」のアプリ（入れる教材を決める瞬間に伝える） */}
              <Text style={[styles.uploadCardSub, { fontSize: 11, marginTop: 4 }]}>用語・定義・年号など、覚える内容の教材に向いています</Text>
            </TouchableOpacity>
          )}

          {/* 状態1b: テキスト入力 */}
          {!hasPending && !hasContent && inputMode === 'text' && (
            <View style={styles.textInputCard}>
              <TextInput
                style={styles.textInputArea}
                value={textInput}
                onChangeText={(t) => setTextInput(t.slice(0, 3000))}
                placeholder="覚えたい内容を入力（用語・年号・定義など）"
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
          </View>
          )}

          {/* 状態3: 分析済み */}
          {hasContent && (
            <Animated.View style={{ transform: [{ scale: materialScale }] }}>
              {/* 教材＋生徒 分割カード（脚部に授業の長さ。カード＝授業の設定、下のボタン＝実行） */}
              <View style={styles.lessonCard}>
                <View style={styles.lessonCardRow}>
                  {/* 左：教材（タップで教材を見る。生徒側タップ＝生徒詳細と対称の文法）
                      アイブロウ「次の授業」は左カラム内：カード幅の行にすると生徒側の背景が上端に届かず切れる */}
                  <TouchableOpacity style={styles.lessonMaterial} onPress={() => void handlePreview()} disabled={previewLoading} activeOpacity={0.85}>
                    <Text style={styles.lessonEyebrow}>次の授業</Text>
                    <View>
                      {thumbnails[0] ? (
                        <Image source={{ uri: thumbnails[0] }} style={styles.lessonThumb} />
                      ) : (
                        // 横長ボックスに縦長のノート画像を入れると縦中央band＝ノート下部が見えてしまうので、
                        // 幅を測ってノートの中心をボックス中央に合わせる（端末サイズによらず中央表示）
                        <NotePlaceholder style={styles.lessonThumb} />
                      )}
                      {/* さりげないアフォーダンス：タップで開けることを示す */}
                      <View style={styles.lessonThumbOpenBadge}>
                        {previewLoading ? <ActivityIndicator color="#fff" size={10} /> : <Text style={styles.lessonThumbOpenText}>開く ›</Text>}
                      </View>
                    </View>
                    <Text style={styles.lessonMaterialTitle} numberOfLines={2}>{shortTitle}</Text>
                  </TouchableOpacity>

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
                        <Image source={selectedStudent.avatar} style={[styles.lessonStudentAvatar, { borderColor: c.border, backgroundColor: selectedStudent.tint }]} />
                        <View style={{ gap: 1, alignItems: 'center' }}>
                          <Text style={styles.lessonStudentName}>{selectedStudent.name}</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                            <PulseDot color={c.success} size={6} />
                            <Text style={{ fontSize: 10, fontWeight: '700', color: c.successText }}>オンライン</Text>
                          </View>
                        </View>
                      </>
                    ) : (
                      <>
                        <View style={styles.lessonStudentEmpty}>
                          <PawGlyph size={26} />
                        </View>
                        <Text style={styles.lessonStudentPickText}>生徒を{'\n'}選ぶ</Text>
                        <Text style={styles.lessonStudentPickSub}>タップ →</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>

                {/* 単元マップ：教材のカードを授業①〜に分けて、どこまで完了したかを見せる。
                    「完了」は先生の判断の記録（振り返りの中で決める）。次にやる単元はタップで選べる */}
                {/* カードバンク生成中：点線のゴーストノードで場所を確保しておく（完成時に唐突に現れない） */}
                {!unitInfo && (
                  <View style={styles.unitMap}>
                    <View style={styles.unitMapHeader}>
                      <Text style={styles.unitMapEyebrow}>授業を選ぶ</Text>
                    </View>
                    {/* 準備中の案内文はボタン側が担うので、ここは場所を確保する点線ノードだけ */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {[0, 1, 2].map((i) => <View key={i} style={styles.unitNodeGhost} />)}
                    </View>
                    <Text style={[styles.unitDetail, { opacity: 0 }]}>▸</Text>
                  </View>
                )}
                {unitInfo && (
                  <View style={styles.unitMap}>
                    <View style={styles.unitMapHeader}>
                      <Text style={styles.unitMapEyebrow}>授業を選ぶ</Text>
                      <Text style={styles.unitMapCount}>完了 {unitInfo.doneCount} / {unitInfo.units.length}</Text>
                    </View>
                    {/* 丸ノード：単元が増えても折り返して全体が一目で見える（ノートのページ送りドットと同じ文法）。
                        色＝状態（緑=完了・橙=未完了・白=未開始）、選択中はページ送りと同じ「塗り」で示す */}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {unitInfo.units.map((_, i) => {
                        const st = unitInfo.statuses[i]
                        const sel = i === unitInfo.selected
                        return (
                          <TouchableOpacity
                            key={i}
                            onPress={() => setHomeUnitIdx(i)}
                            style={[styles.unitNode,
                              st === 'done' && styles.unitNodeDone,
                              st === 'tried' && styles.unitNodeTried,
                              sel && styles.unitNodeSel]}
                            activeOpacity={0.8}
                          >
                            <Text style={[styles.unitNodeText,
                              st === 'done' && { color: '#059669' },
                              st === 'tried' && { color: '#b45309' },
                              sel && { color: 'white' }]}>{i + 1}</Text>
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                    {/* 選択中の単元の詳細（左）と生徒のテスト（右）を同じ行に振り分ける（左偏りの解消） */}
                    {(() => {
                      const entry = currentHistoryId ? examDays[currentHistoryId] : undefined
                      const showExam = entry && !entry.doneAt
                      return (
                        <View style={styles.unitDetailRow}>
                          <Text style={styles.unitDetail}>
                            ▸ 授業{unitLabel(unitInfo.selected)}（{unitInfo.units[unitInfo.selected].size}問）・{unitInfo.statuses[unitInfo.selected] === 'done' ? '完了' : unitInfo.statuses[unitInfo.selected] === 'tried' ? '未完了' : '未開始'}
                          </Text>
                          {showExam && (
                            <View style={styles.unitExamRow}>
                              <Feather name="file-text" size={12} color={c.link} />
                              <Text style={styles.unitExam}>生徒のテスト：{examDateLabel(entry!.date)}{entry!.round > 1 ? '（追試）' : ''}</Text>
                            </View>
                          )}
                        </View>
                      )
                    })()}
                  </View>
                )}

                {/* CTAはカードの内側：このカード一式＝授業のしごと、という単位にする。
                    カードバンク生成中（unitInfoなし）は授業を始められないので押せない。
                    生成失敗時はスピナーのまま待たせず、CTA自体を再試行ボタンに切り替える */}
                {(() => {
                  const factsheetFailed = !unitInfo && !!currentHistoryId && factsheetErrorIds.has(currentHistoryId)
                  return (
                <BouncyPressable
                  style={[styles.startBtn, (!selectedStudentId || (!unitInfo && !factsheetFailed)) && styles.startBtnDisabled, factsheetFailed && { backgroundColor: '#f59e0b' }]}
                  disabled={!unitInfo && !factsheetFailed}
                  onPress={() => {
                    if (factsheetFailed) { retryFactsheet(); return }
                    if (!unitInfo) return
                    if (!selectedStudentId) { showToast(); return }
                    // 選択中の単元を授業画面へ引き継ぐ
                    setLessonUnit(unitInfo.selected)
                    router.push('/chat')
                  }}
                  haptic="medium"
                >
                  {factsheetFailed ? (
                    <Text style={styles.startBtnText}>教材の準備に失敗しました。もう一度試す</Text>
                  ) : !unitInfo ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <ActivityIndicator color={c.primary} size="small" />
                      <Text style={[styles.startBtnText, styles.startBtnTextDisabled]}>授業を準備しています…</Text>
                    </View>
                  ) : selectedStudentId ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="chatbubble-ellipses-outline" size={16} color="white" />
                      <Text style={styles.startBtnText}>{unitInfo.units.length > 1 ? `授業${unitLabel(unitInfo.selected)}をする` : '授業をする'}</Text>
                    </View>
                  ) : (
                    <Text style={[styles.startBtnText, styles.startBtnTextDisabled]}>生徒を選ぶと始められます</Text>
                  )}
                </BouncyPressable>
                  )
                })()}
              </View>
            </Animated.View>
          )}
        </View>

        {/* しごとカード：「今日の仕事」ゾーンの続き。動詞タイトル＋行き先サブ＋状態バッジで自己紹介する
            （並びはタブ順＝教材が左・研修が右） */}
        {history.length > 0 && (() => {
          const pendingCount = history.flatMap((h) => h.factsheet?.cards ?? []).filter((cd) => drillPendingKeys.has(cd.statement.replace(/[\s　]/g, ''))).length
          return (
            <View style={styles.quickRow}>
              <TouchableOpacity style={styles.jobCard} onPress={() => router.push('/library')} activeOpacity={0.8} disabled={analyzing}>
                <Ionicons name="book-outline" size={15} color={c.blazer} />
                <Text style={styles.jobTitle} numberOfLines={1}>教材を確認する</Text>
                <View style={[styles.jobBadge, { backgroundColor: c.skyBg }]}><Text style={[styles.jobBadgeText, { color: c.link }]}>{history.length}冊</Text></View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.jobCard} onPress={() => router.push('/training')} activeOpacity={0.8} disabled={analyzing}>
                <Ionicons name="school-outline" size={15} color={c.blazer} />
                <Text style={styles.jobTitle} numberOfLines={1}>研修を受ける</Text>
                {/* 「まだ」バッジはピンク系（研修タブと統一。まだ＝研修のあなたの判断の記録） */}
                {pendingCount > 0 && (
                  <View style={[styles.jobBadge, { backgroundColor: '#fce7f3' }]}><Text style={[styles.jobBadgeText, { color: '#be185d' }]}>まだ {pendingCount}</Text></View>
                )}
              </TouchableOpacity>
            </View>
          )
        })()}

        {/* 最近の教材 */}
        <View style={styles.recentSection}>
          <View style={[styles.sectionHeader, { marginBottom: 12 }]}>
            {/* ライブラリへの導線は「教材を確認する」カードに一本化（すべて見る→は削除） */}
            <Text style={styles.sectionTitle}>最近の教材</Text>
          </View>

          {history.length === 0 ? (
            <Text style={styles.recentEmpty}>取り込んだ教材がここに並びます</Text>
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
                        <View style={[styles.recentThumb, { backgroundColor: c.bgSub, overflow: 'hidden' }]}>
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
                <TouchableOpacity style={styles.seeAllBtn} onPress={() => router.push('/library')} disabled={analyzing}>
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
                    <Image source={selectedStudent.avatar} style={[styles.profileAvatar, { backgroundColor: selectedStudent.tint }]} />
                  </TouchableOpacity>
                  <View>
                    <Text style={styles.profileName}>{selectedStudent.name}</Text>
                    <Text style={styles.profileTagline}>{selectedStudent.tagline}</Text>
                  </View>
                </View>
                {/* この生徒との記録：見ている文脈でだけ出す（ホーム常設にはしない） */}
                {(() => {
                  const lastLesson = history.reduce<{ title: string; at: number } | null>((acc, h) => {
                    const r = h.recaps?.[selectedStudent.id]
                    return r && r.savedAt > (acc?.at ?? 0) ? { title: h.title.replace(/^この(教材|文書|画像|写真)は[、，]?\s*/u, ''), at: r.savedAt } : acc
                  }, null)
                  if (!lastLesson) return null
                  return (
                    <View style={styles.profileRecord}>
                      <View style={styles.profileRecordRow}>
                        <Text style={styles.profileRecordLabel}>前回の授業</Text>
                        <Text style={styles.profileRecordValue} numberOfLines={1}>
                          {new Date(lastLesson.at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}「{lastLesson.title}」
                        </Text>
                      </View>
                    </View>
                  )
                })()}
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
                      <Image source={s.avatar} style={[styles.pickerItemAvatar, { backgroundColor: s.tint }]} />
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
              {/* サモエドは白いので、先生と同じ白背景だと沈む。生徒ごとのキャラ色の淡ティントを敷いて映えさせる */}
              <View style={{ width: 208, height: 208, borderRadius: 104, overflow: 'hidden', borderWidth: 4, borderColor: 'white', backgroundColor: selectedStudent?.tint ?? c.bgSub }}>
                {selectedStudent && <Image source={selectedStudent.avatar} style={{ width: '100%', height: '100%' }} />}
              </View>
            </Pressable>
          </Modal>
        </View>
      </Modal>

      {/* アバター拡大表示 */}
      <Modal visible={showTeacherAvatar} transparent animationType="fade" onRequestClose={() => setShowTeacherAvatar(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }} onPress={() => setShowTeacherAvatar(false)}>
          <View style={{ width: 208, height: 208, borderRadius: 104, overflow: 'hidden', borderWidth: 4, borderColor: 'white', backgroundColor: 'white' }}>
            <Image source={getTeacherAvatarImage(teacherProfile.avatarId)} style={{ width: '100%', height: '100%', transform: [{ translateY: avatarNudgeY(teacherProfile.avatarId, 208) }] }} />
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
                        <Image source={student.avatar} style={styles.inboxAvatarImg} />
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
                          <Text style={styles.inboxOpenBtnText}>この教材を開いて教える</Text>
                        </TouchableOpacity>
                      )}
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

            <ScrollView showsVerticalScrollIndicator={false}>
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
                      <Image source={getTeacherAvatarImage(teacherProfile.avatarId)} style={[styles.tcAvatarImage, { transform: [{ translateY: avatarNudgeY(teacherProfile.avatarId, 82) }] }]} />
                    </View>
                  </View>
                  <View style={styles.tcNameArea}>
                    <Text style={styles.tcName}>
                      {teacherProfile.name
                        ? <>{teacherProfile.name}<Text style={styles.tcNameSuffix}> 先生</Text></>
                        : <Text style={styles.tcNameEmpty}>（名前未設定）</Text>
                      }
                    </Text>
                  </View>
                  {/* 実績バッジ：カード下部に配置（0回でも常時表示＝記録の置き場を最初から見せる）。
                      タップで記録簿（全件リスト）が開く。ICチップ装飾は「ボタンに見える」ため廃止 */}
                  <TouchableOpacity
                    style={[styles.tcTitleBadge, { alignSelf: 'center', marginBottom: 30 }]}
                    onPress={() => setShowExamLog(true)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.tcTitleText}>生徒の快挙　{examSuccess}回 ›</Text>
                  </TouchableOpacity>
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
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 業務日誌シート：メール・先生証と並ぶ独立の面。その日にした仕事のスタンプ（出来事の記録のみ） */}
      <Modal visible={journalOpen} transparent animationType="slide" onRequestClose={() => setJournalOpen(false)}>
        <View style={styles.studentSheetContainer}>
          <Pressable style={styles.studentSheetOverlay} onPress={() => setJournalOpen(false)} />
          <View style={styles.studentSheetBottom}>
            <View style={styles.studentSheetHandle} />
            {(() => {
              const startPad = new Date(journalMonth.y, journalMonth.m, 1).getDay()
              const daysInMonth = new Date(journalMonth.y, journalMonth.m + 1, 0).getDate()
              const now = new Date()
              const isCurrentMonth = journalMonth.y === now.getFullYear() && journalMonth.m === now.getMonth()
              const cells: (number | null)[] = [...Array(startPad).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
              // テストに向けた授業の完了状況（詳細行と期日間近の強調に使う）
              const examProgressOf = (hid: string) => {
                const cards = history.find((h) => h.id === hid)?.factsheet?.cards ?? []
                const units = splitUnits(cards.length)
                if (units.length === 0) return null
                const up = unitProgress[hid]
                const statuses: Record<number, UnitStatus> = up && up.count === cards.length ? up.status : {}
                return { done: units.filter((_, i) => statuses[i] === 'done').length, total: units.length }
              }
              // 生徒のテストの予定日（存在する教材のものだけ）。未来の月にも印がつくので月送りは制限しない。
              // examRisk＝期日2日以内なのに授業が未完了の日（催促メールと同じ条件式）
              const examMarks = new Set<string>()
              const examRisk = new Set<string>()
              const riskLimit = dateKeyAfterDays(2)
              const todayKey = todayDateKey()
              // 大成功の日＝金の印（記録簿と同じ金 #fcd34d。達成の痕跡がカレンダーにも残る）
              const successDates = new Set(examSuccessLog.map((r) => r.d))
              for (const [hid, e] of Object.entries(examDays)) {
                if (e.doneAt || !history.some((h) => h.id === hid)) continue
                examMarks.add(e.date)
                if (e.date < todayKey || e.date > riskLimit) continue
                const p = examProgressOf(hid)
                if (p && p.done < p.total) examRisk.add(e.date)
              }
              return (
                <View style={{ paddingHorizontal: 4, paddingTop: 4 }}>
                  <View style={styles.journalHeader}>
                    <Text style={styles.journalTitle}>業務日誌</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <TouchableOpacity onPress={() => setJournalMonth(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))} hitSlop={8}>
                        <Text style={styles.journalNav}>‹</Text>
                      </TouchableOpacity>
                      <Text style={styles.journalMonth}>{journalMonth.y}年{journalMonth.m + 1}月</Text>
                      <TouchableOpacity onPress={() => setJournalMonth(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))} hitSlop={8}>
                        <Text style={styles.journalNav}>›</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={styles.journalGrid}>
                    {['日', '月', '火', '水', '木', '金', '土'].map((w) => (
                      <Text key={w} style={styles.journalWeekday}>{w}</Text>
                    ))}
                    {cells.map((day, i) => {
                      if (day === null) return <View key={`pad${i}`} style={styles.journalCell} />
                      const key = workDateKey(journalMonth.y, journalMonth.m, day)
                      const e = workLog[key]
                      const hasExam = examMarks.has(key)
                      const hasSuccess = successDates.has(key)
                      const isToday = isCurrentMonth && day === now.getDate()
                      const hasAny = !!e || hasExam || hasSuccess
                      const selected = journalDay === key
                      return (
                        <TouchableOpacity key={`d${day}`} activeOpacity={0.6}
                          onPress={() => setJournalDay(selected ? null : key)}
                          style={[styles.journalCell, selected ? styles.journalCellSel : isToday && styles.journalCellToday]}>
                          <Text style={[styles.journalDay, hasAny && styles.journalDayActive, selected && { color: 'white' }]}>{day}</Text>
                          <View style={styles.journalDots}>
                            {e?.lesson ? <View style={[styles.journalDot, { backgroundColor: '#ec4899' }]} /> : null}
                            {e?.drill ? <View style={[styles.journalDot, { backgroundColor: '#f59e0b' }]} /> : null}
                            {hasExam ? <View style={[styles.journalDot, { backgroundColor: '#0ea5e9' }, examRisk.has(key) && { borderWidth: 2, borderColor: '#bae6fd' }]} /> : null}
                            {hasSuccess ? <View style={[styles.journalDot, { backgroundColor: '#fcd34d' }]} /> : null}
                          </View>
                        </TouchableOpacity>
                      )
                    })}
                  </View>
                  <View style={styles.journalLegend}>
                    <View style={styles.journalLegendItem}><View style={[styles.journalDot, { backgroundColor: '#ec4899' }]} /><Text style={styles.journalLegendText}>授業</Text></View>
                    <View style={styles.journalLegendItem}><View style={[styles.journalDot, { backgroundColor: '#f59e0b' }]} /><Text style={styles.journalLegendText}>研修</Text></View>
                    <View style={styles.journalLegendItem}><View style={[styles.journalDot, { backgroundColor: '#0ea5e9' }]} /><Text style={styles.journalLegendText}>生徒のテスト</Text></View>
                    <View style={styles.journalLegendItem}><View style={[styles.journalDot, { backgroundColor: '#fcd34d' }]} /><Text style={styles.journalLegendText}>快挙</Text></View>
                  </View>
                  {/* その日の詳細：予定されているテスト（誰の何の授業）・実施した授業/研修（誰に何を） */}
                  {journalDay && (() => {
                    const matTitle = (hid?: string) => history.find((h) => h.id === hid)?.title.replace(/^この(教材|文書|画像|写真)は[、，]?\s*/u, '').slice(0, 20) ?? '教材'
                    const parts = journalDay.split('-')
                    const exams = Object.entries(examDays).filter(([hid, en]) => en.date === journalDay && !en.doneAt && history.some((h) => h.id === hid))
                    const daySuccesses = examSuccessLog.filter((r) => r.d === journalDay)
                    const entries = workLog[journalDay]?.entries ?? []
                    return (
                      <View style={styles.journalDetail}>
                        <Text style={styles.journalDetailDate}>{Number(parts[1])}月{Number(parts[2])}日</Text>
                        {daySuccesses.map((r) => {
                          const st = STUDENTS.find((s) => s.id === r.s)
                          return (
                            <View key={`sc${r.id}`} style={styles.journalDetailRow}>
                              <View style={[styles.journalDot, { backgroundColor: '#fcd34d', marginTop: 5 }]} />
                              <Text style={styles.journalDetailText}>{st ? `${st.name}の` : ''}「{r.t}」のテスト <Text style={{ fontWeight: '700', color: '#b45309' }}>快挙達成</Text></Text>
                            </View>
                          )
                        })}
                        {exams.map(([hid, en]) => {
                          const st = STUDENTS.find((s) => s.id === en.studentId)
                          const p = examProgressOf(hid)
                          const near = p && p.done < p.total && en.date <= riskLimit
                          return (
                            <View key={`ex${hid}`} style={styles.journalDetailRow}>
                              <View style={[styles.journalDot, { backgroundColor: '#0ea5e9', marginTop: 5 }]} />
                              <Text style={styles.journalDetailText}>
                                {st ? `${st.name}の` : ''}「{matTitle(hid)}」のテスト{en.round > 1 ? '（追試）' : ''}
                                {/* 準備状況：締切だけでなく安心/残作業も見せる */}
                                {p && (p.done === p.total
                                  ? <Text style={{ color: '#059669' }}> ・授業 ぜんぶ完了</Text>
                                  : <Text style={near ? { color: c.primaryStrong, fontWeight: '700' } : undefined}> ・授業 {p.done}/{p.total} 完了</Text>)}
                              </Text>
                            </View>
                          )
                        })}
                        {entries.map((en, k) => {
                          const st = STUDENTS.find((s) => s.id === en.s)
                          return (
                            <View key={`en${k}`} style={styles.journalDetailRow}>
                              <View style={[styles.journalDot, { backgroundColor: en.k === 'lesson' ? '#ec4899' : '#f59e0b', marginTop: 5 }]} />
                              <Text style={styles.journalDetailText}>{en.k === 'lesson' ? `${st ? st.name + 'に' : ''}「${matTitle(en.h)}」の授業${en.u !== undefined ? unitLabel(en.u) : ''}` : `「${en.h ? matTitle(en.h) : '全部ミックス'}」の研修`}</Text>
                            </View>
                          )
                        })}
                        {exams.length === 0 && entries.length === 0 && (
                          <Text style={styles.journalDetailEmpty}>この日の記録の詳細はありません</Text>
                        )}
                      </View>
                    )
                  })()}
                </View>
              )
            })()}
            <TouchableOpacity style={styles.sheetCloseBtn} onPress={() => setJournalOpen(false)}>
              <Text style={styles.sheetCloseBtnText}>閉じる</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 画像プリロード：初回表示を高速化 */}
      <View style={{ width: 0, height: 0, overflow: 'hidden', position: 'absolute' }}>
        {Object.values(TEACHER_AVATAR_IMAGES).map((src, i) => (
          <Image key={i} source={src} style={{ width: 1, height: 1 }} />
        ))}
      </View>

      {/* 大成功の記録簿：追記専用の全件リスト（ずらっと増えていくこと自体が報酬） */}
      <Modal visible={showExamLog} transparent animationType="slide" onRequestClose={() => setShowExamLog(false)}>
        <View style={styles.studentSheetContainer}>
          <Pressable style={styles.studentSheetOverlay} onPress={() => setShowExamLog(false)} />
          <View style={[styles.studentSheetBottom, { maxHeight: '75%' }]}>
            <View style={styles.studentSheetHandle} />
            <Text style={styles.examLogTitle}>快挙の記録　<Text style={styles.examLogCount}>{examSuccess}回</Text></Text>
            {examSuccessLog.length === 0 ? (
              <Text style={styles.examLogEmpty}>まだ記録がありません。{'\n'}テストの日までに授業を全て終えると、ここに刻まれていきます</Text>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
                {[...examSuccessLog].reverse().map((r, i) => {
                  const st = STUDENTS.find((s) => s.id === r.s)
                  return (
                    <View key={r.id} style={[styles.examLogRow, i > 0 && styles.examLogRowBorder]}>
                      <View style={styles.examLogDot} />
                      <Text style={styles.examLogDate}>{examDateLabel(r.d)}</Text>
                      {st && <Image source={st.avatar} style={[styles.examLogAvatar, { backgroundColor: st.tint }]} />}
                      <Text style={styles.examLogText} numberOfLines={1}>{st ? `${st.name}・` : ''}「{r.t}」のテスト</Text>
                    </View>
                  )
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <BottomTabBar active="home" />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.skyBg },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingVertical: 24, gap: 16 },

  // ヘッダー（静かな家具：画面の主役は授業カード＋ピンクCTA。紺は面でなく「印」として
  // アプリ名・アイコンにだけ宿す。ヒエラルキー＝CTA＞授業情報＞ヘッダー）
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  appTitle: { fontSize: 18, fontFamily: font.roundHeavy, color: c.ink, letterSpacing: -0.3 },
  appSubtitle: { fontSize: 10, color: c.blazer, fontWeight: '700', letterSpacing: 0.3 },
  headerIcons: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  mailIconBtn: { alignItems: 'center', gap: 2, position: 'relative' },
  mailIconCircle: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'white', borderWidth: 1, borderColor: c.borderStrong,
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
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'white', borderWidth: 1, borderColor: c.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  teacherIconLabel: { fontSize: 9, fontWeight: '700', color: c.textSub, letterSpacing: 0.5 },

  // セクション共通
  todaySection: { gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 13, fontFamily: font.round, color: c.skyStrong, letterSpacing: 0.8 },
  sectionClear: { fontSize: 11, color: c.textSub, fontWeight: '500' },

  // 状態1：アップロード
  // 教材を作るカード（アップロードUIの器。選択後の授業カードと同じ文法）
  createCard: { backgroundColor: 'white', borderRadius: 20, borderWidth: 1, borderColor: c.border, padding: 12, gap: 10 },
  inputModeTabs: { flexDirection: 'row', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: c.border },
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

  // 初回ヒーロー（教材0件のときだけ。生徒の顔は生徒カード側が担う）
  heroCard: { alignItems: 'center', paddingTop: 4, marginBottom: 12 },
  heroTitle: { fontSize: 20, fontFamily: font.round, color: c.textStrong },
  heroSub: { fontSize: 12, color: c.textSub, marginTop: 6, textAlign: 'center', lineHeight: 18 },

  // 組み立て台の生徒カード（生徒＋教材＝授業）
  studentBand: { backgroundColor: 'white', borderRadius: 20, borderWidth: 1, borderColor: c.border, padding: 12 },
  bandAvatarWrap: { borderRadius: 999, padding: 2, borderWidth: 2, borderColor: 'transparent' },
  bandAvatarSel: { borderColor: c.primary },
  bandAvatar: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: c.border },
  bandName: { fontSize: 12, fontFamily: font.round, color: c.textStrong },
  plusGlyph: { textAlign: 'center', fontSize: 16, fontWeight: '700', color: c.faint, marginVertical: -2 },

  // 状態2：ペンディング（createCardの中に入るため器の装飾は持たない）
  pendingCard: { gap: 12 },
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
  lessonEyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 2, color: c.faint, marginBottom: -2 },
  lessonCardRow: { flexDirection: 'row' },
  lessonLengthRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: c.bgSub,
  },
  lessonLengthLabel: { fontSize: 11, fontWeight: '600', color: c.textSub },
  lessonLengthValue: { fontSize: 12, fontWeight: '700', color: c.textStrong },
  lessonMaterial: { flex: 1, padding: 14, gap: 8 },
  lessonThumb: { width: '100%', aspectRatio: 1.7, borderRadius: 12 },
  lessonThumbText: { backgroundColor: c.pinkSoft, alignItems: 'center', justifyContent: 'center' },
  lessonMaterialTitle: { fontSize: 13, fontWeight: '700', color: c.textStrong, lineHeight: 18 },
  lessonThumbOpenBadge: {
    position: 'absolute', bottom: 5, right: 5,
    backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 999,
    paddingHorizontal: 7, paddingVertical: 2, minWidth: 34, alignItems: 'center',
  },
  lessonThumbOpenText: { fontSize: 9, fontWeight: '700', color: 'white' },
  lessonDivider: { width: 1, backgroundColor: c.border, marginVertical: 16 },
  lessonStudent: {
    width: 118, padding: 14,
    alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: c.pinkTint,
  },
  lessonStudentAvatar: { width: 64, height: 64, borderRadius: 32, borderWidth: 1 },
  lessonStudentName: { fontSize: 12, fontFamily: font.round, color: c.textStrong },
  lessonStudentEmpty: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: c.pinkSoft, alignItems: 'center', justifyContent: 'center',
  },
  lessonStudentPickText: { fontSize: 13, fontWeight: '700', color: c.primary, textAlign: 'center' },
  lessonStudentPickSub: { fontSize: 10, color: c.primary },

  // 単元マップ（授業①〜・完了 n/m・タップで選択）
  unitMap: { borderTopWidth: 1, borderTopColor: c.bgSub, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 2 },
  unitMapHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  unitMapEyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 2, color: c.faint },
  unitMapCount: { fontSize: 10, fontWeight: '700', color: c.faint },
  unitNode: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 1, borderColor: c.border, backgroundColor: 'white',
    alignItems: 'center', justifyContent: 'center',
  },
  unitNodeGhost: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 1, borderColor: c.borderStrong, borderStyle: 'dashed', backgroundColor: c.bgSub,
  },
  unitNodeDone: { borderColor: '#a7f3d0', backgroundColor: '#ecfdf5' },
  unitNodeTried: { borderColor: '#fde68a', backgroundColor: '#fffbeb' },
  unitNodeSel: { borderWidth: 2, borderColor: c.primaryStrong, backgroundColor: c.primaryStrong },
  unitNodeText: { fontSize: 12, fontWeight: '700', color: c.textSub },
  unitDetailRow: { marginTop: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  unitDetail: { fontSize: 11, fontWeight: '700', color: c.textSub, flexShrink: 1 },
  unitExamRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  unitExam: { fontSize: 11, fontWeight: '700', color: c.link },

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
  // しごとカード（教材を確認する／研修を受ける）
  quickRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  jobCard: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'white', borderWidth: 1, borderColor: c.border, borderRadius: 16,
    paddingHorizontal: 11, paddingVertical: 12,
  },
  jobTitle: { flex: 1, fontSize: 12, fontWeight: '800', color: c.textStrong },
  jobBadge: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 },
  jobBadgeText: { fontSize: 10, fontWeight: '700' },
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
  deleteBtnText: { fontSize: 13, color: c.textSub },
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
  // この生徒との記録（前回の授業・宿題状態）
  profileRecord: { backgroundColor: c.bg, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, gap: 6, marginTop: 12 },
  profileRecordRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  profileRecordLabel: { fontSize: 11, fontWeight: '700', color: c.faint, flexShrink: 0 },
  profileRecordValue: { fontSize: 12, color: c.textMid, flex: 1 },
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
  examHint: { fontSize: 10, color: c.textSub, marginTop: 10 },
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
  hwBadgeIconWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'white', borderWidth: 1, borderColor: '#fde68a', alignItems: 'center', justifyContent: 'center' },
  hwBadgeIcon: { width: 26, height: 26 },
  hwBadgeTitle: { fontSize: 12, fontWeight: '700', color: '#92400e' },
  hwBadgeSub: { fontSize: 11, color: '#b45309', marginTop: 1 },
  hwBadgeChevron: { fontSize: 20, color: '#d97706', fontWeight: '400' },
  hwBadgeMuted: { backgroundColor: c.bgSub, borderColor: c.border },
  hwBadgeIconMuted: { backgroundColor: 'white', borderColor: c.border },
  hwBadgeTitleMuted: { fontSize: 12, fontWeight: '700', color: c.textMid },
  hwBadgeSubMuted: { fontSize: 11, color: c.textSub, marginTop: 1 },
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
  hwModelText: { fontSize: 11, color: c.redpen, lineHeight: 17, marginTop: 3 },
  hwModelMark: { fontWeight: '700' },
  hwModelWord: { fontWeight: '700', color: c.redpen },
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
  tcSheetBottom: { backgroundColor: c.ink, paddingHorizontal: 0, paddingBottom: 0, paddingTop: 0, maxHeight: '92%' },

  // 業務日誌（ヘッダーの独立シート。明るい配色）
  journalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  journalTitle: { fontSize: 13, fontWeight: '900', letterSpacing: 1, color: c.text },
  journalNav: { fontSize: 16, color: c.faint, paddingHorizontal: 6 },
  journalMonth: { fontSize: 12, fontWeight: '700', color: c.textMid, fontVariant: ['tabular-nums'] },
  journalGrid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: c.bgSub, borderRadius: 16, borderWidth: 1, borderColor: c.border, padding: 10 },
  journalWeekday: { width: '14.28%', textAlign: 'center', fontSize: 9, fontWeight: '700', color: c.faint, marginBottom: 4 },
  journalCell: { width: '14.28%', alignItems: 'center', paddingVertical: 3, borderRadius: 8, gap: 1 },
  journalCellToday: { backgroundColor: c.pinkTint },
  journalCellSel: { backgroundColor: c.ink },
  journalDetail: { marginTop: 12, borderRadius: 16, borderWidth: 1, borderColor: c.border, backgroundColor: c.bgSub, padding: 12, gap: 6 },
  journalDetailDate: { fontSize: 12, fontWeight: '700', color: c.textMid, marginBottom: 2 },
  journalDetailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  journalDetailText: { flex: 1, fontSize: 11, lineHeight: 16, color: c.textSub },
  journalDetailEmpty: { fontSize: 11, color: c.textSub },
  journalDay: { fontSize: 11, color: c.faint, fontVariant: ['tabular-nums'] },
  journalDayActive: { color: c.textMid, fontWeight: '700' },
  journalDots: { flexDirection: 'row', gap: 2, height: 6 },
  journalDot: { width: 6, height: 6, borderRadius: 3 },
  journalLegend: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 12 },
  journalLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  journalLegendText: { fontSize: 10, fontWeight: '600', color: c.textSub },
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
    backgroundColor: 'white', overflow: 'hidden',
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.65)',
    alignItems: 'center', justifyContent: 'center',
  },
  tcAvatarImage: { width: 82, height: 82 },
  tcNameArea: { alignItems: 'center', gap: 8 },
  tcName: { fontSize: 22, fontFamily: font.roundHeavy, color: 'white', letterSpacing: 0.5 },
  tcNameSuffix: { fontSize: 14, fontWeight: '400', color: 'rgba(255,255,255,0.7)' },
  tcNameEmpty: { fontSize: 14, fontWeight: '400', color: 'rgba(255,255,255,0.35)' },
  tcTitleBadge: {
    paddingHorizontal: 14, paddingVertical: 4, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  tcTitleText: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.75)', letterSpacing: 1.5 },
  tcEditHint: { position: 'absolute', bottom: 10, left: 0, right: 0, alignItems: 'center' },
  tcEditHintText: { fontSize: 11, color: 'rgba(255,255,255,0.7)', letterSpacing: 0.5 },

  // 大成功の記録簿（追記専用の全件リスト。金＝儀式の金 #fcd34d）
  examLogTitle: { fontSize: 15, fontWeight: '900', color: c.textStrong, marginBottom: 10 },
  examLogCount: { fontSize: 12, fontWeight: '700', color: c.textSub },
  examLogEmpty: { fontSize: 12, color: c.textSub, textAlign: 'center', lineHeight: 20, paddingVertical: 40 },
  examLogRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11 },
  examLogRowBorder: { borderTopWidth: 1, borderTopColor: c.bgSub },
  examLogDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fcd34d' },
  examLogDate: { width: 56, fontSize: 11, fontWeight: '700', color: c.textSub, fontVariant: ['tabular-nums'] },
  examLogAvatar: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: c.border },
  examLogText: { flex: 1, fontSize: 13, fontWeight: '600', color: c.textMid },
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
