import { useOAuth } from '@clerk/clerk-expo'
import * as WebBrowser from 'expo-web-browser'
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native'
import { SafeAreaView } from 'react-native'

WebBrowser.maybeCompleteAuthSession()

export default function SignIn() {
  const { startOAuthFlow } = useOAuth({ strategy: 'oauth_google' })

  const handleGoogle = async () => {
    try {
      const { createdSessionId, setActive } = await startOAuthFlow()
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId })
      }
    } catch (e) {
      console.error('OAuth error:', e)
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>せんせいごっこ</Text>
        <Text style={styles.subtitle}>教えると、わかる。</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>ログインして始める</Text>
          <Text style={styles.cardDesc}>
            授業の履歴や設定を保存するためにログインが必要です
          </Text>
          <TouchableOpacity style={styles.googleBtn} onPress={handleGoogle}>
            <Text style={styles.googleBtnText}>🔑　Googleでログイン</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#e0f2fe' },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#0c4a6e',
    letterSpacing: 1,
    marginBottom: 8,
  },
  subtitle: { fontSize: 14, color: '#0369a1', marginBottom: 48 },
  card: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 28,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 8,
  },
  cardDesc: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  googleBtn: {
    backgroundColor: '#f472b6',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  googleBtnText: { color: 'white', fontWeight: 'bold', fontSize: 15 },
})
