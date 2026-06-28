import {
  View, Text, TouchableOpacity, ScrollView, Image,
  StyleSheet, ActivityIndicator, Alert, Animated,
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

  const chipScales = useRef<Record<string, Animated.Value>>(
    Object.fromEntries(STUDENTS.map((s) => [s.id, new Animated.Value(1)]))
  ).current

  const animateChip = (id: string) => {
    const scale = chipScales[id]
    Animated.sequence([
      Animated.spring(scale, { toValue: 0.88, useNativeDriver: true, speed: 50, bounciness: 0 }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 12 }),
    ]).start()
  }

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
            {/* 教材カード + 教材を見る を1ユニット（タイトな間隔） */}
            <View style={styles.materialUnit}>
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
            </View>{/* /materialUnit */}

            {/* 授業セクション（セクションブレーク分余白を追加） */}
            <View style={[styles.chatSection, { marginTop: 8 }]}>
              <Text style={styles.chatSectionLabel}>授業する生徒を選ぶ</Text>
              <View style={styles.studentChips}>
                {STUDENTS.map((s) => {
                  const isSel = selectedStudentId === s.id
                  return (
                    <Animated.View key={s.id} style={{ flex: 1, transform: [{ scale: chipScales[s.id] }] }}>
                      <TouchableOpacity
                        style={[
                          styles.studentChip,
                          isSel && { borderColor: s.color, backgroundColor: s.color + '15' },
                        ]}
                        onPress={() => {
                          animateChip(s.id)
                          setSelectedStudentId(isSel ? null : s.id)
                        }}
                      >
                        <Image source={{ uri: s.avatar }} style={styles.studentChipAvatar} />
                        <Text style={[styles.studentChipName, isSel && { color: s.color, fontWeight: '700' }]}>
                          {s.name}
                        </Text>
                      </TouchableOpacity>
                    </Animated.View>
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
  // ① contentCard は最重要カード → 最も強い影
  contentCard: {
    backgroundColor: 'white', borderRadius: 16, overflow: 'hidden',
    borderWidth: 1.5, borderColor: '#bae6fd',
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

  // アクション：教材を見る（① 青みのある背景で白より奥行きを出す）
  actionBtnPreview: {
    backgroundColor: '#eff6ff',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#bfdbfe',
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 6,
    elevation: 3,
  },
  actionBtnPreviewText: { fontSize: 18, fontWeight: '800', color: '#1d4ed8' },
  // ⑤ 補助テキストは細く・小さく（最も低い階層）
  actionNote: { fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 6, fontWeight: '300' },

  // ① 授業セクション → 中程度の影
  chatSection: {
    backgroundColor: 'white', borderRadius: 20, padding: 16, gap: 12,
    shadowColor: '#1e293b', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 8, elevation: 3,
  },
  // ⑤ セクションラベルは小さく・細く → ボタン類と差別化
  chatSectionLabel: { fontSize: 11, fontWeight: '600', color: '#64748b', letterSpacing: 0.8 },
  studentChips: { flexDirection: 'row', gap: 10 },
  studentChip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#f8fafc', borderRadius: 12, borderWidth: 2, borderColor: '#e2e8f0',
    paddingHorizontal: 12, paddingVertical: 10,
  },
  studentChipAvatar: { width: 34, height: 34, borderRadius: 17 },
  studentChipName: { fontSize: 14, color: '#64748b', fontWeight: '500' },
  actionBtnChat: { backgroundColor: '#f472b6', borderRadius: 14, paddingVertical: 18, alignItems: 'center' },
  actionBtnChatDisabled: { backgroundColor: 'white', borderWidth: 1.5, borderColor: '#e2e8f0' },
  // ⑤ 最重要CTA → fontWeight '800'
  actionBtnChatText: { fontSize: 18, fontWeight: '800', color: 'white' },
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
  // ⑤ 履歴ラベルも極太
  historyLabel: { fontSize: 11, fontWeight: '800', color: '#64748b', letterSpacing: 1.2 },
  historyCount: { fontSize: 11, color: '#94a3b8', fontWeight: '400' },
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
