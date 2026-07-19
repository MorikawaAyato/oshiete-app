import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  apiDeleteMaterial,
  apiGetSync,
  apiPatchMe,
  apiPostImport,
  apiPostProgress,
  apiPutMaterial,
  hasAuth,
} from './api'
import type { HistoryItem } from './types'

// ─── サーバ同期層 ───
// 方針: AsyncStorageは「キャッシュ」、サーバが正。
// - 書き込みはstorage.tsの各mutationが差分をキュー（QUEUE_KEY）に積み、ここが順に送る（write-through）
// - 起動時 bootstrapSync(): 未送信キューをflush → 初回だけ端末データを一括import → /api/sync でキャッシュを作り直す
// - オフラインでもアプリは今までどおり動き、キューが次のオンライン時に送られる
//
// ストレージキーはstorage.ts/AppContext.tsxと同じ値をここに再掲する
// （storage.ts → sync.ts の一方向importに保つため。変更時は両方を直すこと）
const KEYS = {
  history: 'oshiete_history',
  groups: 'oshiete_groups',
  cardProgress: 'oshiete_card_progress',
  drillPending: 'oshiete_drill_pending',
  unitProgress: 'oshiete_unit_progress',
  examDays: 'oshiete_exam_days',
  examSuccess: 'oshiete_exam_success_count',
  examSuccessLog: 'oshiete_exam_success_log',
  workLog: 'oshiete_work_log',
  mail: 'senseigokko_mail',
  followupSent: 'oshiete_followup_sent',
  teacher: 'oshiete_teacher',
  student: 'oshiete_student',
} as const

const QUEUE_KEY = 'oshiete_pending_sync'
const IMPORTED_KEY = 'oshiete_imported_v1'
const QUEUE_MAX = 300

export type SyncOp =
  | { t: 'progress'; p: Record<string, unknown> }
  | { t: 'material'; p: Record<string, unknown> }
  | { t: 'material-del'; id: string }
  | { t: 'me'; p: Record<string, unknown> }

async function loadQueue(): Promise<SyncOp[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY)
    return raw ? (JSON.parse(raw) as SyncOp[]) : []
  } catch {
    return []
  }
}

async function saveQueue(q: SyncOp[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-QUEUE_MAX)))
  } catch {}
}

// 書き込みをキューに積んで送信を試みる（storage.tsの各mutationから呼ばれる）。
// 失敗してもキューに残り、次のenqueue/bootstrapSyncで再送される
export function enqueue(op: SyncOp): void {
  void (async () => {
    const q = await loadQueue()
    q.push(op)
    await saveQueue(q)
    void flush()
  })()
}

let flushing = false

// キューを先頭から順に送る。401（未ログイン）や通信断は「保留」＝キューに残して停止。
// 400/409（検証エラー）はそのopだけ捨てる（毒まんじゅうでキューを詰まらせない）
export async function flush(): Promise<void> {
  if (flushing || !hasAuth()) return
  flushing = true
  try {
    let q = await loadQueue()
    while (q.length > 0) {
      const op = q[0]
      try {
        if (op.t === 'progress') await apiPostProgress(op.p)
        else if (op.t === 'material') await apiPutMaterial(op.p)
        else if (op.t === 'material-del') await apiDeleteMaterial(op.id)
        else if (op.t === 'me') await apiPatchMe(op.p)
        q = q.slice(1)
        await saveQueue(q)
      } catch (e) {
        const status = (e as { status?: number }).status
        if (status === 400 || status === 409) {
          q = q.slice(1)
          await saveQueue(q)
          continue
        }
        break // 401・5xx・オフラインは次の機会に再送
      }
    }
  } finally {
    flushing = false
  }
}

