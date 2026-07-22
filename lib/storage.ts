import AsyncStorage from '@react-native-async-storage/async-storage'
import type { CardProgress, Factsheet, HistoryItem, PreviewContent, QACard, Recap, UnitProgress, UnitStatus } from './types'
import { enqueue } from './sync'

// 教材1件をサーバへ送るキュー投入（AsyncStorageはキャッシュ、サーバが正）
function enqueueMaterialPut(item: HistoryItem): void {
  enqueue({
    t: 'material',
    p: {
      id: item.id,
      title: item.title,
      imageDescription: item.imageDescription,
      notes: item.notes,
      groupName: item.groupName ?? null,
      thumbnails: item.thumbnails,
      factsheet: item.factsheet,
      previewContent: item.previewContent,
      recaps: item.recaps,
      savedAt: item.savedAt,
    },
  })
}

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
    const prev = await loadCardProgress()
    const entries = Object.entries(map)
    const kept = entries.length > 800 ? entries.sort((a, b) => b[1].lastAt - a[1].lastAt).slice(0, 800) : entries
    await AsyncStorage.setItem(CARD_PROGRESS_KEY, JSON.stringify(Object.fromEntries(kept)))
    // 変わったキーだけサーバへ（呼び出し元は全量mapを渡すため、ここで差分化する）
    const changed: Record<string, CardProgress> = {}
    for (const [k, v] of kept) {
      if (JSON.stringify(prev[k]) !== JSON.stringify(v)) changed[k] = v
    }
    if (Object.keys(changed).length > 0) enqueue({ t: 'progress', p: { cardProgress: changed } })
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
export function defaultUnitIndex(unitCount: number, statuses: Record<number, UnitStatus>): number {
  for (let i = 0; i < unitCount; i++) if (statuses[i] !== 'done') return i
  return 0
}

// この教材の単元の区切り：凍結済み（bounds）ならそれを正とし、なければ枚数からの均等分割
export function unitsFromEntry(entry: UnitProgress | undefined, cardCount: number): { start: number; size: number }[] {
  if (entry && entry.count === cardCount && entry.bounds && entry.bounds.reduce((a, b) => a + b, 0) === cardCount) {
    const units: { start: number; size: number }[] = []
    let start = 0
    for (const size of entry.bounds) { units.push({ start, size }); start += size }
    return units
  }
  return splitUnits(cardCount)
}

export async function unitsFor(historyId: string | null, cardCount: number): Promise<{ start: number; size: number }[]> {
  const entry = historyId ? (await loadUnitProgressMap())[historyId] : undefined
  return unitsFromEntry(entry, cardCount)
}

// 網羅追補でカードが増えたときの進度の引き継ぎ：**常に**既存の区切りを凍結して増分を末尾の
// 新単元にする（一度表示した授業①〜の区切りは、開始前でも後から動かさない。増えた分は
// ゴーストノードの位置に新しい単元として現れるだけ、という一貫した見え方にする）
export async function extendUnitProgressAfterRefine(historyId: string, oldCount: number, newCount: number): Promise<void> {
  if (newCount <= oldCount) return
  try {
    const map = await loadUnitProgressMap()
    const entry = map[historyId]
    const keep = entry && entry.count === oldCount
    const oldSizes = keep && entry.bounds && entry.bounds.reduce((a, b) => a + b, 0) === oldCount
      ? entry.bounds
      : splitUnits(oldCount).map((u) => u.size)
    const status = keep ? entry.status : {}
    map[historyId] = { count: newCount, status, bounds: [...oldSizes, ...splitUnits(newCount - oldCount).map((u) => u.size)] }
    await AsyncStorage.setItem(UNIT_PROGRESS_KEY, JSON.stringify(map))
    enqueue({ t: 'progress', p: { unitProgress: [{ materialId: historyId, count: newCount, status }] } })
  } catch {}
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
    const keep = prev && prev.count === cardCount
    map[historyId] = { count: cardCount, status: { ...(keep ? prev.status : {}), [unitIndex]: status }, ...(keep && prev.bounds ? { bounds: prev.bounds } : {}) }
    await AsyncStorage.setItem(UNIT_PROGRESS_KEY, JSON.stringify(map))
    enqueue({ t: 'progress', p: { unitProgress: [{ materialId: historyId, count: cardCount, status: map[historyId].status }] } })
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
    enqueue({ t: 'progress', p: { workLog: { [key]: log[key] } } })
  } catch {}
}

