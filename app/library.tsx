import {
  View, Text, FlatList, TouchableOpacity, Image, StyleSheet,
  Modal, TextInput, KeyboardAvoidingView, Platform, Pressable,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { useApp } from '@/lib/AppContext'
import { loadHistory, deleteFromHistory, renameHistoryItem, HISTORY_MAX } from '@/lib/storage'
import type { HistoryItem } from '@/lib/types'
import { BottomTabBar } from '@/components/BottomTabBar'

type SheetMode = 'main' | 'detail' | 'rename' | 'delete'

const TITLE_RE = /^この(教材|文書|画像|写真)は[、，]?\s*/u

export default function LibraryScreen() {
  const router = useRouter()
  const {
    setImageDescription, setNotes, setPreviewContent,
    setThumbnails, setCurrentHistoryId, setSelectedStudentId,
    resetChatSession, currentHistoryId,
  } = useApp()

  const [history, setHistory] = useState<HistoryItem[]>([])
  const [actionItem, setActionItem] = useState<HistoryItem | null>(null)
  const [sheetMode, setSheetMode] = useState<SheetMode>('main')
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    loadHistory().then(setHistory)
  }, [])

  const refresh = async () => setHistory(await loadHistory())

  const selectItem = (item: HistoryItem) => {
    setImageDescription(item.imageDescription)
    setNotes(item.notes)
    setThumbnails(item.thumbnails)
    setCurrentHistoryId(item.id)
    setPreviewContent(item.previewContent ?? null)
    setSelectedStudentId(null)
    resetChatSession()
    router.back()
  }

  const openSheet = (item: HistoryItem) => {
    setActionItem(item)
    setSheetMode('main')
  }

  const closeSheet = () => setActionItem(null)

  const handleDelete = async () => {
    if (!actionItem) return
    if (currentHistoryId === actionItem.id) {
      setImageDescription('')
      setNotes('')
      setThumbnails([])
      setCurrentHistoryId(null)
      setPreviewContent(null)
    }
    await deleteFromHistory(actionItem.id)
    await refresh()
    closeSheet()
  }

  const handleRename = async () => {
    if (!actionItem || !renameValue.trim()) return
    await renameHistoryItem(actionItem.id, renameValue.trim())
    await refresh()
    closeSheet()
  }

  const renderCard = ({ item, index }: { item: HistoryItem; index: number }) => {
    const isActive = currentHistoryId === item.id
    const title = item.title.replace(TITLE_RE, '')
    const isOdd = index % 2 === 1
    return (
      <View style={[styles.card, isActive && styles.cardActive, isOdd && styles.cardOdd]}>
        <TouchableOpacity onPress={() => selectItem(item)} activeOpacity={0.85}>
          {item.thumbnails[0] ? (
            <Image source={{ uri: item.thumbnails[0] }} style={styles.cardThumb} />
          ) : (
            <View style={[styles.cardThumb, styles.cardThumbEmpty]}>
              <Text style={styles.cardThumbIcon}>📷</Text>
            </View>
          )}
          <View style={[styles.cardInfo, isActive && styles.cardInfoActive]}>
            <Text style={[styles.cardTitle, isActive && styles.cardTitleActive]} numberOfLines={2}>
              {title}
            </Text>
            <Text style={styles.cardDate}>
              {new Date(item.savedAt).toLocaleDateString('ja-JP')}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.cardMenuBtn}
          onPress={() => openSheet(item)}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Text style={styles.cardMenuDot}>⋮</Text>
        </TouchableOpacity>
        {isActive && (
          <View style={styles.activeBadge}>
            <Text style={styles.activeBadgeText}>選択中</Text>
          </View>
        )}
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ヘッダー */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>📚 教材ライブラリ</Text>
        <Text style={styles.headerCount}>{history.length} / {HISTORY_MAX}件</Text>
      </View>

      {/* グリッド */}
      {history.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📷</Text>
          <Text style={styles.emptyText}>教材がまだありません</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.emptyLink}>教材を追加する →</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={history}
          keyExtractor={item => item.id}
          numColumns={2}
          contentContainerStyle={styles.grid}
          renderItem={renderCard}
        />
      )}

      {/* アクションシート */}
      <Modal
        visible={!!actionItem}
        transparent
        animationType="slide"
        onRequestClose={closeSheet}
      >
        <Pressable style={styles.overlay} onPress={closeSheet} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrap}
        >
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />

            {sheetMode === 'main' && actionItem && (
              <>
                <Text style={styles.sheetItemTitle} numberOfLines={1}>
                  {actionItem.title.replace(TITLE_RE, '')}
                </Text>
                <View style={styles.sheetRows}>
                  <TouchableOpacity style={styles.sheetRow} onPress={() => setSheetMode('detail')}>
                    <Text style={styles.sheetRowIcon}>📄</Text>
                    <Text style={styles.sheetRowText}>詳細を見る</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.sheetRow} onPress={() => {
                    setRenameValue(actionItem.title.replace(TITLE_RE, ''))
                    setSheetMode('rename')
                  }}>
                    <Text style={styles.sheetRowIcon}>✏️</Text>
                    <Text style={styles.sheetRowText}>名前を変更</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.sheetRow} onPress={() => setSheetMode('delete')}>
                    <Text style={styles.sheetRowIcon}>🗑️</Text>
                    <Text style={[styles.sheetRowText, styles.sheetRowTextRed]}>削除</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.cancelBtn} onPress={closeSheet}>
                  <Text style={styles.cancelBtnText}>キャンセル</Text>
                </TouchableOpacity>
              </>
            )}

            {sheetMode === 'detail' && actionItem && (
              <>
                <Text style={styles.sheetSubLabel}>教材の詳細</Text>
                <View style={styles.detailBody}>
                  <Text style={styles.detailTitle}>{actionItem.title.replace(TITLE_RE, '')}</Text>
                  {actionItem.imageDescription ? (
                    <Text style={styles.detailDesc}>{actionItem.imageDescription}</Text>
                  ) : null}
                  <Text style={styles.detailDate}>
                    {new Date(actionItem.savedAt).toLocaleDateString('ja-JP')}
                  </Text>
                </View>
                <TouchableOpacity style={styles.primaryBtn} onPress={() => selectItem(actionItem)}>
                  <Text style={styles.primaryBtnText}>この教材で学習する</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setSheetMode('main')}>
                  <Text style={styles.cancelBtnText}>戻る</Text>
                </TouchableOpacity>
              </>
            )}

            {sheetMode === 'rename' && actionItem && (
              <>
                <Text style={styles.sheetItemTitle}>教材名を変更</Text>
                <TextInput
                  autoFocus
                  value={renameValue}
                  onChangeText={setRenameValue}
                  onSubmitEditing={handleRename}
                  returnKeyType="done"
                  style={styles.renameInput}
                  placeholder="教材名を入力"
                />
                <TouchableOpacity
                  style={[styles.primaryBtn, !renameValue.trim() && styles.primaryBtnDisabled]}
                  onPress={handleRename}
                  disabled={!renameValue.trim()}
                >
                  <Text style={styles.primaryBtnText}>保存</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setSheetMode('main')}>
                  <Text style={styles.cancelBtnText}>キャンセル</Text>
                </TouchableOpacity>
              </>
            )}

            {sheetMode === 'delete' && actionItem && (
              <>
                <Text style={styles.sheetItemTitle}>この教材を削除しますか？</Text>
                <Text style={styles.deleteDesc}>
                  「{actionItem.title.replace(TITLE_RE, '')}」を履歴から削除します。この操作は元に戻せません。
                </Text>
                <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
                  <Text style={styles.deleteBtnText}>削除する</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setSheetMode('main')}>
                  <Text style={styles.cancelBtnText}>キャンセル</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <BottomTabBar active="library" />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f1f5f9' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: 'white',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e2e8f0',
  },
  headerTitle: { fontSize: 15, fontWeight: '700', color: '#1e293b' },
  headerCount: { fontSize: 12, color: '#94a3b8' },

  grid: { padding: 12 },

  card: {
    flex: 1, margin: 4,
    backgroundColor: 'white', borderRadius: 16, overflow: 'hidden',
    borderWidth: 2, borderColor: 'transparent',
    shadowColor: '#94a3b8', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1, shadowRadius: 4, elevation: 2,
  },
  cardOdd: { marginLeft: 4 },
  cardActive: { borderColor: '#f472b6', shadowColor: '#f472b6', shadowOpacity: 0.2 },
  cardThumb: { width: '100%', aspectRatio: 1, backgroundColor: '#e2e8f0' },
  cardThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  cardThumbIcon: { fontSize: 32, color: '#cbd5e1' },
  cardInfo: { padding: 8, backgroundColor: 'white' },
  cardInfoActive: { backgroundColor: '#fff0f6' },
  cardTitle: { fontSize: 11, fontWeight: '600', color: '#1e293b', lineHeight: 16, minHeight: 32 },
  cardTitleActive: { color: '#ec4899' },
  cardDate: { fontSize: 10, color: '#94a3b8', marginTop: 3 },
  cardMenuBtn: {
    position: 'absolute', top: 6, right: 6,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  cardMenuDot: { color: 'white', fontSize: 14, lineHeight: 20 },
  activeBadge: {
    position: 'absolute', top: 6, left: 6,
    backgroundColor: '#ec4899', borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  activeBadgeText: { color: 'white', fontSize: 9, fontWeight: '700' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyText: { fontSize: 14, color: '#94a3b8' },
  emptyLink: { fontSize: 14, color: '#ec4899', fontWeight: '600' },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheetWrap: { justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 16, paddingBottom: 40, paddingTop: 8,
  },
  sheetHandle: {
    width: 36, height: 4, backgroundColor: '#e2e8f0',
    borderRadius: 2, alignSelf: 'center', marginBottom: 12,
  },
  sheetItemTitle: {
    fontSize: 14, fontWeight: '600', color: '#1e293b',
    paddingHorizontal: 4, paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#f1f5f9',
    marginBottom: 4,
  },
  sheetSubLabel: {
    fontSize: 11, fontWeight: '700', color: '#94a3b8', letterSpacing: 0.8,
    paddingHorizontal: 4, paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#f1f5f9',
    marginBottom: 4,
  },
  sheetRows: { marginBottom: 8 },
  sheetRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 4, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#f8fafc',
  },
  sheetRowIcon: { fontSize: 18, width: 24, textAlign: 'center' },
  sheetRowText: { fontSize: 14, color: '#334155', fontWeight: '500' },
  sheetRowTextRed: { color: '#ef4444' },

  detailBody: { paddingVertical: 12, gap: 8, marginBottom: 12 },
  detailTitle: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  detailDesc: { fontSize: 13, color: '#64748b', lineHeight: 20 },
  detailDate: { fontSize: 11, color: '#94a3b8' },

  renameInput: {
    borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, color: '#1e293b',
    marginVertical: 12,
  },
  deleteDesc: {
    fontSize: 13, color: '#64748b', lineHeight: 20,
    paddingVertical: 12, marginBottom: 8,
  },

  primaryBtn: {
    backgroundColor: '#ec4899', borderRadius: 16,
    paddingVertical: 14, alignItems: 'center', marginBottom: 8,
  },
  primaryBtnDisabled: { backgroundColor: '#f9a8d4' },
  primaryBtnText: { color: 'white', fontWeight: '700', fontSize: 15 },

  deleteBtn: {
    backgroundColor: '#ef4444', borderRadius: 16,
    paddingVertical: 14, alignItems: 'center', marginBottom: 8,
  },
  deleteBtnText: { color: 'white', fontWeight: '700', fontSize: 15 },

  cancelBtn: {
    backgroundColor: '#f1f5f9', borderRadius: 16,
    paddingVertical: 14, alignItems: 'center',
  },
  cancelBtnText: { color: '#64748b', fontWeight: '600', fontSize: 14 },
})