// 端末の全ストアを読み上げて一括import（初回ログイン時に1度だけ。API側は冪等）
async function importLocalOnce(): Promise<void> {
  if (await AsyncStorage.getItem(IMPORTED_KEY)) return
  const read = async <T,>(key: string, fallback: T): Promise<T> => {
    try {
      const raw = await AsyncStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : fallback
    } catch {
      return fallback
    }
  }
  const history = await read<HistoryItem[]>(KEYS.history, [])
  const teacher = await read<{ name?: string; avatarId?: string } | null>(KEYS.teacher, null)
  const selectedStudentId = (await AsyncStorage.getItem(KEYS.student).catch(() => null)) ?? undefined
  const examSuccessRaw = await AsyncStorage.getItem(KEYS.examSuccess).catch(() => null)
  await apiPostImport({
    teacher: { name: teacher?.name, avatarId: teacher?.avatarId, selectedStudentId },
    savedGroups: await read<string[]>(KEYS.groups, []),
    materials: history.map((h) => ({
      id: h.id,
      title: h.title,
      imageDescription: h.imageDescription,
      notes: h.notes,
      groupName: h.groupName,
      thumbnails: h.thumbnails,
      factsheet: h.factsheet,
      previewContent: h.previewContent,
      recaps: h.recaps,
      savedAt: h.savedAt,
    })),
    cardProgress: await read(KEYS.cardProgress, {}),
    drillPending: await read<string[]>(KEYS.drillPending, []),
    unitProgress: await read(KEYS.unitProgress, {}),
    examDays: await read(KEYS.examDays, {}),
    examSuccessCount: Number(examSuccessRaw) || 0,
    examSuccessLog: await read(KEYS.examSuccessLog, []),
    workLog: await read(KEYS.workLog, {}),
    mails: await read(KEYS.mail, []),
    followupSent: await read<string[]>(KEYS.followupSent, []),
  })
  await AsyncStorage.setItem(IMPORTED_KEY, '1')
}

// サーバの状態でキャッシュを作り直す（読みの同期）
async function pullToCache(): Promise<void> {
  const data = (await apiGetSync()) as {
    user?: { teacherName?: string | null; avatarId?: string | null; selectedStudentId?: string | null; savedGroups?: string[] } | null
    materials?: Record<string, unknown>[]
    cardProgress?: Record<string, unknown>
    drillPending?: string[]
    unitProgress?: Record<string, unknown>
    examDays?: Record<string, unknown>
    examSuccessLog?: unknown[]
    stats?: { examSuccessCount?: number }
    workLog?: Record<string, unknown>
    mails?: Record<string, unknown>[]
    followupSent?: string[]
  }
  const setJson = (key: string, value: unknown) => AsyncStorage.setItem(key, JSON.stringify(value))
  await Promise.all([
    setJson(KEYS.history, data.materials ?? []),
    setJson(KEYS.groups, data.user?.savedGroups ?? []),
    setJson(KEYS.cardProgress, data.cardProgress ?? {}),
    setJson(KEYS.drillPending, data.drillPending ?? []),
    setJson(KEYS.unitProgress, data.unitProgress ?? {}),
    setJson(KEYS.examDays, data.examDays ?? {}),
    setJson(KEYS.examSuccessLog, data.examSuccessLog ?? []),
    AsyncStorage.setItem(KEYS.examSuccess, String(data.stats?.examSuccessCount ?? 0)),
    setJson(KEYS.workLog, data.workLog ?? {}),
    setJson(KEYS.mail, data.mails ?? []),
    setJson(KEYS.followupSent, data.followupSent ?? []),
  ])
  // プロフィール（サーバに値がある項目だけキャッシュへ反映）
  if (data.user?.teacherName || data.user?.avatarId) {
    try {
      const raw = await AsyncStorage.getItem(KEYS.teacher)
      const cur = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      await setJson(KEYS.teacher, {
        ...cur,
        ...(data.user.teacherName ? { name: data.user.teacherName } : {}),
        ...(data.user.avatarId ? { avatarId: data.user.avatarId } : {}),
      })
    } catch {}
  }
  if (data.user?.selectedStudentId) {
    try { await AsyncStorage.setItem(KEYS.student, data.user.selectedStudentId) } catch {}
  }
}

// 同期完了の購読（画面がキャッシュを読み直すきっかけ）
const syncListeners = new Set<() => void>()
export function onSyncComplete(fn: () => void): () => void {
  syncListeners.add(fn)
  return () => { syncListeners.delete(fn) }
}

// 起動時の同期一式。成功でtrue（購読者に通知し、画面はキャッシュを読み直す）。
// 失敗（オフライン等）はfalseで、アプリはキャッシュのまま動き続ける
let bootstrapping = false
export async function bootstrapSync(): Promise<boolean> {
  if (!hasAuth() || bootstrapping) return false
  bootstrapping = true
  try {
    await importLocalOnce()
    await flush()
    await pullToCache()
    syncListeners.forEach((fn) => { try { fn() } catch {} })
    return true
  } catch {
    return false
  } finally {
    bootstrapping = false
  }
}