// ─── 生徒のテスト（試験日） ───
// 教材ごとに固定の期日が自動で決まり、先生は変更できない（動かせる締切は締切にならない。
// 生徒の学校行事は先生の決定領域の外）。期日が来たら結果メールが届き、全単元完了なら大成功、
// 未完了なら追試日が自動で立つ（責めない・行き止まらない）。教材が消えたら試験日も消える
export type ExamEntry = { date: string; round: number; doneAt?: number; studentId?: string; remindedAt?: number }
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
  try {
    const prev = await loadExamDays()
    await AsyncStorage.setItem(EXAM_DAYS_KEY, JSON.stringify(map))
    // 差分（変更・追加はエントリ、消えたものはnull=サーバ側で削除）だけ送る
    const diff: Record<string, ExamEntry | null> = {}
    for (const [k, v] of Object.entries(map)) {
      if (JSON.stringify(prev[k]) !== JSON.stringify(v)) diff[k] = v
    }
    for (const k of Object.keys(prev)) {
      if (!(k in map)) diff[k] = null
    }
    if (Object.keys(diff).length > 0) enqueue({ t: 'progress', p: { examDays: diff } })
  } catch {}
}

// 大成功の記録簿：追記専用のリスト（先生証のバッジから開く長期のトロフィー棚。決して減らない）。
// 業務日誌は400日で刈り取られるため別ストア。教材削除後も残るようタイトルはスナップショットで持つ
export type ExamSuccessRecord = { id: string; d: string; s?: string; t: string } // d=日付キー s=studentId t=教材タイトル
const EXAM_SUCCESS_LOG_KEY = 'oshiete_exam_success_log'

export async function loadExamSuccessLog(): Promise<ExamSuccessRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(EXAM_SUCCESS_LOG_KEY)
    return raw ? (JSON.parse(raw) as ExamSuccessRecord[]) : []
  } catch {
    return []
  }
}

export async function appendExamSuccessLog(rec: ExamSuccessRecord): Promise<void> {
  try {
    const list = [...(await loadExamSuccessLog()), rec]
    await AsyncStorage.setItem(EXAM_SUCCESS_LOG_KEY, JSON.stringify(list))
    enqueue({ t: 'progress', p: { examSuccessLog: { add: [rec] } } })
  } catch {}
}

// 生徒のテスト大成功（期日までに全単元完了）の累計。教材を消しても実績は残る
export async function loadExamSuccessCount(): Promise<number> {
  try { return Number(await AsyncStorage.getItem(EXAM_SUCCESS_KEY)) || 0 } catch { return 0 }
}

export async function bumpExamSuccessCount(): Promise<void> {
  try {
    await AsyncStorage.setItem(EXAM_SUCCESS_KEY, String((await loadExamSuccessCount()) + 1))
    enqueue({ t: 'progress', p: { examSuccessDelta: 1 } })
  } catch {}
}

export function todayDateKey(): string { const d = new Date(); return workDateKey(d.getFullYear(), d.getMonth(), d.getDate()) }
export function dateKeyAfterDays(days: number): string { const d = new Date(); d.setDate(d.getDate() + days); return workDateKey(d.getFullYear(), d.getMonth(), d.getDate()) }
export function examDateLabel(key: string): string { const p = key.split('-'); return `${Number(p[1])}月${Number(p[2])}日` }

// 期日の自動決定：残り単元数×2日（本番は5〜14日、追試は4〜10日に丸め）。
// ±1日のジッタ（教材IDハッシュ由来）で同時に取り込んだ教材の期日が揃うのを防ぎ、
// 土日に落ちた期日は次の月曜へ送る（学校のテストは平日にある）
export function makeExamEntry(unitCount: number, round: number, studentId?: string, seed?: string): ExamEntry {
  let days = round === 1 ? Math.min(14, Math.max(5, unitCount * 2)) : Math.min(10, Math.max(4, unitCount * 2))
  if (seed) days += (hashStr(seed) % 3) - 1
  const d = new Date()
  d.setDate(d.getDate() + days)
  if (d.getDay() === 6) d.setDate(d.getDate() + 2)
  else if (d.getDay() === 0) d.setDate(d.getDate() + 1)
  return { date: workDateKey(d.getFullYear(), d.getMonth(), d.getDate()), round, ...(studentId ? { studentId } : {}) }
}

