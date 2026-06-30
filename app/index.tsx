import {
  View, Text, TouchableOpacity, ScrollView, Image,
  StyleSheet, ActivityIndicator, Alert, Animated, Modal, Pressable,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { BottomTabBar } from '@/components/BottomTabBar'
import { useEffect, useRef, useState } from 'react'
import * as ImagePicker from 'expo-image-picker'
import { useApp } from '@/lib/AppContext'
import { STUDENTS } from '@/lib/students'
import { analyzeImages, fetchPreviewContent } from '@/lib/api'
import {
  loadHistory, saveToHistory, deleteFromHistory, updateHistoryPreview, HISTORY_MAX,
  loadSavedGroups, saveGroupsList,
} from '@/lib/storage'
import type { HistoryItem } from '@/lib/types'

type ImageData = { data: string; mimeType: string; uri: string }

const MAX_IMAGES = 3

export default function HomeScreen() {
  const router = useRouter()
  const {
    imageDescription, setImageDescription,
    setNotes,
    previewContent, setPreviewContent,
    selectedStudentId, setSelectedStudentId,
    thumbnails, setThumbnails,
    currentHistoryId, setCurrentHistoryId,
    resetChatSession,
  } = useApp()

  const [analyzing, setAnalyzing] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null)
  const [pendingImages, setPendingImages] = useState<ImageData[]>([])
  const [studentSheet, setStudentSheet] = useState<'profile' | 'picker' | null>(null)

  const selectedStudent = STUDENTS.find(s => s.id === selectedStudentId) ?? null

  useEffect(() => {
    loadHistory().then(setHistory)
  }, [])

  const hasPending = pendingImages.length > 0
  const hasContent = !!imageDescription

  // ピッカーを開いて画像を選ぶ（replace or add）
  const openPicker = async (mode: 'replace' | 'add') => {
    const remaining = mode === 'add' ? MAX_IMAGES - pendingImages.length : MAX_IMAGES
    if (remaining <= 0) return
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
      void backgroundFetchPreview(res.imageDescription, saved.id)
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
    if (activeHistoryId === item.id) { clearSelection(); return }
    setPendingImages([])
    resetChatSession()
    setActiveHistoryId(item.id)
    setCurrentHistoryId(item.id)
    setImageDescription(item.imageDescription)
    setNotes(item.notes)
    setThumbnails(item.thumbnails)
    setPreviewContent(item.previewContent ?? null)
    if (!item.previewContent) {
      void backgroundFetchPreview(item.imageDescription, item.id)
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
    if (previewLoading) return // バックグラウンド処理中はボタン無効のため到達しない
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

  const shortTitle = imageDescription
    ? imageDescription.replace(/^この(教材|文書|画像)は[、,]?\s*/u, '').split('。')[0].slice(0, 36)
    : ''

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
          <Text style={styles.appTitle}>OSHIETE!</Text>
          <Text style={styles.appSubtitle}>教えるほど、身につく。</Text>
        </View>

        {/* ── 状態1: 何も選ばれていない ── */}
        {!hasPending && !hasContent && (
          <TouchableOpacity style={styles.uploadBtnLarge} onPress={() => openPicker('replace')}>
            <Text style={styles.uploadBtnLargeIcon}>📷</Text>
            <Text style={styles.uploadBtnLargeText}>教材の写真を選ぶ</Text>
            <Text style={styles.uploadBtnLargeSub}>PNG / JPG・最大{MAX_IMAGES}枚</Text>
          </TouchableOpacity>
        )}

        {/* ── 状態2: 写真選択済み・未分析 ── */}
        {hasPending && !hasContent && (
          <View style={styles.pendingCard}>
            {/* サムネイル + 枚数表示 */}
            <View style={styles.thumbRowWrap}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbRow}>
                {pendingImages.map((img, i) => (
                  <Image key={i} source={{ uri: img.uri }} style={styles.thumb} />
                ))}
              </ScrollView>
              <Text style={styles.thumbCounter}>{pendingImages.length}/{MAX_IMAGES}</Text>
            </View>

            {/* 分析ボタン */}
            <TouchableOpacity
              style={[styles.analyzeBtn, analyzing && styles.analyzeBtnLoading]}
              onPress={analyzeFromPending}
              disabled={analyzing}
            >
              {analyzing ? (
                <View style={styles.row}>
                  <ActivityIndicator color="white" />
                  <Text style={[styles.analyzeBtnText, { marginLeft: 8 }]}>読み込み中...</Text>
                </View>
              ) : (
                <Text style={styles.analyzeBtnText}>🔍　この教材を分析する</Text>
              )}
            </TouchableOpacity>

            {/* 写真を追加 / 変更 */}
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

        {/* ── 状態3: 分析済み ── */}
        {hasContent && (
          <>
            {/* 教材カード + 教材を見る を1ユニット（タイトな間隔） */}
            <View style={styles.materialUnit}>
            {/* 選択中教材カード */}
            <View style={styles.contentCard}>
              <View style={styles.contentCardHeader}>
                <Text style={styles.contentCardHeaderLabel}>現在の教材</Text>
                <TouchableOpacity onPress={() => openPicker('replace')}>
                  <Text style={styles.contentCardHeaderAction}>写真を選ぶ →</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.contentCardInner}>
                {thumbnails[0] ? (
                  <Image source={{ uri: thumbnails[0] }} style={styles.contentThumb} />
                ) : (
                  <View style={[styles.contentThumb, { backgroundColor: '#e2e8f0' }]} />
                )}
                <Text style={styles.contentTitle} numberOfLines={2}>{shortTitle}</Text>
                <TouchableOpacity
                  onPress={clearSelection}
                  style={styles.contentClear}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.contentClearText}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* 教材を見るボタン */}
            <View>
              <TouchableOpacity
                style={styles.actionBtnPreview}
                onPress={handlePreview}
                disabled={previewLoading}
              >
                {previewLoading ? (
                  <ActivityIndicator color="#0369a1" />
                ) : (
                  <Text style={styles.actionBtnPreviewText}>📖　教材を見る</Text>
                )}
              </TouchableOpacity>
              <Text style={styles.actionNote}>授業中でも確認できます</Text>
            </View>
            </View>{/* /materialUnit */}

            {/* 授業セクション */}
            <View style={[styles.chatSection, { marginTop: 8 }]}>
              <Text style={styles.chatSectionLabel}>授業する生徒を選ぶ</Text>
              <TouchableOpacity
                style={styles.studentDisplayBtn}
                onPress={() => setStudentSheet(selectedStudent ? 'profile' : 'picker')}
              >
                {selectedStudent ? (
                  <>
                    <Image source={{ uri: selectedStudent.avatar }} style={styles.studentDisplayAvatar} />
                    <View style={styles.studentDisplayInfo}>
                      <Text style={styles.studentDisplayName}>{selectedStudent.name}</Text>
                      <Text style={styles.studentDisplayTagline}>{selectedStudent.tagline}</Text>
                    </View>
                  </>
                ) : (
                  <>
                    <View style={styles.studentDisplayEmpty}>
                      <Text style={styles.studentDisplayEmptyIcon}>🐾</Text>
                    </View>
                    <View style={styles.studentDisplayInfo}>
                      <Text style={styles.studentDisplayPlaceholder}>生徒を選ぼう</Text>
                      <Text style={styles.studentDisplayPlaceholderSub}>タップして授業してくれる生徒を選ぶ</Text>
                    </View>
                  </>
                )}
                <Text style={styles.studentDisplayChevron}>›</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtnChat, !selectedStudentId && styles.actionBtnChatDisabled]}
                onPress={() => selectedStudentId ? router.push('/chat') : showToast()}
              >
                <Text style={[styles.actionBtnChatText, !selectedStudentId && styles.actionBtnChatTextDisabled]}>
                  🎓　授業をする
                </Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* 履歴ゾーン */}
        <View style={[styles.historyZone, { marginTop: 8 }]}>
          <View style={styles.historyHeader}>
            <Text style={styles.historyLabel}>最近の教材</Text>
            <TouchableOpacity onPress={() => router.push('/library')}>
              <Text style={styles.historyAll}>すべて見る →</Text>
            </TouchableOpacity>
          </View>

          {history.length === 0 ? (
            <Text style={styles.historyEmpty}>教材をアップロードすると履歴が表示されます</Text>
          ) : (
            <View style={{ gap: 10 }}>
              {history.slice(0, 3).map((item) => {
                const isActive = activeHistoryId === item.id
                const itemTitle = item.title
                  .replace(/^この(教材|文書|画像)は[、,]?\s*/u, '')
                  .slice(0, 30)
                return (
                  <View key={item.id} style={[styles.historyItem, isActive && styles.historyItemActive]}>
                    <TouchableOpacity style={styles.historyMain} onPress={() => selectHistory(item)}>
                      {item.thumbnails[0] ? (
                        <Image source={{ uri: item.thumbnails[0] }} style={styles.historyThumb} />
                      ) : (
                        <View style={[styles.historyThumb, { backgroundColor: '#e2e8f0' }]} />
                      )}
                      <View style={styles.historyInfo}>
                        <Text numberOfLines={1} style={[styles.historyTitle, isActive && { color: '#ec4899' }]}>
                          {itemTitle}
                        </Text>
                        <Text style={styles.historyDate}>
                          {item.groupName ? `📁 ${item.groupName}　` : ''}{new Date(item.savedAt).toLocaleDateString('ja-JP')}
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
                  <Image source={{ uri: selectedStudent.avatar }} style={styles.profileAvatar} />
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
        </View>
      </Modal>

      <BottomTabBar active="home" />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#e0f2fe' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingVertical: 24, gap: 14 },

  header: { marginBottom: 4 },
  // ⑤ タイトルを極太化し、サブタイトルは細くして5段階の階層を作る
  appTitle: { fontSize: 30, fontWeight: '900', color: '#0c4a6e', letterSpacing: -0.5 },
  appSubtitle: { fontSize: 12, color: '#0369a1', marginTop: 2, fontWeight: '400', letterSpacing: 0.3 },

  // 状態1
  uploadBtnLarge: {
    backgroundColor: 'white',
    borderRadius: 20,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#7dd3fc',
    paddingVertical: 32,
    alignItems: 'center',
    gap: 6,
    // ① 影で浮き感
    shadowColor: '#7dd3fc',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  uploadBtnLargeIcon: { fontSize: 32 },
  uploadBtnLargeText: { fontSize: 19, color: '#0369a1', fontWeight: '800' },
  uploadBtnLargeSub: { fontSize: 12, color: '#94a3b8', fontWeight: '400' },

  // 状態2
  pendingCard: {
    backgroundColor: 'white', borderRadius: 20, padding: 16, gap: 12,
    shadowColor: '#94a3b8', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15, shadowRadius: 8, elevation: 4,
  },
  thumbRowWrap: { flexDirection: 'row', alignItems: 'center' },
  thumbRow: { flex: 1 },
  thumb: { width: 72, height: 72, borderRadius: 12, marginRight: 8 },
  thumbCounter: { paddingLeft: 10, fontSize: 15, fontWeight: '700', color: '#94a3b8' },
  analyzeBtn: { backgroundColor: '#f472b6', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  analyzeBtnLoading: { backgroundColor: '#f9a8d4' },
  analyzeBtnText: { fontSize: 16, color: 'white', fontWeight: '800' },
  photoActions: { flexDirection: 'row', alignItems: 'center' },
  photoActionBtn: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  photoActionText: { fontSize: 13, color: '#64748b' },
  photoActionDivider: { width: 1, height: 16, backgroundColor: '#e2e8f0' },

  // 状態3
  // ③ contentCard + preview を束ねるユニット（タイトな gap:10）
  materialUnit: { gap: 10 },
  // ① contentCard は最重要カード → 最も強い影・枠線なし
  contentCard: {
    backgroundColor: 'white', borderRadius: 16, overflow: 'hidden',
    shadowColor: '#0369a1', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14, shadowRadius: 10, elevation: 5,
  },
  contentCardInner: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  contentThumb: { width: 44, height: 44, borderRadius: 8 },
  // ⑤ カードタイトルを少し大きく
  contentTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1e293b', lineHeight: 19 },
  contentClear: { padding: 4 },
  contentClearText: { fontSize: 12, color: '#94a3b8' },
  contentCardHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 7,
    borderBottomWidth: 1, borderBottomColor: '#e0f2fe',
    backgroundColor: '#f0f9ff',
  },
  // ⑤ セクションラベルは極太＋letterSpacing で引き締める
  contentCardHeaderLabel: { fontSize: 10, fontWeight: '800', color: '#0369a1', letterSpacing: 1.0 },
  contentCardHeaderAction: { fontSize: 11, color: '#94a3b8' },

  // アクション：教材を見る（背景色＋影で区別、枠線なし）
  actionBtnPreview: {
    backgroundColor: '#eff6ff',
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 6,
    elevation: 3,
  },
  actionBtnPreviewText: { fontSize: 15, fontWeight: '600', color: '#1d4ed8' },
  // ⑤ 補助テキストは細く・小さく（最も低い階層）
  actionNote: { fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 6, fontWeight: '300' },

  // ① 授業セクション → 中程度の影
  chatSection: {
    backgroundColor: 'white', borderRadius: 20, padding: 16, gap: 12,
    shadowColor: '#1e293b', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 8, elevation: 3,
  },
  chatSectionLabel: { fontSize: 11, fontWeight: '600', color: '#64748b', letterSpacing: 0.8 },

  studentDisplayBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 12, borderRadius: 16,
    backgroundColor: 'white', borderWidth: 1.5, borderColor: '#e2e8f0',
  },
  studentDisplayAvatar: { width: 48, height: 48, borderRadius: 24 },
  studentDisplayInfo: { flex: 1, minWidth: 0 },
  studentDisplayName: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  studentDisplayTagline: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  studentDisplayEmpty: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center',
  },
  studentDisplayEmptyIcon: { fontSize: 22 },
  studentDisplayPlaceholder: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  studentDisplayPlaceholderSub: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  studentDisplayChevron: { fontSize: 22, color: '#cbd5e1' },

  // 生徒シート
  studentSheetContainer: { flex: 1, justifyContent: 'flex-end' },
  studentSheetOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  studentSheetBottom: {
    backgroundColor: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 16, paddingBottom: 40, paddingTop: 8,
  },
  studentSheetHandle: {
    width: 36, height: 4, backgroundColor: '#e2e8f0',
    borderRadius: 2, alignSelf: 'center', marginBottom: 16,
  },
  profileRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9', marginBottom: 12,
  },
  profileAvatar: { width: 56, height: 56, borderRadius: 28 },
  profileName: { fontSize: 16, fontWeight: '700', color: '#1e293b' },
  profileTagline: { fontSize: 12, color: '#94a3b8', marginTop: 3 },
  sheetChangeBtn: {
    backgroundColor: '#f1f5f9', borderRadius: 14,
    paddingVertical: 14, alignItems: 'center', marginBottom: 8,
  },
  sheetChangeBtnText: { fontSize: 14, fontWeight: '700', color: '#475569' },
  sheetCloseBtn: {
    backgroundColor: '#f8fafc', borderRadius: 14,
    paddingVertical: 14, alignItems: 'center',
  },
  sheetCloseBtnText: { fontSize: 14, fontWeight: '500', color: '#94a3b8' },
  pickerLabel: {
    fontSize: 13, fontWeight: '600', color: '#64748b',
    paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9', marginBottom: 4,
  },
  pickerItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 4, paddingVertical: 12, borderRadius: 14,
  },
  pickerItemSel: { backgroundColor: '#fff0f6' },
  pickerItemAvatar: { width: 48, height: 48, borderRadius: 24 },
  pickerItemInfo: { flex: 1, minWidth: 0 },
  pickerItemName: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  pickerItemNameSel: { color: '#ec4899', fontWeight: '700' },
  pickerItemTagline: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  pickerItemCheck: { fontSize: 16, color: '#ec4899', fontWeight: '700' },

  actionBtnChat: { backgroundColor: '#f472b6', borderRadius: 14, paddingVertical: 18, alignItems: 'center' },
  actionBtnChatDisabled: { backgroundColor: '#f1f5f9' },
  // ⑤ 最重要CTA → fontWeight '800'
  actionBtnChatText: { fontSize: 18, fontWeight: '800', color: 'white' },
  actionBtnChatTextDisabled: { color: '#cbd5e1' },

  row: { flexDirection: 'row', alignItems: 'center' },

  toast: {
    position: 'absolute', bottom: 32, alignSelf: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 24,
  },
  toastText: { color: 'white', fontSize: 14, fontWeight: '600' },

  // 履歴
  historyZone: {
    marginHorizontal: -20,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 32,
    backgroundColor: '#f1f5f9',
    borderTopWidth: 1.5,
    borderTopColor: '#bfdbfe',
  },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  historyLabel: { fontSize: 11, fontWeight: '800', color: '#64748b', letterSpacing: 1.2 },
  historyAll: { fontSize: 12, color: '#0ea5e9', fontWeight: '500' },
  seeAllBtn: { paddingVertical: 10, alignItems: 'center' },
  seeAllText: { fontSize: 13, color: '#0ea5e9', fontWeight: '500' },
  historyEmpty: { fontSize: 13, color: '#94a3b8', textAlign: 'center', paddingVertical: 16 },
  // ① 履歴アイテムは最も軽い影（3段階の最下層）
  historyItem: {
    backgroundColor: 'white', borderRadius: 14, flexDirection: 'row', alignItems: 'center', overflow: 'hidden',
    shadowColor: '#94a3b8', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 4, elevation: 2,
  },
  historyItemActive: { backgroundColor: '#fff0f6', borderWidth: 1.5, borderColor: '#fbcfe8' },
  historyMain: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  historyThumb: { width: 42, height: 42, borderRadius: 8 },
  historyInfo: { flex: 1, minWidth: 0 },
  historyTitle: { fontSize: 13, fontWeight: '600', color: '#334155' },
  // ⑤ 日付は最も細く・小さく（補助情報の最下層）
  historyDate: { fontSize: 10, color: '#94a3b8', marginTop: 2, fontWeight: '300' },
  checkMark: { fontSize: 14, color: '#f472b6', fontWeight: 'bold' },
  deleteBtn: { paddingHorizontal: 14, paddingVertical: 12 },
  deleteBtnText: { fontSize: 12, color: '#cbd5e1' },
})
