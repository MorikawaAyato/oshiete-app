import { useEffect, useRef } from 'react'
import { Animated, type StyleProp, type TextStyle } from 'react-native'

// 丸付けスタンプ: active になった瞬間、はんこを押したように弾んで現れるテキスト。
// ○✕ボタンの選択マークに使う（activeでない間は普通のテキストとして描画される）
export default function StampText({
  active,
  style,
  children,
}: {
  active: boolean
  style?: StyleProp<TextStyle>
  children: React.ReactNode
}) {
  const scale = useRef(new Animated.Value(1)).current
  const prev = useRef(active)

  useEffect(() => {
    if (active && !prev.current) {
      // 大きめ・ゆっくり弾ませる（初期倍率を上げ、tensionを下げてゆっくり収束）
      scale.setValue(3.6)
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 55, useNativeDriver: true }).start()
    }
    prev.current = active
  }, [active])

  return (
    <Animated.Text style={[style, active && { transform: [{ scale }] }]}>
      {children}
    </Animated.Text>
  )
}
