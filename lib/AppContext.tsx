import { createContext, useContext, useState, useEffect, useRef } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { PreviewContent, ChatMessage, Recap, Notebook } from './types'
import { type TeacherProfile, DEFAULT_TEACHER } from './teacherProfile'

const STUDENT_KEY = 'oshiete_student'
const TEACHER_KEY = 'oshiete_teacher'
const CHAT_SESSION_KEY = 'oshiete_chat_session'

// アプリ強制終了後も授業を再開できるように保存する内容（E4）
type ChatSession = {
  imageDescription: string
  notes: string
  currentHistoryId: string | null
  messages: ChatMessage[]
  turnCount: number
  classEnded: boolean
  hints: string[] | null
  hintUsesLeft: number
  correctness: (boolean | null)[]
  lessonRecap: Recap | null
  notebook: Notebook | null
  notebookState: 'received' | 'returned' | null
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
  // チャット状態（画面遷移をまたいで保持）
  chatMessages: ChatMessage[]
  setChatMessages: (v: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void
  turnCount: number
  setTurnCount: (v: number) => void
  classEnded: boolean
  setClassEnded: (v: boolean) => void
  hints: string[] | null
  setHints: (v: string[] | null) => void
  hintUsesLeft: number
  setHintUsesLeft: (v: number | ((prev: number) => number)) => void
  correctness: (boolean | null)[]
  setCorrectness: (v: (boolean | null)[] | ((prev: (boolean | null)[]) => (boolean | null)[])) => void
  lessonRecap: Recap | null
  setLessonRecap: (v: Recap | null) => void
  notebook: Notebook | null
  setNotebook: (v: Notebook | null) => void
  notebookState: 'received' | 'returned' | null
  setNotebookState: (v: 'received' | 'returned' | null) => void
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
      if (v) { try { setTeacherProfileRaw(JSON.parse(v)) } catch {} }
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
  const [turnCount, setTurnCount] = useState(0)
  const [classEnded, setClassEnded] = useState(false)
  const [hints, setHints] = useState<string[] | null>(null)
  const [hintUsesLeft, setHintUsesLeft] = useState(3)
  const [correctness, setCorrectness] = useState<(boolean | null)[]>([])
  const [lessonRecap, setLessonRecap] = useState<Recap | null>(null)
  const [notebook, setNotebook] = useState<Notebook | null>(null)
  const [notebookState, setNotebookState] = useState<'received' | 'returned' | null>(null)

  // 授業セッションの復元（E4: アプリ強制終了後も授業を再開できる）
  const sessionLoaded = useRef(false)
  useEffect(() => {
    AsyncStorage.getItem(CHAT_SESSION_KEY).then(raw => {
      if (raw) {
        try {
          const s = JSON.parse(raw) as ChatSession
          if (Array.isArray(s.messages) && s.messages.length > 0) {
            setImageDescription(s.imageDescription ?? '')
            setNotes(s.notes ?? '')
            setCurrentHistoryId(s.currentHistoryId ?? null)
            setChatMessages(s.messages)
            setTurnCount(s.turnCount ?? 0)
            setClassEnded(!!s.classEnded)
            setHints(s.hints ?? null)
            setHintUsesLeft(typeof s.hintUsesLeft === 'number' ? s.hintUsesLeft : 3)
            setCorrectness(Array.isArray(s.correctness) ? s.correctness : [])
            setLessonRecap(s.lessonRecap ?? null)
            setNotebook(s.notebook ?? null)
            setNotebookState(s.notebookState ?? null)
          }
        } catch {}
      }
      sessionLoaded.current = true
    }).catch(() => { sessionLoaded.current = true })
  }, [])

  useEffect(() => {
    if (!sessionLoaded.current) return
    if (chatMessages.length === 0) {
      AsyncStorage.removeItem(CHAT_SESSION_KEY).catch(() => {})
      return
    }
    const session: ChatSession = {
      imageDescription, notes, currentHistoryId,
      messages: chatMessages, turnCount, classEnded,
      hints, hintUsesLeft, correctness, lessonRecap, notebook, notebookState,
    }
    AsyncStorage.setItem(CHAT_SESSION_KEY, JSON.stringify(session)).catch(() => {})
  }, [chatMessages, turnCount, classEnded, hints, hintUsesLeft, correctness, lessonRecap, notebook, notebookState, imageDescription, notes, currentHistoryId])

  const resetChatSession = () => {
    setChatMessages([])
    setTurnCount(0)
    setClassEnded(false)
    setHints(null)
    setHintUsesLeft(3)
    setCorrectness([])
    setLessonRecap(null)
    setNotebook(null)
    setNotebookState(null)
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
        turnCount, setTurnCount,
        classEnded, setClassEnded,
        hints, setHints,
        hintUsesLeft, setHintUsesLeft,
        correctness, setCorrectness,
        lessonRecap, setLessonRecap,
        notebook, setNotebook,
        notebookState, setNotebookState,
        resetChatSession,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

export const useApp = () => useContext(AppContext)
