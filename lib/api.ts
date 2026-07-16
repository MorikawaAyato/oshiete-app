import type { Factsheet, Recap } from './types'

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? ''

// 共通POSTヘルパー：res.ok チェックとタイムアウトをここで一元化する。
// モバイル回線はストールしうるので、無期限に待たずタイムアウトで必ず失敗に落とす（呼び出し側の catch → 再試行導線につながる）
async function postJson<T extends { error?: string }>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  if (!API_BASE) throw new Error('サーバの設定が見つかりません（EXPO_PUBLIC_API_URL 未設定）')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    // 502/504 やメンテページはHTMLで返るため、JSONでなくても落ちないように読む
    let data: T | null = null
    try { data = (await res.json()) as T } catch { /* 非JSON応答 */ }
    if (!res.ok) {
      throw new Error(
        data?.error ??
          (res.status === 429
            ? 'リクエストが多すぎます。少し待ってからもう一度試してください。'
            : `サーバとの通信に失敗しました（${res.status}）。もう一度試してください。`),
      )
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

// プリント授業：答案（正誤つき）と虎の巻（ひとこと解説の候補）の生成
export async function fetchPrint(
  studentId: string,
  items: { question: string; modelAnswer: string }[],
  misconceptions: string[],
): Promise<{ items?: { studentAnswer: string; truth: 'correct' | 'wrong'; choices?: string[] }[]; error?: string }> {
  return postJson('/api/print', { studentId, items, misconceptions }, 90_000)
}

// あとから質問メール（授業の数日後、生徒がつまずきを思い出して質問してくる）の生成
export async function fetchFollowupMail(
  studentId: string,
  materialTitle: string,
  recap: Recap,
  teacherName?: string,
): Promise<{ subject?: string; body?: string; error?: string }> {
  return postJson('/api/followup', { studentId, materialTitle, recap, teacherName }, 60_000)
}
