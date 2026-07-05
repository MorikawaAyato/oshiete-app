import type { TextStyle, ViewStyle } from 'react-native'

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

  // 紙もの（アンバー）＝ノート・虎の巻の専用色
  paper: '#fffbeb',
  paperBorder: '#fef3c7',
  paperLine: '#fde68a',
  paperRule: '#fcd34d',
  paperText: '#b45309', // 小さな文字でも 4.5:1 を満たす濃さ

  // セマンティック
  success: '#10b981',
  successText: '#059669',
  warn: '#fbbf24',
  danger: '#ef4444',
  dangerText: '#dc2626',
} as const

// ボタン3階層。1画面に primary（塗り）はひとつだけ置く。
export const btn = {
  // ① 塗り＝その画面の最重要操作
  primary: {
    backgroundColor: c.primaryStrong,
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  } satisfies ViewStyle,
  primaryText: { color: 'white', fontSize: 15, fontWeight: '700' } satisfies TextStyle,

  // ② 白＋枠＝並列の操作・戻る系
  secondary: {
    backgroundColor: 'white', borderWidth: 1, borderColor: c.borderStrong,
    borderRadius: 14, paddingVertical: 13, alignItems: 'center',
  } satisfies ViewStyle,
  secondaryText: { color: c.textMid, fontSize: 14, fontWeight: '700' } satisfies TextStyle,

  // ③ テキストのみ＝補助操作
  tertiaryText: { color: c.link, fontSize: 13, fontWeight: '600' } satisfies TextStyle,
}
