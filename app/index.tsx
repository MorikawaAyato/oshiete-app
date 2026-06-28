import {
  View, Text, TouchableOpacity, ScrollView, Image,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import * as ImagePicker from 'expo-image-picker'
import { useApp } from '@/lib/AppContext'
import { STUDENTS } from '@/lib/students'
import { analyzeImages, fetchPreviewContent } from '@/lib/api'
import {
  loadHistory, saveToHistory, deleteFromHistory, updateHistoryPreview,
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
  // 選択済みの画像データ（base64付き）。分析後も追加のために保持。
  const [pendingImages, setPendingImages] = useState<ImageData[]>([])

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
      setSelectedStudentId(null)
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
      const res = await analyzeImages(images)
      if (res.error) throw new Error(res.error)

      setImageDescription(res.imageDescription)
      setNotes(res.notes)
      setThumbnails(thumbs)

      const title = res.imageDescription.split('。')[0].slice(0, 30)
      const saved = await saveToHistory({
        title,
        imageDescription: res.imageDescription,
        notes: res.notes,
        thumbnails: thumbs,
      })
      setCurrentHistoryId(saved.id)
      setActiveHistoryId(saved.id)
      setHistory(await loadHistory())
      void backgroundFetchPreview(res.imageDescription, saved.id)
    } catch {
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
    setSelectedStudentId(null)
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
    setSelectedStudentId(null)
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

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* ヘッダー */}
        <View style={styles.header}>
          <Text style={styles.appTitle}>OSHIETE!</Text>
          <Text style={styles.appSubtitle}>教えて学べるAI学習アプリ</Text>
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
            {/* 選択中教材カード */}
            <View style={styles.contentCard}>
              <View style={styles.contentCardHeader}>
                <Text style={styles.contentCardHeaderLabel}>現在の教材</Text>
                <TouchableOpacity onPress={() => openPicker('replace')}>
                  <Text style={styles.contentCardHeaderAction}>教材を変更する →</Text>
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

            {/* 授業セクション */}
            <View style={styles.chatSection}>
              <Text style={styles.chatSectionLabel}>授業する生徒を選ぶ</Text>
              <View style={styles.studentChips}>
                {STUDENTS.map((s) => {
                  const isSel = selectedStudentId === s.id
                  return (
                    <TouchableOpacity
                      key={s.id}
                      style={[
                        styles.studentChip,
                        isSel && { borderColor: s.color, backgroundColor: s.color + '15' },
                      ]}
                      onPress={() => setSelectedStudentId(isSel ? null : s.id)}
                    >
                      <Image source={{ uri: s.avatar }} style={styles.studentChipAvatar} />
                      <Text style={[styles.studentChipName, isSel && { color: s.color, fontWeight: '700' }]}>
                        {s.name}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
              <TouchableOpacity
                style={[styles.actionBtnChat, !selectedStudentId && styles.actionBtnChatDisabled]}
                onPress={() => selectedStudentId && router.push('/chat')}
                disabled={!selectedStudentId}
              >
                <Text style={[styles.actionBtnChatText, !selectedStudentId && styles.actionBtnChatTextDisabled]}>
                  🎓　授業をする
                </Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* 履歴ゾーン */}
        <View style={styles.historyZone}>
          <View style={styles.historyHeader}>
            <Text style={styles.historyLabel}>最近の教材</Text>
            <Text style={styles.historyCount}>{history.length} / 6件</Text>
          </View>

          {history.length === 0 ? (
            <Text style={styles.historyEmpty}>教材をアップロードすると履歴が表示されます</Text>
          ) : (
            <View style={{ gap: 10 }}>
              {history.map((item) => {
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
                          {new Date(item.savedAt).toLocaleDateString('ja-JP')}
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
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#e0f2fe' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingVertical: 24, gap: 14 },

  header: { marginBottom: 4 },
  appTitle: { fontSize: 24, fontWeight: 'bold', color: '#0c4a6e' },
  appSubtitle: { fontSize: 12, color: '#0369a1', marginTop: 2 },

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
  },
  uploadBtnLargeIcon: { fontSize: 32 },
  uploadBtnLargeText: { fontSize: 18, color: '#0369a1', fontWeight: '700' },
  uploadBtnLargeSub: { fontSize: 12, color: '#94a3b8' },

  // 状態2
  pendingCard: { backgroundColor: 'white', borderRadius: 20, padding: 16, gap: 12 },
  thumbRowWrap: { flexDirection: 'row', alignItems: 'center' },
  thumbRow: { flex: 1 },
  thumb: { width: 72, height: 72, borderRadius: 12, marginRight: 8 },
  thumbCounter: { paddingLeft: 10, fontSize: 15, fontWeight: '700', color: '#94a3b8' },
  analyzeBtn: { backgroundColor: '#f472b6', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  analyzeBtnLoading: { backgroundColor: '#f9a8d4' },
  analyzeBtnText: { fontSize: 16, color: 'white', fontWeight: 'bold' },
  photoActions: { flexDirection: 'row', alignItems: 'center' },
  photoActionBtn: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  photoActionText: { fontSize: 13, color: '#64748b' },
  photoActionDivider: { width: 1, height: 16, backgroundColor: '#e2e8f0' },

  // 状態3
  contentCard: { backgroundColor: 'white', borderRadius: 16, overflow: 'hidden', borderWidth: 1.5, borderColor: '#bfdbfe' },
  contentCardInner: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  contentThumb: { width: 44, height: 44, borderRadius: 8 },
  contentTitle: { flex: 1, fontSize: 13, fontWeight: '600', color: '#1e293b', lineHeight: 18 },
  contentClear: { padding: 4 },
  contentClearText: { fontSize: 12, color: '#94a3b8' },
  contentCardHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 7,
    borderBottomWidth: 1, borderBottomColor: '#e0f2fe',
    backgroundColor: '#f0f9ff',
  },
  contentCardHeaderLabel: { fontSize: 11, fontWeight: '700', color: '#0369a1', letterSpacing: 0.5 },
  contentCardHeaderAction: { fontSize: 11, color: '#94a3b8' },

  // アクション：教材を見る
  actionBtnPreview: {
    backgroundColor: 'white',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#7dd3fc',
    paddingVertical: 18,
    alignItems: 'center',
  },
  actionBtnPreviewText: { fontSize: 17, fontWeight: 'bold', color: '#0369a1' },
  actionNote: { fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 6 },

  // 授業セクション
  chatSection: { backgroundColor: 'white', borderRadius: 20, padding: 16, gap: 12 },
  chatSectionLabel: { fontSize: 12, fontWeight: '700', color: '#94a3b8', letterSpacing: 0.5 },
  studentChips: { flexDirection: 'row', gap: 10 },
  studentChip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#f8fafc', borderRadius: 12, borderWidth: 2, borderColor: '#e2e8f0',
    paddingHorizontal: 12, paddingVertical: 10,
  },
  studentChipAvatar: { width: 34, height: 34, borderRadius: 17 },
  studentChipName: { fontSize: 14, color: '#64748b' },
  actionBtnChat: { backgroundColor: '#f472b6', borderRadius: 14, paddingVertical: 18, alignItems: 'center' },
  actionBtnChatDisabled: { backgroundColor: 'white', borderWidth: 1.5, borderColor: '#e2e8f0' },
  actionBtnChatText: { fontSize: 17, fontWeight: 'bold', color: 'white' },
  actionBtnChatTextDisabled: { color: '#cbd5e1' },

  row: { flexDirection: 'row', alignItems: 'center' },

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
  historyLabel: { fontSize: 12, fontWeight: '700', color: '#64748b', letterSpacing: 1 },
  historyCount: { fontSize: 12, color: '#94a3b8' },
  historyEmpty: { fontSize: 13, color: '#94a3b8', textAlign: 'center', paddingVertical: 16 },
  historyItem: { backgroundColor: 'white', borderRadius: 14, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  historyItemActive: { backgroundColor: '#fff0f6', borderWidth: 1.5, borderColor: '#fbcfe8' },
  historyMain: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  historyThumb: { width: 42, height: 42, borderRadius: 8 },
  historyInfo: { flex: 1, minWidth: 0 },
  historyTitle: { fontSize: 13, fontWeight: '600', color: '#334155' },
  historyDate: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  checkMark: { fontSize: 14, color: '#f472b6', fontWeight: 'bold' },
  deleteBtn: { paddingHorizontal: 14, paddingVertical: 12 },
  deleteBtnText: { fontSize: 12, color: '#cbd5e1' },
})
