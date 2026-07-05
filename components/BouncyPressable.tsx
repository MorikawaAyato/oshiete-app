import * as Haptics from 'expo-haptics'
import { useRef } from 'react'
import { Animated, Platform, Pressable } from 'react-native'
import type { GestureResponderEvent, PressableProps, StyleProp, ViewStyle } from 'react-native'

type Props = Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle>
  children?: React.ReactNode
  /** 押した瞬間の振動。light=通常操作 / medium=大事な操作 / success=完了・ごほうび */
  haptic?: 'light' | 'medium' | 'success'
}

// 押すとぽよんと縮むボタン。主要な操作ボタンは TouchableOpacity ではなくこれを使う
export default function BouncyPressable({ style, haptic, onPress, children, ...rest }: Props) {
  const scale = useRef(new Animated.Value(1)).current

  const pressIn = () => {
    Animated.spring(scale, { toValue: 0.95, useNativeDriver: true, speed: 40, bounciness: 0 }).start()
  }
  const pressOut = () => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 10 }).start()
  }
  const handlePress = (e: GestureResponderEvent) => {
    if (haptic && Platform.OS !== 'web') {
      if (haptic === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      else Haptics.impactAsync(haptic === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light)
    }
    onPress?.(e)
  }

  return (
    <Pressable onPressIn={pressIn} onPressOut={pressOut} onPress={handlePress} {...rest}>
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  )
}
