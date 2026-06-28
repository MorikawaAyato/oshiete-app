import { ClerkProvider, useAuth } from '@clerk/clerk-expo'
import * as SecureStore from 'expo-secure-store'
import { Stack, useRouter, useSegments } from 'expo-router'
import { useEffect } from 'react'
import { AppProvider } from '@/lib/AppContext'

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
  const { isSignedIn, isLoaded } = useAuth()
  const segments = useSegments()
  const router = useRouter()

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
