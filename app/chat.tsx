import {
  View, Text, TouchableOpacity, ScrollView, TextInput,
  StyleSheet, Image, KeyboardAvoidingView, Platform,
  Animated, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { useApp } from '@/lib/AppContext'
import { getStudentById } from '@/lib/students'
import { startChat, sendChat } from '@/lib/api'
import type { ChatMessage } from '@/lib/types'

const MAX_TURNS = 9

function TypingDots({ color }: { color: string }) {
  const dot0 = useRef(new Animated.Value(0)).current
  const dot1 = useRef(new Animated.Value(0)).current
  const dot2 = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const bounce = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: -5, duration: 200, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 200, useNativeDriver: true }),
          Animated.delay(600 - delay),
        ])
      )
    const a0 = bounce(dot0, 0)
    const a1 = bounce(dot1, 150)
    const a2 = bounce(dot2, 300)
    a0.start(); a1.start(); a2.start()
    return () => { a0.stop(); a1.stop(); a2.stop() }
  }, [])

  return (
    <View style={{ backgroundColor: 'white', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', gap: 5, alignItems: 'center' }}>
      {[dot0, dot1, dot2].map((dot, i) => (
        <Animated.View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, opacity: 0.7, transform: [{ translateY: dot }] }} />
      ))}
    </View>
  )
}

