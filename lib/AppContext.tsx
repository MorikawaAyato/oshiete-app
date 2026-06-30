import { createContext, useContext, useState, useEffect, useRef } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { PreviewContent, ChatMessage } from './types'
import { type TeacherProfile, DEFAULT_TEACHER } from './teacherProfile'

const STUDENT_KEY = 'oshiete_student'
const TEACHER_KEY = 'oshiete_teacher'

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
  // チャット状態（画面遷移をまたいで保持）
  chatMessages: ChatMessage[]
  setChatMessages: (v: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void
  turnCount: number
  setTurnCount: (v: number) => void
  classEnded: boolean
  setClassEnded: (v: boolean) => void
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
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [turnCount, setTurnCount] = useState(0)
  const [classEnded, setClassEnded] = useState(false)

  const resetChatSession = () => {
    setChatMessages([])
    setTurnCount(0)
    setClassEnded(false)
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
        chatMessages, setChatMessages,
        turnCount, setTurnCount,
        classEnded, setClassEnded,
        resetChatSession,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

export const useApp = () => useContext(AppContext)
