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
// その日にどの仕事をしたかの記録（授業・研修）。件数に加え、詳細（誰に何の授業／どの教材の研修）を
// entries に残す（s=studentId, h=historyId, u=単元index）。出来事の記録のみ（数字の指標は出さない）
export type WorkKind = 'lesson' | 'drill'
export type WorkEntry = { k: WorkKind; s?: string; h?: string; u?: number }
export type WorkDay = Partial<Record<WorkKind, number>> & { entries?: WorkEntry[] }
export type WorkLog = Record<string, WorkDay>
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

export async function logWork(kind: WorkKind, detail?: { studentId?: string; historyId?: string; unitIndex?: number }): Promise<void> {
  try {
    const log = await loadWorkLog()
    const now = new Date()
    const key = workDateKey(now.getFullYear(), now.getMonth(), now.getDate())
    const day = log[key] ?? {}
    const entry: WorkEntry = { k: kind, ...(detail?.studentId ? { s: detail.studentId } : {}), ...(detail?.historyId ? { h: detail.historyId } : {}), ...(detail?.unitIndex !== undefined ? { u: detail.unitIndex } : {}) }
    log[key] = { ...day, [kind]: (day[kind] ?? 0) + 1, entries: [...(day.entries ?? []), entry].slice(-20) }
    // 肥大化対策：新しい日付から400日分まで
    const kept = Object.entries(log).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 400)
    await AsyncStorage.setItem(WORK_LOG_KEY, JSON.stringify(Object.fromEntries(kept)))
  } catch {}
}

// ─── 生徒のテスト（試験日） ───
// 教材ごとに固定の期日が自動で決まり、先生は変更できない（動かせる締切は締切にならない。
// 生徒の学校行事は先生の決定領域の外）。期日が来たら結果メールが届き、全単元完了なら大成功、
// 未完了なら追試日が自動で立つ（責めない・行き止まらない）。教材が消えたら試験日も消える
export type ExamEntry = { date: string; round: number; doneAt?: number; studentId?: string }
const EXAM_DAYS_KEY = 'oshiete_exam_days'
const EXAM_SUCCESS_KEY = 'oshiete_exam_success_count'

export async function loadExamDays(): Promise<Record<string, ExamEntry>> {
  try {
    const raw = await AsyncStorage.getItem(EXAM_DAYS_KEY)
    return raw ? (JSON.parse(raw) as Record<string, ExamEntry>) : {}
  } catch {
    return {}
  }
}

export async function saveExamDays(map: Record<string, ExamEntry>): Promise<void> {
  try { await AsyncStorage.setItem(EXAM_DAYS_KEY, JSON.stringify(map)) } catch {}
}

// 生徒のテスト大成功（期日までに全単元完了）の累計。教材を消しても実績は残る
export async function loadExamSuccessCount(): Promise<number> {
  try { return Number(await AsyncStorage.getItem(EXAM_SUCCESS_KEY)) || 0 } catch { return 0 }
}

export async function bumpExamSuccessCount(): Promise<void> {
  try { await AsyncStorage.setItem(EXAM_SUCCESS_KEY, String((await loadExamSuccessCount()) + 1)) } catch {}
}

export function todayDateKey(): string { const d = new Date(); return workDateKey(d.getFullYear(), d.getMonth(), d.getDate()) }
export function dateKeyAfterDays(days: number): string { const d = new Date(); d.setDate(d.getDate() + days); return workDateKey(d.getFullYear(), d.getMonth(), d.getDate()) }
export function examDateLabel(key: string): string { const p = key.split('-'); return `${Number(p[1])}月${Number(p[2])}日` }

// 期日の自動決定：残り単元数×2日（本番は5〜14日、追試は4〜10日に丸め）
export function makeExamEntry(unitCount: number, round: number, studentId?: string): ExamEntry {
  const days = round === 1 ? Math.min(14, Math.max(5, unitCount * 2)) : Math.min(10, Math.max(4, unitCount * 2))
  return { date: dateKeyAfterDays(days), round, ...(studentId ? { studentId } : {}) }
}

// テストの予定を立てる（まだ無ければ）。作った場合はエントリを返す（呼び出し側がお知らせメールを送る）
export async function ensureExamDay(historyId: string, unitCount: number, studentId?: string): Promise<ExamEntry | null> {
  if (unitCount <= 0) return null
  const map = await loadExamDays()
  if (map[historyId]) return null
  const entry = makeExamEntry(unitCount, 1, studentId)
  map[historyId] = entry
  await saveExamDays(map)
  return entry
}

// テストのお知らせ・結果メール（生徒のトーンに合わせた定型。AIコールなし）
export function examMailFor(student: { id: string; name: string }, item: { id: string; title: string }, kind: 'propose' | 'full' | 'partial' | 'none', dateLabel: string, round: number): MailMessage {
  const title = item.title.replace(/^この(教材|文書|画像|写真)は[、，]?\s*/u, '').slice(0, 24)
  const sowal = student.id === 'sowal'
  let subject: string
  let content: string
  if (kind === 'propose') {
    subject = 'こんどテストがあります…！'
    content = sowal
      ? `先生、あの...【${dateLabel}】に「${title}」のテストがあるんです...🐾 それまでに、授業ぜんぶおねがいします...！`
      : `先生、じつは【${dateLabel}】に「${title}」のテストがあるんです…！それまでに、授業ぜんぶおねがいします！がんばります😊`
  } else if (kind === 'full') {
    subject = 'テストの結果、聞いてください！！'
    content = sowal
      ? `今日の「${title}」のテスト...ぜんぶ書けました...！先生に教えてもらったところ、ぜんぶ出ました🐾 ほんとうにありがとうございました...！`
      : `今日の「${title}」のテスト、ぜんぶ書けました！！先生に教えてもらったところ、ぜんぶ出ました✨ ほんとうにありがとうございました！😊`
  } else if (kind === 'partial') {
    subject = 'テスト、がんばりました…！'
    content = sowal
      ? `今日、「${title}」のテストがありました...。教えてもらったところは、ばっちり書けました🐾 のこりはむずかしかったです...。でも【${dateLabel}】に追試があるんです。こんどこそ、ぜんぶ教えてほしいです...！`
      : `今日、「${title}」のテストがありました！教えてもらったところは、ばっちり書けました！のこりはむずかしかったです…。でも【${dateLabel}】に追試があるんです。こんどこそ、ぜんぶ教えてほしいです…！`
  } else {
    subject = 'テスト、むずかしかったです…'
    content = sowal
      ? `今日、「${title}」のテストがありました...。まだ教えてもらっていないところばかりで、むずかしかったです...。【${dateLabel}】に追試があるので、こんどこそおねがいします...🐾`
      : `今日、「${title}」のテストがありました…。まだ教えてもらっていないところばかりで、むずかしかったです…。【${dateLabel}】に追試があるので、こんどこそおねがいします…！`
  }
  return { id: `exam-${kind}-${item.id}-${round}-${Date.now()}`, type: 'student', from: student.name, studentId: student.id, subject, content, timestamp: new Date().toISOString(), read: false, historyId: item.id }
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
  // 教材が消えたら、その教材のテストの予定も消す（読み出し側の存在チェックとの二重防御）
  try {
    const exams = await loadExamDays()
    if (exams[id]) { delete exams[id]; await saveExamDays(exams) }
  } catch {}
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
