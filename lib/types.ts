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
  sectionTitle?: string // 教材ビューでの所属セクション（v3以降）
}

// 教材ビューのセクション見出し（バンク描画の骨格。v3以降）
export type FactsheetSection = {
  title: string
  memo: string // おぼえ方メモ（読み物専用。無ければ空文字）
}

// 教材ファクトシート（取り込み後にバックグラウンド生成。正誤判定の基準・虎の巻の誤答の素材）
// 正誤表エントリ：先生がカードの答えを直したときの記録（教材本文は書き換えず注記で伝播）
export type Erratum = {
  source: string
  oldAnswer: string
  newAnswer: string
  correctedAt: number
}

export type Factsheet = {
  facts: string[]
  misconceptions: string[]
  cards?: QACard[] // 一問一答バンク（生成失敗時は欠落し従来動作）
  sections?: FactsheetSection[] // 教材ビューのセクション見出し（v3以降。バンク描画の骨格）
  version?: number // バンク生成ルールの版。旧版はバックフィルで再生成される
  errata?: Erratum[] // 先生による訂正。あれば自動再生成しない
}

// プリント授業の1問。truth（答案の正誤）は生成時にサーバが決め打ちしており、
// 丸付けとのズレ照合はこの値との突き合わせだけで完結する（採点AI不要）
export type PrintItem = {
  cardIndex: number // バンク上の位置
  cardKey: string // drillKey。進度ストア・研修と同じ同一性
  question: string
  modelAnswer: string
  studentAnswer: string
  truth: 'correct' | 'wrong'
  choices?: string[] // 虎の巻（赤ペンのひとこと解説の候補。1つが正しい）
  isReview?: boolean // 復習枠（前回✕・研修「まだ」）からの出題
  teacherMark?: boolean // 第1段：先生の丸付け（模範解答なし）
  redPen?: string // 第2段：✕の問題への先生のひとこと解説
  redPenVerdict?: 'match' | 'diverge' // 返却時の一括判定（判定対象＝正誤一致の✕のみ）
  finalMark?: boolean // 第3段：答え合わせ後の最終○✕
  redPenFinal?: 'relearn' | 'ok' // 説明ズレへの先生の1タップ判定
}

export type PrintStage = 'grading' | 'redpen' | 'check' | 'done'

// カード進度：プリント授業の背骨。drillKeyをキーに「触れたか・直近の結果・復習待ちか」を記録
export type CardProgress = { seen: number; lastAt: number; lastResult?: boolean; pending?: boolean }

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
