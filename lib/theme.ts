import type { TextStyle, ViewStyle } from 'react-native'

// オシエテ先生 カラートークン
// 色は役割ベースでここに一元管理する。画面側では必ずここから参照する。
// 配色コンセプト「白と墨と、一撃のピンク」：基調は無彩色（ストーン）に統一し、
// ショッキングピンクは主要CTAと選択状態だけの一点アクセントにする。
// 淡ピンク・淡スカイの「面」は全廃（パステル面の多色使いが幼く見える原因のため）
export const c = {
  // ニュートラル（ストーン＝温かみのある無彩色）
  bg: '#fafaf9',
  bgSub: '#f5f5f4',
  border: '#e7e5e4',
  borderStrong: '#d6d3d1',
  faint: '#a8a29e', // 装飾・アイコン専用。読ませる文字には textSub 以上を使う
  textSub: '#78716c',
  textMid: '#57534e',
  text: '#44403c',
  textStrong: '#292524',
  ink: '#1c1917',

  // ブランド（ピンク）＝主要CTA・選択状態だけの一点アクセント。淡色面は敷かない
  pinkTint: '#fafaf9', // 旧・淡ピンク面 → 基調色に中和（選択状態は白地＋pinkBorderの枠線で表現）
  pinkSoft: '#f5f5f4',
  pinkBorder: '#fbcfe8',
  pinkMuted: '#f9a8d4',
  primary: '#ec4899',
  primaryStrong: '#db2777',

  // 情報・リンク（機能色として維持。淡スカイの面は基調色に中和）
  skyTint: '#fafaf9',
  skyBg: '#f5f5f4',
  skyBorder: '#e7e5e4',
  skySoft: '#d6d3d1',
  sky: '#0ea5e9',
  link: '#0369a1',
  skyStrong: '#1c1917', // 見出し用途はインクに統一

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

// 丸ゴシック（Zen Maru Gothic）。見出し・生徒名・ボタン文字だけに使い、本文はシステムフォントのまま。
// fontFamily を指定した Text には fontWeight を併用しない（Android で標準フォントに落ちる）
export const font = {
  round: 'ZenMaruGothic_700Bold',
  roundHeavy: 'ZenMaruGothic_900Black',
  hand: 'Yomogi_400Regular', // 生徒の手書き（答案・ノートのメモ）
} as const

// ボタン3階層。1画面に primary（塗り）はひとつだけ置く。
export const btn = {
  // ① 塗り＝その画面の最重要操作
  primary: {
    backgroundColor: c.primaryStrong,
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  } satisfies ViewStyle,
  primaryText: { color: 'white', fontSize: 15, fontFamily: font.round } satisfies TextStyle,

  // ② 白＋枠＝並列の操作・戻る系
  secondary: {
    backgroundColor: 'white', borderWidth: 1, borderColor: c.borderStrong,
    borderRadius: 14, paddingVertical: 13, alignItems: 'center',
  } satisfies ViewStyle,
  secondaryText: { color: c.textMid, fontSize: 14, fontFamily: font.round } satisfies TextStyle,

  // ③ テキストのみ＝補助操作
  tertiaryText: { color: c.link, fontSize: 13, fontFamily: font.round } satisfies TextStyle,
}
