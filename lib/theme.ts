// せんせいごっこ カラートークン
// 色は役割ベースでここに一元管理する。画面側では必ずここから参照する。
export const c = {
  // ニュートラル（スレート）
  bg: '#f8fafc',
  bgSub: '#f1f5f9',
  border: '#e2e8f0',
  borderStrong: '#cbd5e1',
  faint: '#94a3b8', // 装飾・アイコン専用。読ませる文字には textSub 以上を使う
  textSub: '#64748b',
  textMid: '#475569',
  text: '#334155',
  textStrong: '#1e293b',
  ink: '#0f172a',

  // ブランド（ピンク）＝主要操作・先生の色
  pinkTint: '#fdf2f8',
  pinkSoft: '#fce7f3',
  pinkBorder: '#fbcfe8',
  pinkMuted: '#f9a8d4',
  primarySoft: '#f472b6',
  primary: '#ec4899',
  primaryStrong: '#db2777',

  // 情報・リンク（スカイ）
  skyTint: '#f0f9ff',
  skyBg: '#e0f2fe',
  skyBorder: '#bae6fd',
  skySoft: '#7dd3fc',
  sky: '#0ea5e9',
  link: '#0369a1',
  skyStrong: '#0c4a6e',

  // パープル（廃止予定 → スカイ系に統合する）
  purpleTint: '#fdf4ff',
  purpleBg: '#ede9fe',
  purpleBorder: '#e9d5ff',
  purple: '#7c3aed',
  purpleText: '#6d28d9',

  // 紙もの（アンバー）＝ノート・虎の巻の専用色
  paper: '#fffbeb',
  paperBorder: '#fef3c7',
  paperLine: '#fde68a',
  paperRule: '#fcd34d',
  paperText: '#d97706',

  // セマンティック
  success: '#10b981',
  successText: '#059669',
  warn: '#fbbf24',
  danger: '#ef4444',
  dangerSoft: '#f87171',
  dangerText: '#dc2626',
} as const
