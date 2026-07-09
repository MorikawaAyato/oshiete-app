import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Factsheet, HistoryItem, PreviewContent, Recap } from './types'

export type MailMessage = {
  id: string
  type: 'notice' | 'student'
  from: string
  studentId?: string
  subject?: string
  content: string
  timestamp: string
  read: boolean
  historyId?: string // あとから質問メールの対象教材（メールから教材をひらくCTA用）
  examInvite?: boolean // 校長先生からの昇進試験案内（メールから受験するCTA用）
  homework?: boolean // 宿題の答案が届いたメール（メールから添削するCTA用）
}

// 宿題：ノート採点で先生が❌とした（うまく説明できなかった）項目を源に、設問・模範解答・
// 生徒の答案（誤解を抱えたまま解いてくる）を生成。後日、先生が模範解答と見比べて自分で採点する。
export type HomeworkItem = { question: string; modelAnswer: string; studentAnswer: string; teacherMark?: boolean }
export type Homework = {
  historyId: string
  materialTitle: string
  studentId: string
  items: HomeworkItem[]
  assignedAt: number
  state: 'assigned' | 'arrived'
}

const HOMEWORK_KEY = 'oshiete_homework'

// 宿題は生徒ごとに最大1件（B案）。配列で保持し、旧形式（単一オブジェクト）も読めるようにする
export async function loadHomeworks(): Promise<Homework[]> {
  try {
    const raw = await AsyncStorage.getItem(HOMEWORK_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? [parsed] : [])
    // 新形式（items を持つ）のみ通す。旧形式（cards/answers）は破棄
    return (list as Homework[]).filter((h) => h && Array.isArray(h.items))
  } catch {
    return []
  }
}

export async function saveHomeworks(list: Homework[]): Promise<void> {
  try {
    if (list.length > 0) await AsyncStorage.setItem(HOMEWORK_KEY, JSON.stringify(list))
    else await AsyncStorage.removeItem(HOMEWORK_KEY)
  } catch {}
}

// 宿題は授業の締めに出すもの：ノート採点で❌にした項目（wrongLines）を持って24時間だけ出題導線が開く
export type HomeworkWindow = { historyId: string; studentId: string; endedAt: number; wrongLines: string[] }
const HOMEWORK_WINDOW_KEY = 'oshiete_homework_window'

export async function loadHomeworkWindow(): Promise<HomeworkWindow | null> {
  try {
    const raw = await AsyncStorage.getItem(HOMEWORK_WINDOW_KEY)
    return raw ? (JSON.parse(raw) as HomeworkWindow) : null
  } catch {
    return null
  }
}

export async function saveHomeworkWindow(w: HomeworkWindow | null): Promise<void> {
  try {
    if (w) await AsyncStorage.setItem(HOMEWORK_WINDOW_KEY, JSON.stringify(w))
    else await AsyncStorage.removeItem(HOMEWORK_WINDOW_KEY)
  } catch {}
}

const MAIL_KEY = 'senseigokko_mail'

const WELCOME_MAIL: MailMessage = {
  id: 'welcome',
  type: 'notice',
  from: 'せんせいごっこ',
  subject: 'ようこそ、せんせいごっこへ！',
  content: '生徒を選んで、はじめての授業を始めてみましょう ✨',
  timestamp: new Date(0).toISOString(),
  read: false,
}

export async function loadMail(): Promise<MailMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(MAIL_KEY)
    return raw ? (JSON.parse(raw) as MailMessage[]) : [WELCOME_MAIL]
  } catch {
    return [WELCOME_MAIL]
  }
}

export async function saveMail(msgs: MailMessage[]): Promise<void> {
  try { await AsyncStorage.setItem(MAIL_KEY, JSON.stringify(msgs)) } catch {}
}

export async function addMail(msg: MailMessage): Promise<MailMessage[]> {
  const current = await loadMail()
  const updated = [msg, ...current]
  await saveMail(updated)
  return updated
}

export async function markMailRead(id: string): Promise<MailMessage[]> {
  const current = await loadMail()
  const updated = current.map((m) => m.id === id ? { ...m, read: true } : m)
  await saveMail(updated)
  return updated
}

// あとから質問メール（間隔反復）の送信済みRecapキー
const FOLLOWUP_SENT_KEY = 'oshiete_followup_sent'