// テストの予定を立てる（まだ無ければ）。作った場合はエントリを返す（呼び出し側がお知らせメールを送る）
export async function ensureExamDay(historyId: string, unitCount: number, studentId?: string): Promise<ExamEntry | null> {
  if (unitCount <= 0) return null
  const map = await loadExamDays()
  if (map[historyId]) return null
  const entry = makeExamEntry(unitCount, 1, studentId, historyId)
  map[historyId] = entry
  await saveExamDays(map)
  return entry
}

// テストのお知らせ・結果メール（生徒のトーンに合わせた定型。AIコールなし）。
// 文面は各種類6パターンのプールから教材ID＋種類＋回のハッシュで安定選択：同時に複数届いても
// 機械的に見えず、同じメールが再生成されても文面は変わらない（重複配信が二重事故に見えない）
export type ExamMailKind = 'propose' | 'full' | 'partial' | 'none' | 'remind'
const EXAM_MAIL_POOL: Record<ExamMailKind, { subject: string; siete: string; sowal: string }[]> = {
  propose: [
    { subject: 'こんどテストがあります…！',
      siete: '先生、じつは【{日付}】に「{教材}」のテストがあるんです…！それまでに、授業ぜんぶおねがいします！がんばります😊',
      sowal: '先生、あの...【{日付}】に「{教材}」のテストがあるんです...🐾 それまでに、授業ぜんぶおねがいします...！' },
    { subject: 'テストの日が決まりました！',
      siete: '先生、【{日付}】に「{教材}」のテストをやるって決まりました！それまでに授業ぜんぶ、おねがいします！✨',
      sowal: '先生...【{日付}】に「{教材}」のテストをやるって、決まったそうです...。それまでに授業、おねがいします...🐾' },
    { subject: '先生、聞いてください…！',
      siete: 'きょう学校で、【{日付}】に「{教材}」のテストがあるって言われました…！先生の授業だけがたよりです！おねがいします😊',
      sowal: 'きょう...【{日付}】に「{教材}」のテストがあるって言われました...。先生の授業だけがたよりです...🐾' },
    { subject: 'たいへんです、テストです！',
      siete: '【{日付}】に「{教材}」のテストがあります！ちょっとどきどきしていますが、先生とじゅんびすればだいじょうぶな気がします！',
      sowal: '【{日付}】に「{教材}」のテストがあります...。どきどきします...。先生とじゅんびしたいです...🐾' },
    { subject: 'テストのお知らせです',
      siete: '先生に報告です！【{日付}】に「{教材}」のテストをやることになりました。当日までに、授業でぜんぶ教えてほしいです！✨',
      sowal: '報告です...。【{日付}】に「{教材}」のテストをやることになりました...。当日までに、授業でおしえてほしいです🐾' },
    { subject: 'いっしょにがんばってほしいです！',
      siete: '「{教材}」のテストが【{日付}】にあります！ひとりだとふあんだけど、先生とならがんばれる気がします！😊',
      sowal: '「{教材}」のテスト...【{日付}】にあります...。ひとりだとふあんですが...先生とならがんばれそうです🐾' },
  ],
  full: [
    { subject: 'テストの結果、聞いてください！！',
      siete: '今日の「{教材}」のテスト、ぜんぶ書けました！！先生に教えてもらったところ、ぜんぶ出ました✨ ほんとうにありがとうございました！😊',
      sowal: '今日の「{教材}」のテスト...ぜんぶ書けました...！先生に教えてもらったところ、ぜんぶ出ました🐾 ほんとうにありがとうございました...！' },
    { subject: '見てください、テストの答案！',
      siete: '「{教材}」のテストが返ってきました！先生に教えてもらったところ、ぜんぶ書けていました✨ 先生のおかげです！',
      sowal: '「{教材}」のテスト、返ってきました...。教えてもらったところ、ぜんぶ書けていました...！先生のおかげです🐾' },
    { subject: 'やりました…！',
      siete: '「{教材}」のテスト、すごくよくできました！授業でやったところが、そのまま出たんです😊 つぎもよろしくおねがいします！',
      sowal: '「{教材}」のテスト...よくできました...！授業でやったところが、そのまま出ました🐾 つぎも、おねがいします...' },
    { subject: 'テスト、だいせいこうでした！',
      siete: 'きょうの「{教材}」のテスト、じしんをもって書けました！先生の授業のおかげです✨ ありがとうございました！',
      sowal: 'きょうの「{教材}」のテスト...じしんをもって書けました...！先生の授業のおかげです...🐾' },
    { subject: 'ほうこくがあります！',
      siete: 'じつは…「{教材}」のテスト、だいせいこうでした！！✨ 授業のノート、ぜんぶ役に立ちました！先生、さいこうです！',
      sowal: 'ほうこくです...。「{教材}」のテスト、だいせいこうでした...！授業のノート、ぜんぶ役に立ちました🐾' },
    { subject: '先生のおかげです！',
      siete: '「{教材}」のテスト、むずかしい問題もぜんぶ書けました！授業でやったことを思い出しながら解きました😊 ありがとうございました！',
      sowal: '「{教材}」のテスト...むずかしい問題も、書けました...。授業を思い出しながら解きました😊 ありがとうございました🐾' },
  ],
  partial: [
    { subject: 'テスト、がんばりました…！',
      siete: '今日、「{教材}」のテストがありました！教えてもらったところは、ばっちり書けました！のこりはむずかしかったです…。でも【{日付}】に追試があるんです。こんどこそ、ぜんぶ教えてほしいです…！',
      sowal: '今日、「{教材}」のテストがありました...。教えてもらったところは、ばっちり書けました🐾 のこりはむずかしかったです...。でも【{日付}】に追試があるんです。こんどこそ、ぜんぶ教えてほしいです...！' },
    { subject: 'テストの結果です…！',
      siete: '「{教材}」のテスト、教えてもらったところはちゃんと書けました！でも、のこりがむずかしくて…。【{日付}】に追試があるので、つづきの授業おねがいします！',
      sowal: '「{教材}」のテスト...教えてもらったところは書けました...。のこりがむずかしくて...。【{日付}】に追試があるので、つづきの授業、おねがいします🐾' },
    { subject: '追試、がんばりたいです！',
      siete: 'きょうの「{教材}」のテスト、半分くらい書けました！くやしいので、【{日付}】の追試までにのこりもぜんぶ教えてほしいです！',
      sowal: 'きょうの「{教材}」のテスト...半分くらい書けました...。【{日付}】に追試があるので、のこりも教えてほしいです...🐾' },
    { subject: 'もういちどチャンスがあります！',
      siete: '「{教材}」のテスト、やったところはばっちりでした！【{日付}】に追試があるって言われました。こんどこそ全部できるようになりたいです！',
      sowal: '「{教材}」のテスト...やったところは書けました...。【{日付}】に追試があります...。こんどこそ、ぜんぶできるようになりたいです🐾' },
    { subject: 'おしかったです…！',
      siete: '「{教材}」のテスト、おしかったです…！授業でやったところはできたのに、のこりが…。【{日付}】の追試でとりかえしたいです！おねがいします！',
      sowal: '「{教材}」のテスト...おしかったです...。授業でやったところは、できたのに...。【{日付}】の追試で、とりかえしたいです🐾' },
    { subject: 'はんぶんは、ばっちりでした！',
      siete: '「{教材}」のテスト、はんぶんはばっちりでした！のこりのところ、【{日付}】の追試までに教えてほしいです！😊',
      sowal: '「{教材}」のテスト...はんぶんは、ばっちりでした...。のこりを【{日付}】の追試までに、おしえてほしいです🐾' },
  ],
  none: [
    { subject: 'テスト、むずかしかったです…',
      siete: '今日、「{教材}」のテストがありました…。まだ教えてもらっていないところばかりで、むずかしかったです…。【{日付}】に追試があるので、こんどこそおねがいします…！',
      sowal: '今日、「{教材}」のテストがありました...。まだ教えてもらっていないところばかりで、むずかしかったです...。【{日付}】に追試があるので、こんどこそおねがいします...🐾' },
    { subject: 'つぎこそ、がんばります…！',
      siete: '「{教材}」のテスト、ぜんぜん書けませんでした…。でも【{日付}】に追試があります！それまでに授業、おねがいします…！',
      sowal: '「{教材}」のテスト...あまり書けませんでした...。【{日付}】に追試があるので、それまでに授業、おねがいします...🐾' },
    { subject: '先生、たすけてください…！',
      siete: 'きょうの「{教材}」のテスト、むずかしかったです…。【{日付}】の追試までに、ぜんぶ教えてもらえたらうれしいです…！',
      sowal: 'きょうの「{教材}」のテスト...むずかしかったです...。【{日付}】の追試までに、教えてもらえたらうれしいです...🐾' },
    { subject: '追試があります…！',
      siete: '「{教材}」のテスト、こんかいはだめでした…。でも【{日付}】に追試があるんです。こんどは先生といっしょにじゅんびしたいです！',
      sowal: '「{教材}」のテスト...こんかいはだめでした...。【{日付}】に追試があるので、こんどは先生とじゅんびしたいです🐾' },
    { subject: 'きょうはくやしい日です…',
      siete: '「{教材}」のテスト、ほとんど書けませんでした…。くやしいです…。【{日付}】の追試まで、先生の授業にかけます…！',
      sowal: '「{教材}」のテスト...ほとんど書けませんでした...。くやしいです...。【{日付}】の追試まで、先生の授業にかけます...🐾' },
    { subject: 'こんどこそ、です…！',
      siete: 'テストのけっか…「{教材}」はまだまだでした…。でもだいじょうぶ、【{日付}】に追試があります！先生、じかんをください！',
      sowal: 'テストのけっか...「{教材}」は、まだまだでした...。【{日付}】に追試があります...。じかんをください...🐾' },
  ],
  remind: [
    { subject: 'もうすぐテストです…！',
      siete: '【{日付}】の「{教材}」のテスト、もうすぐです…！まだ授業してもらっていないところがあって、ちょっとふあんです…。つづきの授業、おねがいします！',
      sowal: '【{日付}】の「{教材}」のテスト...もうすぐです...。まだ授業してもらっていないところがあって、ふあんです...🐾' },
    { subject: 'テストまであと少しです！',
      siete: '先生、【{日付}】の「{教材}」のテストがせまってきました！のこりの授業、まにあいますように…！おねがいします😊',
      sowal: '先生...【{日付}】の「{教材}」のテスト、せまってきました...。のこりの授業、おねがいします...🐾' },
    { subject: 'つづきの授業、おねがいします！',
      siete: '【{日付}】に「{教材}」のテストがあります…！やっていないところが出たらどうしようって、きのうゆめに見ました…。つづきの授業、おねがいします！',
      sowal: '【{日付}】に「{教材}」のテストがあります...。やっていないところが出たらどうしようって、きのうゆめに見ました...🐾' },
    { subject: '先生、じかんがないです…！',
      siete: '気づいたら【{日付}】の「{教材}」のテストがすぐそこです…！のこりのところ、先生といっしょにやりたいです！',
      sowal: '気づいたら...【{日付}】の「{教材}」のテスト、すぐそこです...。のこりのところ、いっしょにやりたいです🐾' },
    { subject: 'そわそわしています…！',
      siete: '【{日付}】の「{教材}」のテストのこと、かんがえるとそわそわします…！のこりの授業、おねがいしてもいいですか…？',
      sowal: '【{日付}】の「{教材}」のテスト...かんがえると、そわそわします...。のこりの授業...できたら、うれしいです🐾' },
    { subject: 'カレンダーを見てしまいます…',
      siete: '【{日付}】の「{教材}」のテストまで、あとすこしです！カレンダーを何回も見ちゃいます…。つづきの授業、おねがいします！',
      sowal: '【{日付}】の「{教材}」のテストまで...あとすこしです...。カレンダーを何回も見てしまいます...🐾' },
  ],
}

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

