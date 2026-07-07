import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Ionicons from '@expo/vector-icons/Ionicons'
import { c } from '@/lib/theme'

type Tab = 'home' | 'library' | 'training'

export function BottomTabBar({ active }: { active: Tab }) {
  const router = useRouter()
  const insets = useSafeAreaInsets()

  // スタックを [ホーム, タブ画面1枚] に保つ：ホームからはpush、タブ間はreplace、ホームへはback
  const goTab = (path: '/library' | '/training') => {
    if (active === 'home') router.push(path)
    else router.replace(path)
  }

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <TouchableOpacity
        style={styles.tab}
        onPress={() => { if (active !== 'home') router.back() }}
        activeOpacity={active === 'home' ? 1 : 0.7}
      >
        <Ionicons
          name={active === 'home' ? 'home' : 'home-outline'}
          size={24}
          color={active === 'home' ? c.primary : c.faint}
        />
        <Text style={[styles.label, active === 'home' && styles.labelActive]}>ホーム</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.tab}
        onPress={() => { if (active !== 'library') goTab('/library') }}
        activeOpacity={active === 'library' ? 1 : 0.7}
      >
        <Ionicons
          name={active === 'library' ? 'book' : 'book-outline'}
          size={24}
          color={active === 'library' ? c.primary : c.faint}
        />
        <Text style={[styles.label, active === 'library' && styles.labelActive]}>教材</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.tab}
        onPress={() => { if (active !== 'training') goTab('/training') }}
        activeOpacity={active === 'training' ? 1 : 0.7}
      >
        <Ionicons
          name={active === 'training' ? 'school' : 'school-outline'}
          size={24}
          color={active === 'training' ? c.primary : c.faint}
        />
        <Text style={[styles.label, active === 'training' && styles.labelActive]}>研修</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
    backgroundColor: 'white',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 4,
    gap: 3,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    color: c.faint,
  },
  labelActive: {
    color: c.primary,
  },
})
