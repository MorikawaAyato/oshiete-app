import type { Factsheet, Notebook, Recap } from './types'

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? ''

export async function analyzeText(
  text: string,
  existingGroups: { groupName: string; titles: string[] }[] = [],
): Promise<{ title: string; imageDescription: string; notes: string; suggestedGroupName?: string; error?: string }> {
  const res = await fetch(`${API_BASE}/api/analyze-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, existingGroups }),
  })
  return res.json()
}

export async function analyzeImages(
  images: { data: string; mimeType: string }[],
  existingGroups: { groupName: string; titles: string[] }[] = [],
): Promise<{ imageDescription: string; notes: string; suggestedGroupName?: string; error?: string }> {
  const res = await fetch(`${API_BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images, existingGroups }),
  })
  return res.json()
}

export async function fetchPreviewContent(
  imageDescription: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/api/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDescription }),
  })
  return res.json()
}

// 教材ファクトシートの生成（取り込み後にバックグラウンドで呼ぶ。失敗しても授業は成立する）
export async function fetchFactsheet(
  imageDescription: string,
  notes: string,
): Promise<{ factsheet?: Factsheet; error?: string }> {
  const res = await fetch(`${API_BASE}/api/factsheet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDescription, notes }),
  })
  return res.json()
}

// あとから質問メール（授業の数日後、生徒がつまずきを思い出して質問してくる）の生成
export async function fetchFollowupMail(
  studentId: string,
  materialTitle: string,
  recap: Recap,
  teacherName?: string,
): Promise<{ subject?: string; body?: string; error?: string }> {
  const res = await fetch(`${API_BASE}/api/followup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId, materialTitle, recap, teacherName }),
  })
  return res.json()
}

export async function startChat(
  studentId: string,
  imageDescription: string,
  notes: string,
  teacherName?: string,
  teacherCharacter?: string,
  recap?: Recap,
  factsheet?: Factsheet,
): Promise<{ manaResponse?: string; hints?: string[]; correctHintIndex?: number; error?: string }> {
  const res = await fetch(`${API_BASE}/api/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId, imageDescription, notes, teacherName, teacherCharacter, recap, factsheet }),
  })
  return res.json()
}

export async function sendChat(
  studentId: string,
  imageDescription: string,
  notes: string,
  messages: { role: string; text: string }[],
  teacherName?: string,
  teacherCharacter?: string,
  isFinalTurn?: boolean,
  turnsLeft?: number,
  correctness?: (boolean | null)[],
  recap?: Recap,
  factsheet?: Factsheet,
  hintCorrect?: boolean,
): Promise<{ text?: string; mailSubject?: string; mailContent?: string; hints?: string[]; correctHintIndex?: number; correct?: boolean; notebook?: Notebook; recap?: Recap; error?: string }> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId, imageDescription, notes, messages, teacherName, teacherCharacter, isFinalTurn, turnsLeft, correctness, recap, factsheet, hintCorrect }),
  })
  return res.json()
}