export function examMailFor(student: { id: string; name: string }, item: { id: string; title: string }, kind: ExamMailKind, dateLabel: string, round: number): MailMessage {
  const title = item.title.replace(/^この(教材|文書|画像|写真)は[、，]?\s*/u, '').slice(0, 24)
  const pool = EXAM_MAIL_POOL[kind]
  const v = pool[hashStr(`${item.id}:${kind}:${round}`) % pool.length]
  const content = (student.id === 'sowal' ? v.sowal : v.siete).replaceAll('{日付}', dateLabel).replaceAll('{教材}', title)
  return { id: `exam-${kind}-${item.id}-${round}-${Date.now()}`, type: 'student', from: student.name, studentId: student.id, subject: v.subject, content, timestamp: new Date().toISOString(), read: false, historyId: item.id }
}

const MAIL_KEY = 'senseigokko_mail'

const WELCOME_MAIL: MailMessage = {
  id: 'welcome',
  type: 'notice',
  from: 'オシエテ先生',
  subject: 'ようこそ、オシエテ先生へ！',
  content: '生徒を選んで、最初の授業を始めましょう',
  timestamp: new Date(0).toISOString(),
  read: false,
}

export async function loadMail(): Promise<MailMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(MAIL_KEY)
    const items = raw ? (JSON.parse(raw) as MailMessage[]) : []
    // 空（初回・サーバ同期直後）はようこそメールを出す
    if (items.length === 0) return [WELCOME_MAIL]
    // 旧アプリ名（せんせいごっこ）時代に保存されたようこそメールを現行の文面へ差し替える（既読状態は保持）
    return items.map((m) => (m.id === 'welcome' ? { ...WELCOME_MAIL, read: m.read } : m))
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
  enqueue({ t: 'progress', p: { mails: { add: [msg] } } })
  return updated
}

