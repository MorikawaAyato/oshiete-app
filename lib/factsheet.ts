// ファクトシート（一問一答バンク）の自動更新まわりのクライアント判定と、先生の訂正の適用。
// バンクの生成自体はサーバ（web側 /api/factsheet）が行い、ここでは
// 「手元に保存済みのファクトシートを開いたとき、裏で再生成すべきか」だけを決める。
import type { QACard, Erratum } from './types'

// バンク生成ルールの版。★web側 lib/factsheet.ts の FACTSHEET_VERSION と必ず同じ値にすること。
// ずれると再生成が無限に走る／永久に更新されない、のどちらかになる。
export const FACTSHEET_VERSION = 2

// ─── 自動更新（バックフィル）のオン/オフ ───
// 教材を開いたとき、バンク未生成・または旧版のファクトシートを裏で自動再生成するか。
// true にすると古い教材も新ルールのバンクに更新されるが、教材ごとに /api/factsheet が1回走る。
// コストを抑えたいときは false にすれば、開くだけでの再生成は一切走らない（既存データはそのまま使う）。
export const FACTSHEET_AUTO_UPGRADE = true

// この教材のファクトシートを自動更新すべきか（バンクが無い、または生成ルールが旧版）。
// FACTSHEET_AUTO_UPGRADE が false のときは常に false（再生成しない）。
// 先生の訂正(errata)がある教材は、自動再生成でユーザ修正を消さないよう常にスキップする。
export function needsFactsheetUpgrade(factsheet?: { cards?: unknown[]; version?: number; errata?: unknown[] }): boolean {
  if (!FACTSHEET_AUTO_UPGRADE) return false
  if (factsheet?.errata?.length) return false
  if (!factsheet?.cards?.length) return true
  return (factsheet.version ?? 0) < FACTSHEET_VERSION
}

// 先生がカードの答えを直したときの純粋な更新：カードのa/statementを上書きし、
// factsを再導出し、正誤表(errata)エントリを追加（同じsourceは1件に集約）。変化が無ければnull。
export function applyCardCorrection(
  cards: QACard[],
  errata: Erratum[] | undefined,
  cardIndex: number,
  rawNewAnswer: string,
): { cards: QACard[]; facts: string[]; errata: Erratum[] } | null {
  const newAnswer = rawNewAnswer.trim()
  if (cardIndex < 0 || cardIndex >= cards.length || !newAnswer) return null
  const target = cards[cardIndex]
  if (newAnswer === target.a.trim()) return null
  const nextCards = cards.map((c, i) => (i === cardIndex ? { ...c, a: newAnswer, statement: newAnswer } : c))
  const facts = nextCards.map((c) => c.statement)
  const erratum: Erratum = { source: target.source, oldAnswer: target.a, newAnswer, correctedAt: Date.now() }
  const nextErrata = [...(errata ?? []).filter((e) => e.source !== target.source), erratum]
  return { cards: nextCards, facts, errata: nextErrata }
}
