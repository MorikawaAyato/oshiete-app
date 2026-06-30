import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Ionicons from '@expo/vector-icons/Ionicons'

type Tab = 'home' | 'library'

export function BottomTabBar({ active }: { active: Tab }) {
  const router = useRouter()
  const insets = useSafeAreaInsets()

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
          color={active === 'home' ? '#ec4899' : '#94a3b8'}
        />
        <Text style={[styles.label, active === 'home' && styles.labelActive]}>ホーム</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.tab}
        onPress={() => { if (active !== 'library') router.push('/library') }}
        activeOpacity={active === 'library' ? 1 : 0.7}
      >
        <Ionicons
          name={active === 'library' ? 'book' : 'book-outline'}
          size={24}
          color={active === 'library' ? '#ec4899' : '#94a3b8'}
        />
        <Text style={[styles.label, active === 'library' && styles.labelActive]}>教材</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
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
    color: '#94a3b8',
  },
  labelActive: {
    color: '#ec4899',
  },
})