export async function markMailRead(id: string): Promise<MailMessage[]> {
  const current = await loadMail()
  const updated = current.map((m) => m.id === id ? { ...m, read: true } : m)
  await saveMail(updated)
  enqueue({ t: 'progress', p: { mails: { markRead: [id] } } })
  return updated
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
  try {
    const prev = await loadDrillPending()
    const kept = [...keys].slice(-500)
    await AsyncStorage.setItem(DRILL_PENDING_KEY, JSON.stringify(kept))
    const add = kept.filter((k) => !prev.has(k))
    const remove = [...prev].filter((k) => !keys.has(k))
    if (add.length > 0 || remove.length > 0) enqueue({ t: 'progress', p: { drillPending: { add, remove } } })
  } catch {}
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
  enqueueMaterialPut(newItem)
  return newItem
}

export async function deleteFromHistory(id: string): Promise<void> {
  const history = await loadHistory()
  await AsyncStorage.setItem(KEY, JSON.stringify(history.filter((h) => h.id !== id)))
  enqueue({ t: 'material-del', id }) // サーバ側は試験日・単元進度もFKカスケードで消える
  // 教材が消えたら、その教材のテストの予定も消す（読み出し側の存在チェックとの二重防御）
  try {
    const exams = await loadExamDays()
    if (exams[id]) { delete exams[id]; await saveExamDays(exams) }
  } catch {}
}

