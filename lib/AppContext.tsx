import { createContext, useContext, useState } from 'react'
import type { PreviewContent, ChatMessage } from './types'

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
