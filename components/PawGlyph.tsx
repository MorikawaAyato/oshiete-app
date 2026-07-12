import { View } from 'react-native'

// 犬の肉球（グレー）。react-native-svgを使わず丸めたViewで描画する。
// size でグリフの一辺(px)を指定（16基準でスケール）。上向き。
export default function PawGlyph({ size = 16, color = '#94a3b8' }: { size?: number; color?: string }) {
  const s = size / 16
  const pad = { position: 'absolute' as const, backgroundColor: color }
  return (
    <View style={{ width: size, height: size }}>
      <View style={[pad, { left: 3.5 * s, top: 7 * s, width: 9 * s, height: 8 * s, borderRadius: 4.5 * s }]} />
      <View style={[pad, { left: 0.8 * s, top: 4 * s, width: 3.6 * s, height: 4.8 * s, borderRadius: 2 * s }]} />
      <View style={[pad, { left: 4.6 * s, top: 1.4 * s, width: 3.6 * s, height: 4.8 * s, borderRadius: 2 * s }]} />
      <View style={[pad, { left: 8 * s, top: 1.4 * s, width: 3.6 * s, height: 4.8 * s, borderRadius: 2 * s }]} />
      <View style={[pad, { left: 11.6 * s, top: 4 * s, width: 3.6 * s, height: 4.8 * s, borderRadius: 2 * s }]} />
    </View>
  )
}