// 履歴の1件更新＋サーバ送信の共通処理
async function updateHistoryItem(id: string, patch: (h: HistoryItem) => HistoryItem): Promise<void> {
  const history = await loadHistory()
  const updated = history.map((h) => (h.id === id ? patch(h) : h))
  await AsyncStorage.setItem(KEY, JSON.stringify(updated))
  const item = updated.find((h) => h.id === id)
  if (item) enqueueMaterialPut(item)
}

export async function renameHistoryItem(id: string, newTitle: string): Promise<void> {
  await updateHistoryItem(id, (h) => ({ ...h, title: newTitle }))
}

export async function updateHistoryPreview(id: string, previewContent: PreviewContent): Promise<void> {
  await updateHistoryItem(id, (h) => ({ ...h, previewContent }))
}

// 教材ファクトシート（バックグラウンド生成）を履歴に保存
export async function updateHistoryFactsheet(id: string, factsheet: Factsheet): Promise<void> {
  await updateHistoryItem(id, (h) => ({ ...h, factsheet }))
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
  // Recapは専用op（サーバ側でmaterials.recapsへ生徒IDキーでマージ）
  enqueue({ t: 'progress', p: { recaps: [{ materialId: historyId, studentId, recap }] } })
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
  enqueue({ t: 'me', p: { savedGroups: groups } })
}

export async function moveItemToGroup(id: string, groupName: string | undefined): Promise<void> {
  await updateHistoryItem(id, (h) => ({ ...h, groupName }))
}

// グループ名の一括変更・解除は変わった教材だけサーバへ送る
async function updateHistoryByGroup(match: string, groupName: string | undefined): Promise<void> {
  const history = await loadHistory()
  const updated = history.map((h) => (h.groupName === match ? { ...h, groupName } : h))
  await AsyncStorage.setItem(KEY, JSON.stringify(updated))
  for (const h of updated) {
    if (history.find((p) => p.id === h.id)?.groupName !== h.groupName) enqueueMaterialPut(h)
  }
}

export async function renameGroupInStorage(oldName: string, newName: string): Promise<void> {
  await updateHistoryByGroup(oldName, newName)
}

export async function deleteGroupFromStorage(groupName: string): Promise<void> {
  await updateHistoryByGroup(groupName, undefined)
}