function EnteringRoom({ student }: { student: { name: string; avatar: string; color: string } }) {
  const msgs = [
    `${student.name}のトークルームに接続中...`,
    '教材を送信しています...',
    `${student.name}が確認しています...`,
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
        <Image source={{ uri: student.avatar }} style={styles.enteringAvatar} />
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
    imageDescription, notes, selectedStudentId,
    chatMessages, setChatMessages,
    turnCount, setTurnCount,
    classEnded, setClassEnded,
    resetChatSession,
  } = useApp()
  const student = getStudentById(selectedStudentId ?? '')
  const scrollRef = useRef<ScrollView>(null)

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState(false)

  const remainingMins = classEnded ? 0 : (MAX_TURNS - turnCount) * 5
  const progressRatio = (MAX_TURNS - turnCount) / MAX_TURNS
  const timerColor = classEnded
    ? '#94a3b8'
    : progressRatio > 0.55 ? '#34d399' : progressRatio > 0.3 ? '#fbbf24' : '#f87171'

  useEffect(() => {
    if (chatMessages.length > 0) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 100)
    }
  }, [])

  useEffect(() => {
    // メッセージが既にある（教材画面から戻ってきた等）場合はstartChatしない
    if (!student || chatMessages.length > 0) return
    setStarting(true)
    startChat(student.id, imageDescription, notes)
      .then((res) => {
        if (res.manaResponse) {
          setChatMessages([{ role: 'mana', text: res.manaResponse }])
        }
      })
      .catch(() => {})
      .finally(() => setStarting(false))
  }, [])

  const send = async () => {
    if (!input.trim() || loading || !student) return
    const userMsg: ChatMessage = { role: 'user', text: input.trim() }
    const next = [...chatMessages, userMsg]
    setChatMessages(next)
    setInput('')
    setLoading(true)

    try {
      const res = await sendChat(student.id, imageDescription, notes, next)
      if (res.text) {
        const newMessages: ChatMessage[] = [...next, { role: 'mana', text: res.text }]
        setChatMessages(newMessages)
        const newTurnCount = turnCount + 1
        setTurnCount(newTurnCount)
        if (newTurnCount >= MAX_TURNS) {
          setClassEnded(true)
          setTimeout(() => {
            setChatMessages(prev => [...prev, { role: 'mana', text: student.endMessage }])
            setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)
          }, 500)
        }
      }
    } catch {
      setChatMessages([...next, { role: 'mana', text: 'すみません、うまく聞こえませんでした...もう一度お願いします🐾' }])
    } finally {
      setLoading(false)
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)
    }
  }

  const endClass = () => {
    if (classEnded) return
    setClassEnded(true)
    if (student) {
      setChatMessages((prev) => [...prev, { role: 'mana', text: student.endMessage }])
    }
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)
  }

  const handleBack = () => {
    if (chatMessages.length > 0 && !classEnded) {
      Alert.alert(
        '授業を終了しますか？',
        '途中で戻ると会話の記録が消えます。',
        [
          { text: 'キャンセル', style: 'cancel' },
          {
            text: '終了して戻る',
            style: 'destructive',
            onPress: () => {
              resetChatSession()
              router.back()
            },
          },
        ],
      )
    } else {
      if (classEnded) resetChatSession()
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

  if (starting) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: student.color + '18' }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
            <Text style={styles.backText}>← 戻る</Text>
          </TouchableOpacity>
          <View style={{ width: 60 }} />
        </View>
        <EnteringRoom student={student} />
      </SafeAreaView>
    )
  }

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
            <Text style={styles.backText}>← 戻る</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Image source={{ uri: student.avatar }} style={styles.headerAvatar} />
            <View>
              <Text style={styles.headerName}>{student.name}</Text>
              <Text style={[styles.timerText, { color: timerColor }]}>
                {classEnded ? '終了' : `残り${remainingMins}分`}
              </Text>
              {!classEnded && (
                <Text style={styles.timerSub}>送信ごとに5分</Text>
              )}
            </View>
          </View>
          {!classEnded ? (
            <TouchableOpacity onPress={endClass} style={styles.endBtn}>
              <Text style={styles.endBtnText}>授業終了</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 60 }} />
          )}
        </View>

        {/* 教材を見るボタン */}
        <TouchableOpacity style={styles.previewBar} onPress={() => router.push('/preview')}>
          <Text style={styles.previewBarText}>📖 教材を見る</Text>
        </TouchableOpacity>

        {/* チャット */}
        <ScrollView
          ref={scrollRef}
          style={styles.messages}
          contentContainerStyle={styles.messagesContent}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {chatMessages.map((msg, i) => (
            <View key={i} style={[styles.bubble, msg.role === 'user' ? styles.bubbleUser : styles.bubbleMana]}>
              {msg.role === 'mana' && (
                <Image source={{ uri: student.avatar }} style={styles.bubbleAvatar} />
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
          {loading && (
            <View style={[styles.bubble, styles.bubbleMana]}>
              <Image source={{ uri: student.avatar }} style={styles.bubbleAvatar} />
              <TypingDots color={student.color} />
            </View>
          )}
          {classEnded && (
            <View style={styles.endedActions}>
              <Text style={styles.endedLabel}>授業が終わりました</Text>
              <TouchableOpacity style={styles.finishBtn} onPress={() => router.push('/preview')}>
                <Text style={styles.finishBtnTextPreview}>📖 教材を見る</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.finishBtn} onPress={handleBack}>
                <Text style={styles.finishBtnText}>ホームに戻る</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>

        {/* 入力エリア */}
        {!classEnded && (
          <View style={styles.inputArea}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="先生として説明してみよう..."
              placeholderTextColor="#94a3b8"
              multiline
              maxLength={500}
            />
            <TouchableOpacity
              style={[styles.sendBtn, { backgroundColor: student.color }, (!input.trim() || loading) && styles.sendBtnDisabled]}
              onPress={send}
              disabled={!input.trim() || loading}
            >
              <Text style={styles.sendBtnText}>送信</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  errorText: { fontSize: 15, color: '#64748b' },
  backLink: { fontSize: 14, color: '#0369a1', fontWeight: '600' },

  entering: {
    flex: 1, justifyContent: 'center', alignItems: 'center', gap: 28, paddingHorizontal: 32,
  },
  enteringAvatarWrap: { position: 'relative' },
  enteringAvatar: { width: 96, height: 96, borderRadius: 48 },
  enteringOnline: {
    position: 'absolute', bottom: 4, right: 4,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: '#4ade80', borderWidth: 2, borderColor: 'white',
  },
  enteringMsg: { fontSize: 16, fontWeight: '600', color: '#334155', textAlign: 'center' },
  dotsRow: { flexDirection: 'row', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#e2e8f0',
  },
  backBtn: { paddingVertical: 4 },
  backText: { fontSize: 13, color: '#0369a1' },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerAvatar: { width: 32, height: 32, borderRadius: 16 },
  headerName: { fontSize: 14, fontWeight: 'bold', color: '#1e293b' },
  timerText: { fontSize: 11, fontWeight: '700', marginTop: 1 },
  timerSub: { fontSize: 9, color: '#94a3b8', marginTop: 1 },
  endBtn: { backgroundColor: '#f1f5f9', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  endBtnText: { fontSize: 12, color: '#64748b', fontWeight: '600' },

  previewBar: {
    backgroundColor: '#fdf4ff', borderBottomWidth: 1, borderBottomColor: '#e9d5ff',
    paddingVertical: 9, alignItems: 'center',
  },
  previewBarText: { fontSize: 13, fontWeight: '700', color: '#7c3aed' },

  messages: { flex: 1, backgroundColor: 'transparent' },
  messagesContent: { paddingHorizontal: 16, paddingVertical: 16, gap: 12 },

  bubble: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubbleUser: { justifyContent: 'flex-end' },
  bubbleMana: { justifyContent: 'flex-start' },
  bubbleAvatar: { width: 32, height: 32, borderRadius: 16, marginBottom: 2 },
  bubbleText: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleTextUser: { backgroundColor: '#f472b6' },
  bubbleTextMana: { backgroundColor: 'white' },
  msgText: { fontSize: 14, color: '#1e293b', lineHeight: 21 },
  msgTextUser: { color: 'white' },

  typingDots: { backgroundColor: 'white', borderRadius: 16, padding: 12 },

  endedActions: { marginTop: 16, gap: 10 },
  endedLabel: { fontSize: 13, color: '#64748b', textAlign: 'center', fontWeight: '600' },
  finishBtn: {
    backgroundColor: 'white', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
    borderWidth: 1.5, borderColor: '#cbd5e1',
  },
  finishBtnText: { fontSize: 14, fontWeight: '700', color: '#475569' },
  finishBtnTextPreview: { fontSize: 14, fontWeight: '700', color: '#1d4ed8' },

  inputArea: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: 'white', borderTopWidth: 1, borderTopColor: '#e2e8f0',
  },
  input: {
    flex: 1, backgroundColor: '#f8fafc', borderRadius: 12,
    borderWidth: 1, borderColor: '#e2e8f0',
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, color: '#1e293b', maxHeight: 100,
  },
  sendBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: 'white', fontWeight: 'bold', fontSize: 14 },
})
