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

// 教材ファクトシート（取り込み後にバックグラウンド生成。正誤判定の基準・虎の巻の誤答の素材）
export type Factsheet = {
  facts: string[]
  misconceptions: string[]
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
  factsheet?: Factsheet
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
