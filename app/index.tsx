import {
  View, Text, TouchableOpacity, ScrollView, Image,
  StyleSheet, ActivityIndicator, Alert, Animated, Modal, Pressable, TextInput,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import { BottomTabBar } from '@/components/BottomTabBar'
import { useEffect, useRef, useState, useCallback } from 'react'
import * as ImagePicker from 'expo-image-picker'
import { useApp } from '@/lib/AppContext'
import { STUDENTS } from '@/lib/students'
import { TEACHER_AVATARS, TEACHER_TITLES, TEACHER_AVATAR_IMAGES, getTeacherAvatarImage } from '@/lib/teacherProfile'
import { analyzeImages, fetchPreviewContent } from '@/lib/api'
import {
  loadHistory, saveToHistory, deleteFromHistory, updateHistoryPreview, HISTORY_MAX,
  loadSavedGroups, saveGroupsList, loadMail, saveMail, markMailRead,
} from '@/lib/storage'
import type { MailMessage } from '@/lib/storage'
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
    teacherProfile, setTeacherProfile,
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

  const materialScale = useRef(new Animated.Value(1)).current
  const prevHistoryId = useRef<string | null>(null)

  useFocusEffect(
    useCallback(() => {
      loadMail().then(setMailMessages)
      if (currentHistoryId && currentHistoryId !== prevHistoryId.current) {
        prevHistoryId.current = currentHistoryId
        materialScale.setValue(0.92)
        Animated.spring(materialScale, {
          toValue: 1,
          useNativeDriver: true,
          bounciness: 10,
          speed: 13,
        }).start()
      }
    }, [currentHistoryId])
  )

  useEffect(() => {
    loadHistory().then(setHistory)
    loadMail().then(setMailMessages)
  }, [])

  useEffect(() => {
    if (!teacherSheet) {
      flipScaleAnim.setValue(1)
      setCardFlipped(false)
    }
  }, [teacherSheet])

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
      materialScale.setValue(0.92)
      Animated.spring(materialScale, { toValue: 1, useNativeDriver: true, bounciness: 10, speed: 13 }).start()
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
    if (activeHistoryId === item.id) return
    setPendingImages([])
    resetChatSession()
    setActiveHistoryId(item.id)
    setCurrentHistoryId(item.id)
    materialScale.setValue(0.92)
    Animated.spring(materialScale, { toValue: 1, useNativeDriver: true, bounciness: 10, speed: 13 }).start()
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
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#10b981' }} />
                  <Text style={{ fontSize: 10, fontWeight: '700', color: '#059669' }}>オンライン</Text>
                </View>
              </View>
            </View>
          </View>
          <View style={styles.headerIcons}>
            <TouchableOpacity style={styles.mailIconBtn} onPress={() => setShowInbox(true)}>
              <View style={styles.mailIconCircle}>
                <Text style={styles.mailIconEmoji}>✉️</Text>
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

        {/* 今日の授業 */}
        <View style={styles.todaySection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>次の授業</Text>
            {hasContent && (
              <TouchableOpacity onPress={clearSelection}>
                <Text style={styles.sectionClear}>✕ 選択を解除</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* 状態1: 何もない */}
          {!hasPending && !hasContent && (
            <TouchableOpacity style={styles.uploadCard} onPress={() => openPicker('replace')}>
              <Text style={styles.uploadCardIcon}>📷</Text>
              <Text style={styles.uploadCardText}>教材の写真を選ぶ</Text>
              <Text style={styles.uploadCardSub}>PNG / JPG・最大{MAX_IMAGES}枚</Text>
            </TouchableOpacity>
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
                  <Text style={styles.analyzeBtnText}>🔍　この写真で教材を作る</Text>
                )}
              </TouchableOpacity>
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
              {/* 教材＋生徒 分割カード */}
              <View style={styles.lessonCard}>
                {/* 左：教材 */}
                <View style={styles.lessonMaterial}>
                  {thumbnails[0] ? (
                    <Image source={{ uri: thumbnails[0] }} style={styles.lessonThumb} />
                  ) : (
                    <View style={[styles.lessonThumb, { backgroundColor: '#e2e8f0' }]} />
                  )}
                  <Text style={styles.lessonMaterialTitle} numberOfLines={3}>{shortTitle}</Text>
                  <TouchableOpacity style={styles.lessonChangeBtn} onPress={() => openPicker('replace')}>
                    <Text style={styles.lessonChangeBtnText}>📷 写真を変える</Text>
                  </TouchableOpacity>
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
                      <Image source={{ uri: selectedStudent.avatar }} style={styles.lessonStudentAvatar} />
                      <View style={{ gap: 1 }}>
                        <Text style={styles.lessonStudentName}>{selectedStudent.name}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#10b981' }} />
                          <Text style={{ fontSize: 10, fontWeight: '700', color: '#059669' }}>オンライン</Text>
                        </View>
                      </View>
                      <Text style={styles.lessonStudentAppeal} numberOfLines={4}>
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

              {/* 教材を確認するボタン */}
              <TouchableOpacity
                style={styles.lessonPreviewBtn}
                onPress={handlePreview}
                disabled={previewLoading}
              >
                {previewLoading ? (
                  <ActivityIndicator color="#0369a1" size="small" />
                ) : (
                  <Text style={styles.lessonPreviewBtnText}>📖 教材を確認する</Text>
                )}
              </TouchableOpacity>

              {/* 授業をするボタン */}
              <TouchableOpacity
                style={[styles.startBtn, !selectedStudentId && styles.startBtnDisabled]}
                onPress={() => selectedStudentId ? router.push('/chat') : showToast()}
              >
                <Text style={[styles.startBtnText, !selectedStudentId && styles.startBtnTextDisabled]}>
                  {selectedStudentId ? '🎓　授業をする' : '生徒を選んでからスタート →'}
                </Text>
              </TouchableOpacity>
            </Animated.View>
          )}
        </View>

        {/* 最近の授業 */}
        <View style={styles.recentSection}>
          <View style={[styles.sectionHeader, { marginBottom: 12 }]}>
            <Text style={styles.sectionTitle}>最近の授業</Text>
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
                        <View style={[styles.recentThumb, { backgroundColor: '#e2e8f0' }]} />
                      )}
                      <View style={styles.recentInfo}>
                        <Text numberOfLines={1} style={[styles.recentTitle, isActive && { color: '#ec4899' }]}>
                          {itemTitle}
                        </Text>
                        <Text style={styles.recentDate}>
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
        </View>
      </Modal>

      {/* アバター拡大表示 */}
      <Modal visible={showTeacherAvatar} transparent animationType="fade" onRequestClose={() => setShowTeacherAvatar(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }} onPress={() => setShowTeacherAvatar(false)}>
          <View style={{ width: 208, height: 208, borderRadius: 104, overflow: 'hidden', borderWidth: 4, borderColor: 'white' }}>
            <Image source={getTeacherAvatarImage(teacherProfile.avatarId)} style={{ width: '100%', height: '100%' }} />
          </View>
        </Pressable>
      </Modal>

      {/* 生徒アバター拡大表示 */}
      <Modal visible={showStudentAvatar} transparent animationType="fade" onRequestClose={() => setShowStudentAvatar(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }} onPress={() => setShowStudentAvatar(false)}>
          <View style={{ width: 208, height: 208, borderRadius: 104, overflow: 'hidden', borderWidth: 4, borderColor: 'white' }}>
            {selectedStudent && <Image source={{ uri: selectedStudent.avatar }} style={{ width: '100%', height: '100%' }} />}
          </View>
        </Pressable>
      </Modal>

      {/* 受信トレイ */}
      <Modal visible={showInbox} transparent animationType="slide" onRequestClose={() => setShowInbox(false)}>
        <View style={styles.studentSheetContainer}>
          <Pressable style={styles.studentSheetOverlay} onPress={() => setShowInbox(false)} />
          <View style={[styles.studentSheetBottom, { maxHeight: '75%', paddingHorizontal: 0, paddingBottom: 32 }]}>
            <View style={styles.inboxHeader}>
              <Text style={styles.inboxTitle}>✉️ メールボックス</Text>
              <TouchableOpacity onPress={() => setShowInbox(false)}>
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
                      ) : (
                        <Text style={{ fontSize: 18 }}>📢</Text>
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
                    <Text style={styles.tcStar}>✦</Text>
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
                        placeholderTextColor="#cbd5e1"
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
                    <View>
                      <Text style={styles.teacherSectionLabel}>称号</Text>
                      <View style={styles.titleRow}>
                        {TEACHER_TITLES.map((title) => (
                          <TouchableOpacity
                            key={title}
                            style={[styles.titleChip, teacherProfile.title === title && styles.titleChipSel]}
                            onPress={() => setTeacherProfile({ ...teacherProfile, title })}
                          >
                            <Text style={[styles.titleChipText, teacherProfile.title === title && styles.titleChipTextSel]}>{title}</Text>
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
  safe: { flex: 1, backgroundColor: '#e0f2fe' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingVertical: 24, gap: 16 },

  // ヘッダー
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  appTitle: { fontSize: 18, fontWeight: '900', color: '#0c4a6e', letterSpacing: -0.3 },
  appSubtitle: { fontSize: 10, color: '#7dd3fc', fontWeight: '700', letterSpacing: 0.3 },
  headerIcons: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  mailIconBtn: { alignItems: 'center', gap: 2, position: 'relative' },
  mailIconCircle: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#f0f9ff', borderWidth: 1, borderColor: '#bae6fd',
    alignItems: 'center', justifyContent: 'center',
  },
  mailIconEmoji: { fontSize: 20 },
  mailBadge: {
    position: 'absolute', top: -4, right: -4,
    backgroundColor: '#ef4444', borderRadius: 8,
    minWidth: 16, height: 16,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
  },
  mailBadgeText: { color: 'white', fontSize: 9, fontWeight: '900' },
  teacherIconBtn: { alignItems: 'center', gap: 2 },
  teacherIconCircle: {
    width: 40, height: 40, borderRadius: 20, overflow: 'hidden',
    backgroundColor: '#f0f9ff', borderWidth: 1, borderColor: '#bae6fd',
  },
  teacherIconImage: { width: 40, height: 40 },
  teacherIconLabel: { fontSize: 9, fontWeight: '700', color: '#0369a1', letterSpacing: 0.5 },

  // セクション共通
  todaySection: { gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: '#0c4a6e', letterSpacing: 0.8 },
  sectionAction: { fontSize: 12, color: '#0ea5e9', fontWeight: '500' },
  sectionClear: { fontSize: 11, color: '#94a3b8', fontWeight: '500' },

  // 状態1：アップロード
  uploadCard: {
    backgroundColor: 'white',
    borderRadius: 20,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#7dd3fc',
    paddingVertical: 36,
    alignItems: 'center',
    gap: 6,
    shadowColor: '#7dd3fc',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  uploadCardIcon: { fontSize: 32 },
  uploadCardText: { fontSize: 19, color: '#0369a1', fontWeight: '800' },
  uploadCardSub: { fontSize: 12, color: '#94a3b8', fontWeight: '400' },

  // 状態2：ペンディング
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
  photoActions: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: '#fbcfe8', borderRadius: 14, overflow: 'hidden',
  },
  photoActionBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, backgroundColor: '#fdf2f8' },
  photoActionText: { fontSize: 14, color: '#ec4899', fontWeight: '600' },
  photoActionDivider: { width: 1, height: 28, backgroundColor: '#fbcfe8' },

  // 状態3：分割カード
  lessonCard: {
    backgroundColor: 'white',
    borderRadius: 20,
    overflow: 'hidden',
    flexDirection: 'row',
    shadowColor: '#0369a1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
    elevation: 5,
  },
  lessonMaterial: { flex: 1, padding: 14, gap: 8 },
  lessonThumb: { width: '100%', aspectRatio: 1.4, borderRadius: 12 },
  lessonMaterialTitle: { fontSize: 13, fontWeight: '700', color: '#1e293b', lineHeight: 18 },
  lessonPreviewBtn: {
    backgroundColor: '#f0f9ff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#bae6fd',
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  lessonPreviewBtnText: { fontSize: 14, fontWeight: '700', color: '#0369a1' },
  lessonChangeBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: '#f8fafc', borderRadius: 20,
  },
  lessonChangeBtnText: { fontSize: 11, fontWeight: '600', color: '#64748b' },
  lessonDivider: { width: 1, backgroundColor: '#e2e8f0', marginVertical: 16 },
  lessonStudent: {
    width: 118, padding: 14,
    alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#fce5eb',
  },
  lessonStudentAvatar: { width: 64, height: 64, borderRadius: 32 },
  lessonStudentName: { fontSize: 12, fontWeight: '700', color: '#1e293b' },
  lessonStudentAppeal: { fontSize: 11, color: '#be185d', textAlign: 'center', lineHeight: 16 },
  lessonStudentEmpty: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#fce7f3', alignItems: 'center', justifyContent: 'center',
  },
  lessonStudentPickText: { fontSize: 13, fontWeight: '700', color: '#ec4899', textAlign: 'center' },
  lessonStudentPickSub: { fontSize: 10, color: '#f9a8d4' },

  // 授業スタートボタン
  startBtn: {
    backgroundColor: '#f472b6',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#ec4899',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  startBtnDisabled: { backgroundColor: '#fdf2f8', borderWidth: 1.5, borderColor: '#fbcfe8', shadowOpacity: 0, elevation: 0 },
  startBtnText: { fontSize: 18, fontWeight: '800', color: 'white' },
  startBtnTextDisabled: { color: '#f9a8d4', fontSize: 15, fontWeight: '600' },

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
    backgroundColor: '#f1f5f9',
    borderTopWidth: 1.5,
    borderTopColor: '#bfdbfe',
  },
  recentEmpty: { fontSize: 13, color: '#94a3b8', textAlign: 'center', paddingVertical: 16 },
  recentItem: {
    backgroundColor: 'white', borderRadius: 14, flexDirection: 'row', alignItems: 'center', overflow: 'hidden',
    shadowColor: '#94a3b8', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 4, elevation: 2,
  },
  recentItemActive: { backgroundColor: '#fff0f6', borderWidth: 1.5, borderColor: '#fbcfe8' },
  recentMain: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  recentThumb: { width: 52, height: 52, borderRadius: 10, flexShrink: 0 },
  recentInfo: { flex: 1, minWidth: 0 },
  recentTitle: { fontSize: 13, fontWeight: '600', color: '#334155' },
  recentDate: { fontSize: 10, color: '#94a3b8', marginTop: 2, fontWeight: '300' },
  checkMark: { fontSize: 14, color: '#f472b6', fontWeight: 'bold' },
  deleteBtn: { paddingHorizontal: 14, paddingVertical: 12 },
  deleteBtnText: { fontSize: 13, color: '#94a3b8' },
  seeAllBtn: { paddingVertical: 10, alignItems: 'center' },
  seeAllText: { fontSize: 13, color: '#0ea5e9', fontWeight: '500' },

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

  // 受信トレイ
  inboxHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  inboxTitle: { fontSize: 15, fontWeight: '900', color: '#1e293b' },
  inboxClose: { fontSize: 18, color: '#94a3b8' },
  inboxItem: {
    flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#f8fafc',
  },
  inboxAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#e0f2fe', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    flexShrink: 0, marginTop: 2,
  },
  inboxAvatarImg: { width: 40, height: 40 },
  inboxBody: { flex: 1 },
  inboxMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  inboxFrom: { fontSize: 12, fontWeight: '700', color: '#334155' },
  inboxUnreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#ef4444' },
  inboxDate: { fontSize: 10, color: '#94a3b8', marginLeft: 'auto' },
  inboxSubject: { fontSize: 12, fontWeight: '600', color: '#334155', marginTop: 1 },
  inboxContent: { fontSize: 13, color: '#475569', lineHeight: 19, marginTop: 6 },

  // 先生証シート
  tcSheetBottom: { backgroundColor: '#0f172a', paddingHorizontal: 0, paddingBottom: 0, paddingTop: 0 },
  tcCardContainer: {
    width: 240, height: 353, alignSelf: 'center', marginVertical: 24,
    overflow: 'hidden', borderRadius: 22,
  },
  tcCard: {
    flex: 1,
    borderRadius: 22, backgroundColor: '#0c4a6e',
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
  tcName: { fontSize: 22, fontWeight: '900', color: 'white', letterSpacing: 0.5 },
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
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  tcBackBtn: { flexDirection: 'row', alignItems: 'center' },
  tcBackBtnText: { fontSize: 12, fontWeight: '700', color: '#0369a1' },
  teacherSectionLabel: { fontSize: 10, fontWeight: '700', color: '#94a3b8', letterSpacing: 1, marginBottom: 8 },
  teacherNameInput: {
    paddingHorizontal: 14, paddingVertical: 11,
    borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0',
    fontSize: 14, fontWeight: '500', color: '#1e293b', backgroundColor: '#fafafa',
  },
  avatarGrid: { flexDirection: 'row', gap: 6 },
  avatarCell: {
    flex: 1, borderRadius: 12, paddingVertical: 6,
    backgroundColor: '#f8fafc', borderWidth: 2, borderColor: 'transparent',
    alignItems: 'center', gap: 4, overflow: 'hidden',
  },
  avatarCellSel: { backgroundColor: '#e0f2fe', borderColor: '#38bdf8' },
  avatarCellImage: { width: 38, height: 38, borderRadius: 19 },
  avatarCellLabel: { fontSize: 9, fontWeight: '700', color: '#64748b' },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  titleChip: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 20, backgroundColor: '#f1f5f9' },
  titleChipSel: { backgroundColor: '#0369a1' },
  titleChipText: { fontSize: 12, fontWeight: '600', color: '#475569' },
  titleChipTextSel: { color: 'white' },
  tcCloseBtn: { marginHorizontal: 16, marginTop: 0, marginBottom: 36, backgroundColor: 'rgba(255,255,255,0.08)' },
  tcCloseBtnText: { fontSize: 14, fontWeight: '500', color: 'rgba(255,255,255,0.45)', textAlign: 'center', paddingVertical: 14 },
})
