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

// 一問一答カード（教材を原子的な事実単位に分解したもの。判定・出題の統一基準）
export type QACard = {
  q: string // 一問
  a: string // 一答
  statement: string // 平叙文1文（facts互換）
  source: string // 教材内の根拠記述の引用
}

// 教材ファクトシート（取り込み後にバックグラウンド生成。正誤判定の基準・虎の巻の誤答の素材）
export type Factsheet = {
  facts: string[]
  misconceptions: string[]
  cards?: QACard[] // 一問一答バンク（生成失敗時は欠落し従来動作）
  version?: number // バンク生成ルールの版。旧版はバックフィルで再生成される
}

export type NotebookLine = {
  text: string
  status: 'correct' | 'wrong' | 'blank'
  correction?: string
  reference?: string // 採点時に見比べる「教材からの模範解答」（1行1文）
  teacherMark?: boolean // 先生（ユーザー）がつけた○(true)/✕(false)
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
