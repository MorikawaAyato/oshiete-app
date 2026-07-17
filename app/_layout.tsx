import { ClerkProvider, useAuth } from '@clerk/clerk-expo'
import * as SecureStore from 'expo-secure-store'
import { Stack, useRouter, useSegments } from 'expo-router'
import { useEffect } from 'react'
import { useFonts, ZenMaruGothic_700Bold, ZenMaruGothic_900Black } from '@expo-google-fonts/zen-maru-gothic'
// 手書き風（子どもの鉛筆書き）。生徒が書くもの（答案・ノートのメモ）だけに使う
import { Yomogi_400Regular } from '@expo-google-fonts/yomogi'
import { AppProvider } from '@/lib/AppContext'
import { setAuthTokenGetter } from '@/lib/api'
import { bootstrapSync } from '@/lib/sync'

const tokenCache = {
  async getToken(key: string) {
    return SecureStore.getItemAsync(key)
  },
  async saveToken(key: string, value: string) {
    return SecureStore.setItemAsync(key, value)
  },
}

const clerkKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? ''
const hasValidClerkKey = clerkKey.startsWith('pk_') && !clerkKey.includes('xxx')

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded, getToken } = useAuth()
  const segments = useSegments()
  const router = useRouter()

  // APIクライアントにトークン取得関数を渡し、ログイン確立時にサーバ同期を起動する
  useEffect(() => {
    if (!isLoaded) return
    if (isSignedIn) {
      setAuthTokenGetter(() => getToken())
      void bootstrapSync()
    } else {
      setAuthTokenGetter(null)
    }
  }, [isSignedIn, isLoaded, getToken])

  useEffect(() => {
    if (!isLoaded) return
    const inSignIn = segments[0] === 'sign-in'
    if (!isSignedIn && !inSignIn) router.replace('/sign-in')
    if (isSignedIn && inSignIn) router.replace('/')
  }, [isSignedIn, isLoaded])

  return <>{children}</>
}

function AppStack() {
  return <Stack screenOptions={{ headerShown: false }} />
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ ZenMaruGothic_700Bold, ZenMaruGothic_900Black, Yomogi_400Regular })
  if (!fontsLoaded) return null

  // Clerkキー未設定時（開発中）はAuth不要でそのままアプリを表示
  if (!hasValidClerkKey) {
    return (
      <AppProvider>
        <AppStack />
      </AppProvider>
    )
  }

  return (
    <ClerkProvider publishableKey={clerkKey} tokenCache={tokenCache}>
      <AppProvider>
        <AuthGate>
          <AppStack />
        </AuthGate>
      </AppProvider>
    </ClerkProvider>
  )
}
