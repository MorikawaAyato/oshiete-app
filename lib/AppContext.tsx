import { createContext, useContext, useState, useEffect, useRef } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { PreviewContent, ChatMessage } from './types'

const STUDENT_KEY = 'oshiete_student'

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
