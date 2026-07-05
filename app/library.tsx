import {
  View, Text, FlatList, TouchableOpacity, Image, StyleSheet,
  Modal, TextInput, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, Dimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { useApp } from '@/lib/AppContext'
import {
  loadHistory, deleteFromHistory, renameHistoryItem, HISTORY_MAX,
  loadSavedGroups, saveGroupsList, moveItemToGroup,
  renameGroupInStorage, deleteGroupFromStorage, updateHistoryPreview,
} from '@/lib/storage'
import { fetchPreviewContent } from '@/lib/api'
import type { HistoryItem } from '@/lib/types'
import { BottomTabBar } from '@/components/BottomTabBar'
import { btn, c } from '@/lib/theme'

type SheetMode = 'select' | 'main' | 'detail' | 'rename' | 'group' | 'new-group' | 'delete'

const TITLE_RE = /^この(教材|文書|画像|写真)は[、，]?\s*/u
// 3カラム固定幅: (画面幅 - グリッドpadding12 - カードmargin合計18) / 3
const CARD_W = Math.floor((Dimensions.get('window').width - 30) / 3)

export default function LibraryScreen() {
  const router = useRouter()
  const {
    setImageDescription, setNotes, setPreviewContent,
    setThumbnails, setCurrentHistoryId, setSelectedStudentId,
    resetChatSession, currentHistoryId, setPendingMaterialAnimation,
  } = useApp()

  const [history, setHistory] = useState<HistoryItem[]>([])
  const [savedGroups, setSavedGroups] = useState<string[]>([])
  const [actionItem, setActionItem] = useState<HistoryItem | null>(null)
  const [sheetMode, setSheetMode] = useState<SheetMode>('main')
  const [renameValue, setRenameValue] = useState('')
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null)
  const [renameGroupValue, setRenameGroupValue] = useState('')
  const [deletingGroup, setDeletingGroup] = useState<string | null>(null)
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [createGroupValue, setCreateGroupValue] = useState('')

  useEffect(() => {
    Promise.all([loadHistory(), loadSavedGroups()]).then(([h, g]) => {
      setHistory(h)
      // 履歴内のgroupNameがsavedGroupsに含まれていない場合はマージして保存
      const inStorage: Record<string, true> = {}
      for (const name of g) inStorage[name] = true
      const missing: string[] = []
      for (const item of h) {
        if (item.groupName && !inStorage[item.groupName]) {
          inStorage[item.groupName] = true
          missing.push(item.groupName)
        }
      }
      if (missing.length > 0) {
        const merged = [...g, ...missing]
        setSavedGroups(merged)
        saveGroupsList(merged).catch(() => {})
      } else {
        setSavedGroups(g)
      }
    })
  }, [])

  const refresh = async () => {
    setHistory(await loadHistory())
  }

  const selectItem = (item: HistoryItem) => {
    setImageDescription(item.imageDescription)
    setNotes(item.notes)
    setThumbnails(item.thumbnails)
    setCurrentHistoryId(item.id)
    setPreviewContent(item.previewContent ?? null)
    setPendingMaterialAnimation(true)
    resetChatSession()
    requestAnimationFrame(() => router.back())
  }

  const openSheet = (item: HistoryItem, mode: SheetMode = 'main') => {
    setActionItem(item)
    setSheetMode(mode)
  }

  const viewItem = (item: HistoryItem) => {
    setImageDescription(item.imageDescription)
    setNotes(item.notes)
    setThumbnails(item.thumbnails)
    setCurrentHistoryId(item.id)
    setPreviewContent(item.previewContent ?? null)
    resetChatSession()
    closeSheet()
    if (!item.previewContent) {
      const attempt = async () => {
        const content = await fetchPreviewContent(item.imageDescription)
        if ((content as any).error) throw new Error(String((content as any).error))
        return content as any
      };
      (async () => {
        try {
          let pc
          try { pc = await attempt() } catch {
            await new Promise(r => setTimeout(r, 2000))
            pc = await attempt()
          }
          setPreviewContent(pc)
          await updateHistoryPreview(item.id, pc)
          await refresh()
        } catch {}
      })()
    }
    requestAnimationFrame(() => router.push('/preview'))
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

  const handleRenameItem = async () => {
    if (!actionItem || !renameValue.trim()) return
    await renameHistoryItem(actionItem.id, renameValue.trim())
    await refresh()
    closeSheet()
  }

  const handleMoveToGroup = async (itemId: string, groupName: string | undefined) => {
    await moveItemToGroup(itemId, groupName)
    await refresh()
    closeSheet()
  }

  const handleCreateGroupAndMove = async (itemId: string) => {
    const trimmed = renameValue.trim()
    if (!trimmed) return
    const newGroups = savedGroups.includes(trimmed) ? savedGroups : [...savedGroups, trimmed]
    setSavedGroups(newGroups)
    await saveGroupsList(newGroups)
    await moveItemToGroup(itemId, trimmed)
    await refresh()
    closeSheet()
  }

  const handleRenameGroup = async () => {
    if (!renamingGroup) return
    const trimmed = renameGroupValue.trim()
    if (!trimmed || trimmed === renamingGroup) { setRenamingGroup(null); return }
    const newGroups = savedGroups.map(g => g === renamingGroup ? trimmed : g)
    setSavedGroups(newGroups)
    await saveGroupsList(newGroups)
    await renameGroupInStorage(renamingGroup, trimmed)
    setHistory(await loadHistory())
    setRenamingGroup(null)
  }

  const handleDeleteGroup = async (name: string) => {
    const newGroups = savedGroups.filter(g => g !== name)
    setSavedGroups(newGroups)
    await saveGroupsList(newGroups)
    await deleteGroupFromStorage(name)
    setHistory(await loadHistory())
    setDeletingGroup(null)
  }

  const handleCreateGroupStandalone = async () => {
    const trimmed = createGroupValue.trim()
    if (!trimmed) return
    if (!savedGroups.includes(trimmed)) {
      const newGroups = [...savedGroups, trimmed]
      setSavedGroups(newGroups)
      await saveGroupsList(newGroups)
    }
    setCreatingGroup(false)
    setCreateGroupValue('')
  }

  // グループマップを計算
  const groupMap = new Map<string, HistoryItem[]>()
  const ungrouped: HistoryItem[] = []
  for (const item of history) {
    if (item.groupName) {
      if (!groupMap.has(item.groupName)) groupMap.set(item.groupName, [])
      groupMap.get(item.groupName)!.push(item)
    } else {
      ungrouped.push(item)
    }
  }
  const groups = savedGroups.map(name => ({ name, items: groupMap.get(name) ?? [] }))

  const renderCard = ({ item }: { item: HistoryItem }) => {
    const isActive = currentHistoryId === item.id
    const title = item.title.replace(TITLE_RE, '')
    return (
      <View style={[styles.card, isActive && styles.cardActive]}>
        <TouchableOpacity onPress={() => openSheet(item, 'select')} activeOpacity={0.85}>
          {item.thumbnails[0] ? (
            <Image source={{ uri: item.thumbnails[0] }} style={styles.cardThumb} />
          ) : (
            <View style={[styles.cardThumb, { backgroundColor: c.pinkBorder, overflow: 'hidden' }]}>
              <View style={{ position: 'absolute', top: -30, left: 0, right: 0, bottom: -70 }}>
                <Image source={require('../assets/text.webp')} style={{ width: '100%', height: '100%', opacity: 0.9 }} resizeMode="cover" />
              </View>
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
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {/* ヘッダー */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>📚 教材ライブラリ</Text>
        <Text style={styles.headerCount}>{history.length} / {HISTORY_MAX}件</Text>
      </View>

      {/* ボディ */}
      {history.length === 0 && savedGroups.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📷</Text>
          <Text style={styles.emptyText}>教材がまだありません</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.emptyLink}>教材を追加する →</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView style={styles.bodyScroll} contentContainerStyle={styles.bodyContent}>
          {groups.map(({ name, items }) => (
            <View key={name} style={styles.groupSection}>
              {renamingGroup === name ? (
                <View style={styles.groupEditRow}>
                  <TextInput
                    autoFocus
                    value={renameGroupValue}
                    onChangeText={setRenameGroupValue}
                    onSubmitEditing={handleRenameGroup}
                    returnKeyType="done"
                    style={styles.groupEditInput}
                  />
                  <TouchableOpacity onPress={handleRenameGroup} style={styles.groupSaveBtn}>
                    <Text style={styles.groupSaveBtnText}>保存</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setRenamingGroup(null)} style={styles.groupXBtn}>
                    <Text style={styles.groupXBtnText}>×</Text>
                  </TouchableOpacity>
                </View>
              ) : deletingGroup === name ? (
                <View style={styles.groupEditRow}>
                  <Text style={styles.groupDeleteConfirmText} numberOfLines={2}>
                    「{name}」を削除{items.length > 0 ? `（${items.length}件が未分類に）` : ''}しますか？
                  </Text>
                  <TouchableOpacity onPress={() => handleDeleteGroup(name)} style={styles.groupDeleteConfirmBtn}>
                    <Text style={styles.groupDeleteConfirmBtnText}>削除</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setDeletingGroup(null)} style={styles.groupXBtn}>
                    <Text style={styles.groupXBtnText}>×</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.groupHeader}>
                  <Text style={styles.groupTitle}>📁 {name}</Text>
                  <Text style={styles.groupCount}>{items.length}件</Text>
                  <View style={styles.flex1} />
                  <TouchableOpacity
                    onPress={() => { setRenamingGroup(name); setRenameGroupValue(name) }}
                    style={styles.groupIconBtn}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Text style={styles.groupIconBtnText}>✏️</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setDeletingGroup(name)}
                    style={styles.groupIconBtn}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Text style={styles.groupIconBtnText}>🗑️</Text>
                  </TouchableOpacity>
                </View>
              )}
              <FlatList
                data={items}
                keyExtractor={item => item.id}
                numColumns={3}
                scrollEnabled={false}
                contentContainerStyle={styles.grid}
                renderItem={renderCard}
              />
            </View>
          ))}
          {ungrouped.length > 0 && (
            <View style={styles.groupSection}>
              {groups.length > 0 && (
                <Text style={styles.ungroupedLabel}>未分類</Text>
              )}
              <FlatList
                data={ungrouped}
                keyExtractor={item => item.id}
                numColumns={3}
                scrollEnabled={false}
                contentContainerStyle={styles.grid}
                renderItem={renderCard}
              />
            </View>
          )}
        </ScrollView>
      )}

      {/* フッター：グループ作成 */}
      <View style={styles.footer}>
        {creatingGroup ? (
          <View style={styles.footerInputRow}>
            <TextInput
              autoFocus
              value={createGroupValue}
              onChangeText={setCreateGroupValue}
              onSubmitEditing={handleCreateGroupStandalone}
              returnKeyType="done"
              placeholder="グループ名を入力"
              style={styles.footerInput}
            />
            <TouchableOpacity
              onPress={handleCreateGroupStandalone}
              style={[styles.groupSaveBtn, !createGroupValue.trim() && styles.groupSaveBtnDisabled]}
              disabled={!createGroupValue.trim()}
            >
              <Text style={styles.groupSaveBtnText}>作成</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setCreatingGroup(false); setCreateGroupValue('') }}
              style={styles.groupXBtn}
            >
              <Text style={styles.groupXBtnText}>×</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity onPress={() => setCreatingGroup(true)} style={styles.footerCreateBtn}>
            <Text style={styles.footerCreateBtnText}>＋ グループを作成</Text>
          </TouchableOpacity>
        )}
      </View>
      </KeyboardAvoidingView>

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

            {sheetMode === 'select' && actionItem && (
              <>
                <Text style={styles.sheetItemTitle} numberOfLines={1}>
                  {actionItem.title.replace(TITLE_RE, '')}
                </Text>
                <View style={styles.selectBtns}>
                  <TouchableOpacity style={styles.selectBtnSecondary} onPress={() => viewItem(actionItem)}>
                    <Text style={styles.selectBtnSecondaryText}>📖 教材を見る</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.selectBtnPrimary} onPress={() => selectItem(actionItem)}>
                    <Text style={styles.selectBtnPrimaryText}>🎓　授業をする</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.cancelBtn} onPress={closeSheet}>
                  <Text style={styles.cancelBtnText}>キャンセル</Text>
                </TouchableOpacity>
              </>
            )}

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
                  <TouchableOpacity style={styles.sheetRow} onPress={() => setSheetMode('group')}>
                    <Text style={styles.sheetRowIcon}>📁</Text>
                    <Text style={styles.sheetRowText}>グループを変更</Text>
                    {actionItem.groupName && (
                      <Text style={styles.sheetRowSub} numberOfLines={1}>{actionItem.groupName}</Text>
                    )}
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
                  {actionItem.groupName ? (
                    <Text style={styles.detailGroup}>📁 {actionItem.groupName}</Text>
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
                  onSubmitEditing={handleRenameItem}
                  returnKeyType="done"
                  style={styles.renameInput}
                  placeholder="教材名を入力"
                />
                <TouchableOpacity
                  style={[styles.primaryBtn, !renameValue.trim() && styles.primaryBtnDisabled]}
                  onPress={handleRenameItem}
                  disabled={!renameValue.trim()}
                >
                  <Text style={styles.primaryBtnText}>保存</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setSheetMode('main')}>
                  <Text style={styles.cancelBtnText}>キャンセル</Text>
                </TouchableOpacity>
              </>
            )}

            {sheetMode === 'group' && actionItem && (
              <>
                <Text style={styles.sheetSubLabel}>グループを選ぶ</Text>
                <ScrollView style={styles.groupPickerScroll} bounces={false}>
                  {savedGroups.map(name => {
                    const isCurrent = name === actionItem.groupName
                    return (
                      <TouchableOpacity
                        key={name}
                        style={styles.sheetRow}
                        onPress={() => { if (!isCurrent) handleMoveToGroup(actionItem.id, name) }}
                        disabled={isCurrent}
                      >
                        <Text style={styles.sheetRowIcon}>📁</Text>
                        <Text style={[styles.sheetRowText, isCurrent && styles.sheetRowTextPink]}>
                          {name}
                        </Text>
                        {isCurrent && <Text style={styles.sheetRowCheck}>✓</Text>}
                      </TouchableOpacity>
                    )
                  })}
                  {actionItem.groupName ? (
                    <TouchableOpacity
                      style={styles.sheetRow}
                      onPress={() => handleMoveToGroup(actionItem.id, undefined)}
                    >
                      <Text style={[styles.sheetRowIcon, styles.sheetRowIconSm]}>✕</Text>
                      <Text style={[styles.sheetRowText, styles.sheetRowTextMuted]}>グループから外す</Text>
                    </TouchableOpacity>
                  ) : null}
                  {savedGroups.length === 0 && (
                    <Text style={styles.groupPickerEmpty}>グループがありません</Text>
                  )}
                </ScrollView>
                <TouchableOpacity
                  style={styles.newGroupRow}
                  onPress={() => { setRenameValue(''); setSheetMode('new-group') }}
                >
                  <Text style={styles.newGroupRowIcon}>＋</Text>
                  <Text style={styles.newGroupRowText}>新しいグループを作成</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setSheetMode('main')}>
                  <Text style={styles.cancelBtnText}>戻る</Text>
                </TouchableOpacity>
              </>
            )}

            {sheetMode === 'new-group' && actionItem && (
              <>
                <Text style={styles.sheetItemTitle}>新しいグループを作成</Text>
                <TextInput
                  autoFocus
                  value={renameValue}
                  onChangeText={setRenameValue}
                  onSubmitEditing={() => handleCreateGroupAndMove(actionItem.id)}
                  returnKeyType="done"
                  style={styles.renameInput}
                  placeholder="グループ名を入力"
                />
                <TouchableOpacity
                  style={[styles.primaryBtn, !renameValue.trim() && styles.primaryBtnDisabled]}
                  onPress={() => handleCreateGroupAndMove(actionItem.id)}
                  disabled={!renameValue.trim()}
                >
                  <Text style={styles.primaryBtnText}>作成してここに入れる</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setSheetMode('group')}>
                  <Text style={styles.cancelBtnText}>戻る</Text>
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
  safe: { flex: 1, backgroundColor: c.bgSub },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: 'white',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
  },
  headerTitle: { fontSize: 15, fontWeight: '700', color: c.textStrong },
  headerCount: { fontSize: 12, color: c.textSub },

  bodyScroll: { flex: 1 },
  bodyContent: { paddingBottom: 8 },

  groupSection: { marginBottom: 4 },
  groupHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  groupTitle: { fontSize: 13, fontWeight: '700', color: c.textMid },
  groupCount: { fontSize: 11, color: c.textSub },
  flex1: { flex: 1, minHeight: 0 },
  groupIconBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  groupIconBtnText: { fontSize: 14 },

  groupEditRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  groupEditInput: {
    flex: 1, borderWidth: 1, borderColor: c.skySoft,
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
    fontSize: 13, color: c.textStrong, backgroundColor: 'white',
  },
  groupSaveBtn: {
    backgroundColor: c.link, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  groupSaveBtnDisabled: { backgroundColor: c.skyBorder },
  groupSaveBtnText: { fontSize: 12, fontWeight: '700', color: 'white' },
  groupDeleteConfirmText: { flex: 1, fontSize: 12, color: c.textMid },
  groupDeleteConfirmBtn: {
    backgroundColor: c.danger, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  groupDeleteConfirmBtnText: { fontSize: 12, fontWeight: '700', color: 'white' },
  groupXBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: c.border, alignItems: 'center', justifyContent: 'center',
  },
  groupXBtnText: { fontSize: 14, color: c.textSub, fontWeight: '600' },

  ungroupedLabel: {
    fontSize: 11, fontWeight: '700', color: c.textSub,
    letterSpacing: 0.8, textTransform: 'uppercase',
    paddingHorizontal: 16, paddingVertical: 10,
  },

  grid: { paddingHorizontal: 6, paddingBottom: 4 },

  card: {
    width: CARD_W, margin: 3,
    backgroundColor: 'white', borderRadius: 12, overflow: 'hidden',
    borderWidth: 2, borderColor: 'transparent',
    shadowColor: c.faint, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1, shadowRadius: 3, elevation: 2,
  },
  cardActive: { borderColor: c.primary, shadowColor: c.primary, shadowOpacity: 0.2 },
  cardThumb: { width: '100%', aspectRatio: 1, backgroundColor: c.border },
  cardThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  cardThumbText: { backgroundColor: c.pinkSoft },
  cardThumbIcon: { position: 'absolute', top: 0, left: 0, bottom: 0, right: 0, opacity: 0.55 },
  cardInfo: { padding: 6, backgroundColor: 'white' },
  cardInfoActive: { backgroundColor: c.pinkTint },
  cardTitle: { fontSize: 10, fontWeight: '600', color: c.textStrong, lineHeight: 14, minHeight: 28 },
  cardTitleActive: { color: c.primary },
  cardDate: { fontSize: 9, color: c.textSub, marginTop: 2 },
  cardMenuBtn: {
    position: 'absolute', top: 4, right: 4,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  cardMenuDot: { color: 'white', fontSize: 12, lineHeight: 18 },
  activeBadge: {
    position: 'absolute', top: 4, left: 4,
    backgroundColor: c.primary, borderRadius: 8,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  activeBadgeText: { color: 'white', fontSize: 8, fontWeight: '700' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyText: { fontSize: 14, color: c.textSub },
  emptyLink: { fontSize: 14, color: c.primary, fontWeight: '600' },

  footer: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
    backgroundColor: 'white', paddingHorizontal: 12, paddingVertical: 8,
  },
  footerInputRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  footerInput: {
    flex: 1, borderWidth: 1.5, borderColor: c.pinkMuted,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
    fontSize: 13, color: c.textStrong, backgroundColor: 'white',
  },
  footerCreateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 8,
  },
  footerCreateBtnText: { fontSize: 14, color: c.textSub, fontWeight: '500' },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheetWrap: { justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 16, paddingBottom: 40, paddingTop: 8,
    maxHeight: '85%',
  },
  sheetHandle: {
    width: 36, height: 4, backgroundColor: c.border,
    borderRadius: 2, alignSelf: 'center', marginBottom: 12,
  },
  sheetItemTitle: {
    fontSize: 14, fontWeight: '600', color: c.textStrong,
    paddingHorizontal: 4, paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.bgSub,
    marginBottom: 4,
  },
  sheetSubLabel: {
    fontSize: 11, fontWeight: '700', color: c.textSub, letterSpacing: 0.8,
    paddingHorizontal: 4, paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.bgSub,
    marginBottom: 4,
  },
  sheetRows: { marginBottom: 8 },
  sheetRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 4, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.bg,
  },
  sheetRowIcon: { fontSize: 18, width: 24, textAlign: 'center' },
  sheetRowIconSm: { fontSize: 12 },
  sheetRowText: { fontSize: 14, color: c.text, fontWeight: '500', flex: 1 },
  sheetRowTextRed: { color: c.danger },
  sheetRowTextPink: { color: c.primary, fontWeight: '600' },
  sheetRowTextMuted: { color: c.faint },
  sheetRowSub: { fontSize: 12, color: c.textSub, maxWidth: 100 },
  sheetRowCheck: { fontSize: 14, color: c.primary, fontWeight: '700' },

  groupPickerScroll: { maxHeight: 220 },
  groupPickerEmpty: { fontSize: 13, color: c.textSub, paddingHorizontal: 4, paddingVertical: 12 },
  newGroupRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 4, paddingVertical: 14,
    borderWidth: 1, borderColor: c.pinkBorder, borderRadius: 14,
    marginTop: 8, marginBottom: 8,
  },
  newGroupRowIcon: { fontSize: 18, color: c.primary, width: 24, textAlign: 'center', fontWeight: '700' },
  newGroupRowText: { fontSize: 14, color: c.primary, fontWeight: '500' },

  detailBody: { paddingVertical: 12, gap: 8, marginBottom: 12 },
  detailTitle: { fontSize: 14, fontWeight: '700', color: c.textStrong },
  detailDesc: { fontSize: 13, color: c.textSub, lineHeight: 20 },
  detailGroup: { fontSize: 12, color: c.link },
  detailDate: { fontSize: 11, color: c.textSub },

  renameInput: {
    borderWidth: 1.5, borderColor: c.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, color: c.textStrong,
    marginVertical: 12,
  },
  deleteDesc: {
    fontSize: 13, color: c.textSub, lineHeight: 20,
    paddingVertical: 12, marginBottom: 8,
  },

  selectBtns: { gap: 10, marginTop: 12, marginBottom: 8 },
  selectBtnPrimary: {
    backgroundColor: c.primaryStrong, borderRadius: 16,
    paddingVertical: 18, alignItems: 'center',
    shadowColor: c.primary, shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  selectBtnPrimaryText: { color: 'white', fontWeight: '800', fontSize: 18 },
  selectBtnSecondary: {
    backgroundColor: c.skyTint, borderRadius: 14, borderWidth: 1, borderColor: c.skyBorder,
    paddingVertical: 14, alignItems: 'center',
  },
  selectBtnSecondaryText: { color: c.link, fontWeight: '700', fontSize: 14 },

  primaryBtn: { ...btn.primary, borderRadius: 16, marginBottom: 8 },
  primaryBtnDisabled: { backgroundColor: c.pinkMuted },
  primaryBtnText: { color: 'white', fontWeight: '700', fontSize: 15 },

  deleteBtn: {
    backgroundColor: c.danger, borderRadius: 16,
    paddingVertical: 14, alignItems: 'center', marginBottom: 8,
  },
  deleteBtnText: { color: 'white', fontWeight: '700', fontSize: 15 },

  cancelBtn: {
    backgroundColor: c.bgSub, borderRadius: 16,
    paddingVertical: 14, alignItems: 'center',
  },
  cancelBtnText: { color: c.textSub, fontWeight: '600', fontSize: 14 },
})
