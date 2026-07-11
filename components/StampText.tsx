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
      scale.setValue(2.1)
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 160, useNativeDriver: true }).start()
    }
    prev.current = active
  }, [active])

  return (
    <Animated.Text style={[style, active && { transform: [{ scale }] }]}>
      {children}
    </Animated.Text>
  )
}
