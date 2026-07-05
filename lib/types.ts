export type ChatMessage = {
  role: 'user' | 'mana'
  text: string
}

// 生徒メモリ（教材×生徒ごとに前回授業の記憶を保持、最新1件）
export type Recap = {
  savedAt: number
  coveredTopics: { topic: string; understanding: 'high' | 'mid' | 'low' }[]
  struggledPoints: string[]
  uncoveredTopics: string[]
}

export type NotebookLine = {
  text: string
  status: 'correct' | 'wrong' | 'blank'
  correction?: string
}

export type Notebook = {
  title: string
  lines: NotebookLine[]
}

export type HistoryItem = {
  id: string
  title: string
  savedAt: string
  imageDescription: string
  notes: string
  thumbnails: string[]
  previewContent?: PreviewContent | null
  groupName?: string
  recaps?: Record<string, Recap>
}

export type Visual =
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'steps'; items: string[] }
  | { type: 'comparison'; items: { label: string; value: string }[] }
  | { type: 'none' }

export type Section = {
  title: string
  summary: string
  details: string[]
  keywords: string[]
  visual: Visual
}

export type PreviewContent = {
  theme: string
  flow: string[]
  sections: Section[]
}