export async function loadFollowupSent(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(FOLLOWUP_SENT_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

export async function saveFollowupSent(keys: Set<string>): Promise<void> {
  try { await AsyncStorage.setItem(FOLLOWUP_SENT_KEY, JSON.stringify([...keys].slice(-100))) } catch {}
}

// 昇進試験の案内メールを送った称号名
const EXAM_INVITE_SENT_KEY = 'oshiete_exam_invite_sent'

export async function loadExamInviteSent(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(EXAM_INVITE_SENT_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export async function saveExamInviteSent(titles: string[]): Promise<void> {
  try { await AsyncStorage.setItem(EXAM_INVITE_SENT_KEY, JSON.stringify(titles)) } catch {}
}

// 研修（一問一答フラッシュカード）で「まだ」にしたカードのキー（次回優先で再出題する）
const DRILL_PENDING_KEY = 'oshiete_drill_pending'

export async function loadDrillPending(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(DRILL_PENDING_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

export async function saveDrillPending(keys: Set<string>): Promise<void> {
  try { await AsyncStorage.setItem(DRILL_PENDING_KEY, JSON.stringify([...keys].slice(-500))) } catch {}
}

// 保存済み先生プロフィール（キーはAppContextのTEACHER_KEYと同じ）
export async function loadTeacherProfileStored(): Promise<{ name?: string; title?: string; unlockedTitleCount?: number } | null> {
  try {
    const raw = await AsyncStorage.getItem('oshiete_teacher')
    return raw ? (JSON.parse(raw) as { name?: string; title?: string; unlockedTitleCount?: number }) : null
  } catch {
    return null
  }
}

// 先生の名前（メール生成用）
export async function loadTeacherName(): Promise<string | undefined> {
  return (await loadTeacherProfileStored())?.name || undefined
}

const KEY = 'oshiete_history'
const GROUPS_KEY = 'oshiete_groups'
export const HISTORY_MAX = 18

export async function loadHistory(): Promise<HistoryItem[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as HistoryItem[]) : []
  } catch {
    return []
  }
}

export async function saveToHistory(
  item: Omit<HistoryItem, 'id' | 'savedAt'>,
): Promise<HistoryItem> {
  const history = await loadHistory()
  const newItem: HistoryItem = {
    ...item,
    id: Date.now().toString(),
    savedAt: new Date().toISOString(),
  }
  const updated = [newItem, ...history].slice(0, HISTORY_MAX)
  await AsyncStorage.setItem(KEY, JSON.stringify(updated))
  return newItem
}

export async function deleteFromHistory(id: string): Promise<void> {
  const history = await loadHistory()
  await AsyncStorage.setItem(KEY, JSON.stringify(history.filter((h) => h.id !== id)))
}

export async function renameHistoryItem(id: string, newTitle: string): Promise<void> {
  const history = await loadHistory()
  const updated = history.map((h) => h.id === id ? { ...h, title: newTitle } : h)
  await AsyncStorage.setItem(KEY, JSON.stringify(updated))
}

export async function updateHistoryPreview(id: string, previewContent: PreviewContent): Promise<void> {
  const history = await loadHistory()
  const updated = history.map((h) => (h.id === id ? { ...h, previewContent } : h))
  await AsyncStorage.setItem(KEY, JSON.stringify(updated))
}

// 教材ファクトシート（バックグラウンド生成）を履歴に保存
export async function updateHistoryFactsheet(id: string, factsheet: Factsheet): Promise<void> {
  const history = await loadHistory()
  const updated = history.map((h) => (h.id === id ? { ...h, factsheet } : h))
  await AsyncStorage.setItem(KEY, JSON.stringify(updated))
}

export async function loadFactsheet(historyId: string | null): Promise<Factsheet | undefined> {
  if (!historyId) return undefined
  const history = await loadHistory()
  return history.find((h) => h.id === historyId)?.factsheet
}

// 授業終了時に生成されたRecap（生徒メモリ）を教材×生徒単位で保存（最新1件を上書き）
export async function saveRecapToHistory(historyId: string, studentId: string, recap: Recap): Promise<void> {
  const history = await loadHistory()
  const updated = history.map((h) =>
    h.id === historyId ? { ...h, recaps: { ...(h.recaps ?? {}), [studentId]: recap } } : h
  )
  await AsyncStorage.setItem(KEY, JSON.stringify(updated))
}

export async function loadRecap(historyId: string | null, studentId: string): Promise<Recap | null> {
  if (!historyId) return null
  const history = await loadHistory()
  return history.find((h) => h.id === historyId)?.recaps?.[studentId] ?? null
}

export async function loadSavedGroups(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(GROUPS_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export async function saveGroupsList(groups: string[]): Promise<void> {
  await AsyncStorage.setItem(GROUPS_KEY, JSON.stringify(groups))
}

export async function moveItemToGroup(id: string, groupName: string | undefined): Promise<void> {
  const history = await loadHistory()
  const updated = history.map((h) => h.id === id ? { ...h, groupName } : h)
  await AsyncStorage.setItem(KEY, JSON.stringify(updated))
}

export async function renameGroupInStorage(oldName: string, newName: string): Promise<void> {
  const history = await loadHistory()
  const updated = history.map((h) => h.groupName === oldName ? { ...h, groupName: newName } : h)
  await AsyncStorage.setItem(KEY, JSON.stringify(updated))
}

export async function deleteGroupFromStorage(groupName: string): Promise<void> {
  const history = await loadHistory()
  const updated = history.map((h) => h.groupName === groupName ? { ...h, groupName: undefined } : h)
  await AsyncStorage.setItem(KEY, JSON.stringify(updated))
}
