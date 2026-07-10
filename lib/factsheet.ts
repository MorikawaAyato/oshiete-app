// ファクトシート（一問一答バンク）の自動更新まわりのクライアント判定。
// バンクの生成自体はサーバ（web側 /api/factsheet）が行い、ここでは
// 「手元に保存済みのファクトシートを開いたとき、裏で再生成すべきか」だけを決める。

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
export function needsFactsheetUpgrade(factsheet?: { cards?: unknown[]; version?: number }): boolean {
  if (!FACTSHEET_AUTO_UPGRADE) return false
  if (!factsheet?.cards?.length) return true
  return (factsheet.version ?? 0) < FACTSHEET_VERSION
}
