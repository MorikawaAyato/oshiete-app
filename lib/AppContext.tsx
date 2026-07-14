import { createContext, useContext, useState, useEffect, useRef } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { PreviewContent, ChatMessage, PrintItem, PrintStage } from './types'
import { type TeacherProfile, DEFAULT_TEACHER, normalizeAvatarId } from './teacherProfile'

const STUDENT_KEY = 'oshiete_student'
const TEACHER_KEY = 'oshiete_teacher'
const PRINT_SESSION_KEY = 'oshiete_print_session'
const LEGACY_CHAT_SESSION_KEY = 'oshiete_chat_session' // 旧フリーチャット授業（読み捨てて破棄）

// アプリ強制終了後もプリント授業を再開できるように保存する内容
type PrintSession = {
  imageDescription: string
  notes: string
  currentHistoryId: string | null
  messages: ChatMessage[]
  items: PrintItem[]
  stage: PrintStage
}

type AppState = {
  imageDescription: string
  setImageDescription: (v: string) => void
  notes: string
  setNotes: (v: string) => void
  previewContent: PreviewContent | null
  setPreviewContent: (v: PreviewContent | null) => void
  selectedStudentId: string | null
  setSelectedStudentId: (v: string | null) => void
  thumbnails: string[]
  setThumbnails: (v: string[]) => void
  currentHistoryId: string | null
  setCurrentHistoryId: (v: string | null) => void
  teacherProfile: TeacherProfile
  setTeacherProfile: (v: TeacherProfile) => void
  pendingMaterialAnimation: boolean
  setPendingMaterialAnimation: (v: boolean) => void
  // プリント授業の状態（画面遷移をまたいで保持）
  chatMessages: ChatMessage[]
  setChatMessages: (v: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void
  printItems: PrintItem[]
  setPrintItems: (v: PrintItem[] | ((prev: PrintItem[]) => PrintItem[])) => void
  printStage: PrintStage
  setPrintStage: (v: PrintStage) => void
  resetChatSession: () => void
}

const AppContext = createContext<AppState>(null!)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [imageDescription, setImageDescription] = useState('')
  const [notes, setNotes] = useState('')
  const [previewContent, setPreviewContent] = useState<PreviewContent | null>(null)

  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null)
  const studentLoaded = useRef(false)

  useEffect(() => {
    AsyncStorage.getItem(STUDENT_KEY).then(v => {
      if (v) setSelectedStudentId(v)
      studentLoaded.current = true
    }).catch(() => { studentLoaded.current = true })
  }, [])

  useEffect(() => {
    if (!studentLoaded.current) return
    if (selectedStudentId) {
      AsyncStorage.setItem(STUDENT_KEY, selectedStudentId).catch(() => {})
    } else {
      AsyncStorage.removeItem(STUDENT_KEY).catch(() => {})
    }
  }, [selectedStudentId])

  const [teacherProfile, setTeacherProfileRaw] = useState<TeacherProfile>(DEFAULT_TEACHER)
  const teacherLoaded = useRef(false)

  useEffect(() => {
    AsyncStorage.getItem(TEACHER_KEY).then(v => {
      if (v) {
        try {
          const parsed = JSON.parse(v) as TeacherProfile
          // 旧ID（taka/tora）で保存されたプロフィールを新IDへ移行
          setTeacherProfileRaw({ ...parsed, avatarId: normalizeAvatarId(parsed.avatarId) })
        } catch {}
      }
      teacherLoaded.current = true
    }).catch(() => { teacherLoaded.current = true })
  }, [])

  useEffect(() => {
    if (!teacherLoaded.current) return
    AsyncStorage.setItem(TEACHER_KEY, JSON.stringify(teacherProfile)).catch(() => {})
  }, [teacherProfile])

  const setTeacherProfile = (v: TeacherProfile) => setTeacherProfileRaw(v)

  const [thumbnails, setThumbnails] = useState<string[]>([])
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null)
  const [pendingMaterialAnimation, setPendingMaterialAnimation] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [printItems, setPrintItems] = useState<PrintItem[]>([])
  const [printStage, setPrintStage] = useState<PrintStage>('grading')

  // 授業セッションの復元（アプリ強制終了後もプリント授業を再開できる）
  const sessionLoaded = useRef(false)
  useEffect(() => {
    AsyncStorage.removeItem(LEGACY_CHAT_SESSION_KEY).catch(() => {})
    AsyncStorage.getItem(PRINT_SESSION_KEY).then(raw => {
      if (raw) {
        try {
          const s = JSON.parse(raw) as PrintSession
          if (Array.isArray(s.items) && s.items.length > 0 && Array.isArray(s.messages)) {
            setImageDescription(s.imageDescription ?? '')
            setNotes(s.notes ?? '')
            setCurrentHistoryId(s.currentHistoryId ?? null)
            setChatMessages(s.messages)
            setPrintItems(s.items)
            setPrintStage(s.stage ?? 'grading')
          }
        } catch {}
      }
      sessionLoaded.current = true
    }).catch(() => { sessionLoaded.current = true })
  }, [])

  useEffect(() => {
    if (!sessionLoaded.current) return
    if (printItems.length === 0) {
      AsyncStorage.removeItem(PRINT_SESSION_KEY).catch(() => {})
      return
    }
    const session: PrintSession = {
      imageDescription, notes, currentHistoryId,
      messages: chatMessages, items: printItems, stage: printStage,
    }
    AsyncStorage.setItem(PRINT_SESSION_KEY, JSON.stringify(session)).catch(() => {})
  }, [chatMessages, printItems, printStage, imageDescription, notes, currentHistoryId])

  const resetChatSession = () => {
    setChatMessages([])
    setPrintItems([])
    setPrintStage('grading')
  }

  return (
    <AppContext.Provider
      value={{
        imageDescription, setImageDescription,
        notes, setNotes,
        previewContent, setPreviewContent,
        selectedStudentId, setSelectedStudentId,
        teacherProfile, setTeacherProfile,
        thumbnails, setThumbnails,
        currentHistoryId, setCurrentHistoryId,
        pendingMaterialAnimation, setPendingMaterialAnimation,
        chatMessages, setChatMessages,
        printItems, setPrintItems,
        printStage, setPrintStage,
        resetChatSession,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

export const useApp = () => useContext(AppContext)
