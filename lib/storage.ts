import AsyncStorage from '@react-native-async-storage/async-storage'
import type { CardProgress, Factsheet, HistoryItem, PreviewContent, QACard, Recap, UnitProgress, UnitStatus } from './types'

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
}

// カード同一性のキー（研修・カード進度・プリントで共通。statementベース）
export function drillKey(card: QACard): string {
  return card.statement.replace(/[\s　]/g, '')
}

// カード進度：カードに触れた記録（初回挨拶の判定・研修「まだ」の解消に使う。
// 復習の単位はカードではなく授業単元＝UNIT_PROGRESS_KEY側）
const CARD_PROGRESS_KEY = 'oshiete_card_progress'

export async function loadCardProgress(): Promise<Record<string, CardProgress>> {
  try {
    const raw = await AsyncStorage.getItem(CARD_PROGRESS_KEY)
    return raw ? (JSON.parse(raw) as Record<string, CardProgress>) : {}
  } catch {
    return {}
  }
}

export async function saveCardProgress(map: Record<string, CardProgress>): Promise<void> {
  try {
    const entries = Object.entries(map)
    const kept = entries.length > 800 ? entries.sort((a, b) => b[1].lastAt - a[1].lastAt).slice(0, 800) : entries
    await AsyncStorage.setItem(CARD_PROGRESS_KEY, JSON.stringify(Object.fromEntries(kept)))
  } catch {}
}

// ─── 授業単元 ───
// 教材のカードを順番どおり最大UNIT_SIZE問ずつに均等分割する（例：21枚→5,4,4,4,4）。
// 分割はカード順で固定し、「授業①」の中身がいつ開いても同じになるようにする
export const UNIT_SIZE = 5

export function splitUnits(count: number): { start: number; size: number }[] {
  if (count <= 0) return []
  const unitCount = Math.ceil(count / UNIT_SIZE)
  const base = Math.floor(count / unitCount)
  const extra = count % unitCount
  const units: { start: number; size: number }[] = []
  let start = 0
  for (let i = 0; i < unitCount; i++) {
    const size = base + (i < extra ? 1 : 0)
    units.push({ start, size })
    start += size
  }
  return units
}

// 単元の表示名（授業①②…）。㉑以降は数字にフォールバック
export function unitLabel(i: number): string {
  return i < 20 ? String.fromCharCode(0x2460 + i) : String(i + 1)
}

// 次にやる単元の既定値：カード順で最初の「完了でない」単元（全部完了なら先頭）
export function defaultUnitIndex(cardCount: number, statuses: Record<number, UnitStatus>): number {
  const unitCount = splitUnits(cardCount).length
  for (let i = 0; i < unitCount; i++) if (statuses[i] !== 'done') return i
  return 0
}

// 単元ステータスの保存。カード枚数が変わった教材（バンク再生成など）は区切りがズレるためリセットする
const UNIT_PROGRESS_KEY = 'oshiete_unit_progress'

export async function loadUnitProgressMap(): Promise<Record<string, UnitProgress>> {
  try {
    const raw = await AsyncStorage.getItem(UNIT_PROGRESS_KEY)
    return raw ? (JSON.parse(raw) as Record<string, UnitProgress>) : {}
  } catch {
    return {}
  }
}

export async function getUnitStatuses(historyId: string | null, cardCount: number): Promise<Record<number, UnitStatus>> {
  if (!historyId) return {}
  const entry = (await loadUnitProgressMap())[historyId]
  return entry && entry.count === cardCount ? entry.status : {}
}

export async function setUnitStatus(historyId: string, cardCount: number, unitIndex: number, status: UnitStatus): Promise<void> {
  try {
    const map = await loadUnitProgressMap()
    const prev = map[historyId]
    const statusMap = prev && prev.count === cardCount ? prev.status : {}
    map[historyId] = { count: cardCount, status: { ...statusMap, [unitIndex]: status } }
    await AsyncStorage.setItem(UNIT_PROGRESS_KEY, JSON.stringify(map))
  } catch {}
}

// ─── 業務日誌 ───
// その日にどの仕事をしたかの記録（授業・研修・昇進試験）。
// 出来事の記録のみ（連続日数などの数字の指標は出さない。先生証の中で見られる）
export type WorkKind = 'lesson' | 'drill' | 'exam'
export type WorkLog = Record<string, Partial<Record<WorkKind, number>>>
const WORK_LOG_KEY = 'oshiete_work_log'

export function workDateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export async function loadWorkLog(): Promise<WorkLog> {
  try {
    const raw = await AsyncStorage.getItem(WORK_LOG_KEY)
    return raw ? (JSON.parse(raw) as WorkLog) : {}
  } catch {
    return {}
  }
}

export async function logWork(kind: WorkKind): Promise<void> {
  try {
    const log = await loadWorkLog()
    const now = new Date()
    const key = workDateKey(now.getFullYear(), now.getMonth(), now.getDate())
    log[key] = { ...(log[key] ?? {}), [kind]: (log[key]?.[kind] ?? 0) + 1 }
    // 肥大化対策：新しい日付から400日分まで
    const kept = Object.entries(log).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 400)
    await AsyncStorage.setItem(WORK_LOG_KEY, JSON.stringify(Object.fromEntries(kept)))
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
