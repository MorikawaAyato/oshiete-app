import type { Factsheet, QACard } from './types'

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? ''

// Clerkのセッショントークン取得関数。_layout.tsx（ClerkProviderの内側）から登録される。
// 未ログイン・Clerk未設定時はnullのままで、Authorizationヘッダなしのリクエストになる
let authTokenGetter: (() => Promise<string | null>) | null = null
export function setAuthTokenGetter(fn: (() => Promise<string | null>) | null) {
  authTokenGetter = fn
}
export function hasAuth(): boolean {
  return authTokenGetter !== null
}

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = authTokenGetter ? await authTokenGetter().catch(() => null) : null
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

// 共通リクエストヘルパー：res.ok チェックとタイムアウトをここで一元化する。
// モバイル回線はストールしうるので、無期限に待たずタイムアウトで必ず失敗に落とす（呼び出し側の catch → 再試行導線につながる）
async function requestJson<T extends { error?: string }>(
  path: string,
  init: { method: string; body?: unknown },
  timeoutMs: number,
): Promise<T> {
  if (!API_BASE) throw new Error('サーバの設定が見つかりません（EXPO_PUBLIC_API_URL 未設定）')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: init.method,
      headers: await authHeaders(),
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: controller.signal,
    })
    // 502/504 やメンテページはHTMLで返るため、JSONでなくても落ちないように読む
    let data: T | null = null
    try { data = (await res.json()) as T } catch { /* 非JSON応答 */ }
    if (!res.ok) {
      const err = new Error(
        data?.error ??
          (res.status === 429
            ? 'リクエストが多すぎます。少し待ってからもう一度試してください。'
            : `サーバとの通信に失敗しました（${res.status}）。もう一度試してください。`),
      ) as Error & { status?: number }
      err.status = res.status // 同期キューが401（未ログイン）を「保留」扱いにするために使う
      throw err
    }
    if (data === null) throw new Error('サーバの応答が読み取れませんでした。もう一度試してください。')
    return data
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error('通信がタイムアウトしました。電波のよい場所でもう一度試してください。')
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

async function postJson<T extends { error?: string }>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  return requestJson<T>(path, { method: 'POST', body }, timeoutMs)
}

// ─── 同期API（サーバが正） ───

export async function apiGetSync(): Promise<Record<string, unknown> & { error?: string }> {
  return requestJson('/api/sync', { method: 'GET' }, 60_000)
}

export async function apiPostProgress(body: unknown): Promise<{ ok?: boolean; error?: string }> {
  return postJson('/api/progress', body, 60_000)
}

export async function apiPostImport(body: unknown): Promise<{ ok?: boolean; imported?: unknown; error?: string }> {
  return postJson('/api/import', body, 120_000)
}

export async function apiPutMaterial(body: unknown): Promise<{ ok?: boolean; error?: string }> {
  return requestJson('/api/materials', { method: 'PUT', body }, 60_000)
}

export async function apiDeleteMaterial(id: string): Promise<{ ok?: boolean; error?: string }> {
  return requestJson(`/api/materials?id=${encodeURIComponent(id)}`, { method: 'DELETE' }, 30_000)
}

export async function apiPatchMe(body: unknown): Promise<{ ok?: boolean; error?: string }> {
  return requestJson('/api/me', { method: 'PATCH', body }, 30_000)
}

export async function analyzeText(
  text: string,
  existingGroups: { groupName: string; titles: string[] }[] = [],
): Promise<{ title: string; imageDescription: string; notes: string; suggestedGroupName?: string; error?: string }> {
  return postJson('/api/analyze-text', { text, existingGroups }, 120_000)
}

export async function analyzeImages(
  images: { data: string; mimeType: string }[],
  existingGroups: { groupName: string; titles: string[] }[] = [],
): Promise<{ imageDescription: string; notes: string; suggestedGroupName?: string; error?: string }> {
  return postJson('/api/analyze', { images, existingGroups }, 120_000)
}

export async function fetchPreviewContent(
  imageDescription: string,
): Promise<Record<string, unknown>> {
  return postJson('/api/preview', { imageDescription }, 90_000)
}

// 教材ファクトシートの生成（取り込み後にバックグラウンドで呼ぶ。失敗しても授業は成立する）
// サーバ側は多段のAI呼び出しを逐次行うため、タイムアウトは長めに取る
export async function fetchFactsheet(
  imageDescription: string,
  notes: string,
): Promise<{ factsheet?: Factsheet; error?: string }> {
  return postJson('/api/factsheet', { imageDescription, notes }, 300_000)
}

// 教材ファクトシートの追補（二段構えのフェーズ2）：網羅補完の追加カードと、
// 全カードから作った誤解素材を受け取る
export async function fetchFactsheetRefine(
  imageDescription: string,
  notes: string,
  cards: QACard[],
  sectionTitles: string[],
): Promise<{ cards?: QACard[]; misconceptions?: string[]; error?: string }> {
  return postJson('/api/factsheet/refine', { imageDescription, notes, cards, sectionTitles }, 300_000)
}

// プリント授業：答案（正誤つき）と虎の巻（ひとこと解説の候補）の生成。
// facts＝誤解素材が未生成のとき（追補の完了前に授業開始）のオンデマンド生成用。
// 作られた誤解はレスポンスで返るので、呼び出し元がファクトシートに保存する
export async function fetchPrint(
  studentId: string,
  items: { question: string; modelAnswer: string }[],
  misconceptions: string[],
  facts?: string[],
): Promise<{ items?: { studentAnswer: string; truth: 'correct' | 'wrong'; choices?: string[] }[]; misconceptions?: string[]; error?: string }> {
  return postJson('/api/print', { studentId, items, misconceptions, ...(facts?.length ? { facts } : {}) }, 90_000)
}

// 赤ペンラリーの先生メッセージ4分類（分類だけAI・生徒のセリフは定型プール）。
// 失敗・タイムアウトは explanation 扱い＝最悪ケースが従来挙動
export type RallyReplyKind = 'explanation' | 'dont_know' | 'praise' | 'off_topic'
const RALLY_KINDS: RallyReplyKind[] = ['explanation', 'dont_know', 'praise', 'off_topic']
export async function classifyRallyReply(question: string, modelAnswer: string, reply: string): Promise<RallyReplyKind> {
  try {
    const res = (await postJson('/api/rally', { question, modelAnswer, reply }, 2_500)) as { kind?: string }
    return RALLY_KINDS.includes(res.kind as RallyReplyKind) ? (res.kind as RallyReplyKind) : 'explanation'
  } catch {
    return 'explanation'
  }
}

