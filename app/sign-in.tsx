import { useSignIn, useSignUp } from '@clerk/clerk-expo'
import { useState } from 'react'
import { View, Text, TextInput, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native'
import { SafeAreaView } from 'react-native'
import { c, font } from '@/lib/theme'
import BouncyPressable from '@/components/BouncyPressable'

// メール＋確認コード方式のログイン（パスワードなし）。
// 入力されたメールで既存アカウントならサインイン、未登録なら自動でサインアップに切り替える。
// 想定ユーザーは保護者（メールに届く6桁コードを入力するだけ）
export default function SignIn() {
  const { signIn, setActive: setActiveSignIn, isLoaded: signInLoaded } = useSignIn()
  const { signUp, setActive: setActiveSignUp, isLoaded: signUpLoaded } = useSignUp()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sendCode = async () => {
    const address = email.trim()
    if (!address.includes('@') || busy || !signInLoaded || !signUpLoaded) return
    setBusy(true)
    setError(null)
    try {
      // まず既存アカウントとしてサインインを試みる
      const si = await signIn!.create({ identifier: address })
      const factor = si.supportedFirstFactors?.find((f) => f.strategy === 'email_code')
      if (!factor || factor.strategy !== 'email_code') throw new Error('このメールアドレスではコードログインができません')
      await signIn!.prepareFirstFactor({ strategy: 'email_code', emailAddressId: factor.emailAddressId })
      setMode('signin')
      setStep('code')
    } catch (e) {
      // アカウントが無ければ新規登録フローへ
      const codeStr = (e as { errors?: { code?: string }[] })?.errors?.[0]?.code
      if (codeStr === 'form_identifier_not_found') {
        try {
          await signUp!.create({ emailAddress: address })
          await signUp!.prepareEmailAddressVerification({ strategy: 'email_code' })
          setMode('signup')
          setStep('code')
        } catch {
          setError('コードを送れませんでした。メールアドレスを確認してください。')
        }
      } else {
        setError('コードを送れませんでした。メールアドレスを確認してください。')
      }
    } finally {
      setBusy(false)
    }
  }

  const verifyCode = async () => {
    const trimmed = code.trim()
    if (trimmed.length < 4 || busy) return
    setBusy(true)
    setError(null)
    try {
      if (mode === 'signin') {
        const res = await signIn!.attemptFirstFactor({ strategy: 'email_code', code: trimmed })
        if (res.status === 'complete') await setActiveSignIn!({ session: res.createdSessionId })
        else throw new Error('incomplete')
      } else {
        const res = await signUp!.attemptEmailAddressVerification({ code: trimmed })
        if (res.status === 'complete') await setActiveSignUp!({ session: res.createdSessionId })
        else throw new Error('incomplete')
      }
    } catch {
      setError('コードがちがうようです。もう一度確認してください。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.container}>
          <Text style={styles.title}>オシエテ先生</Text>
          <Text style={styles.subtitle}>教えるとおぼえる、せんせいごっこ。</Text>

          <View style={styles.card}>
            {step === 'email' ? (
              <>
                <Text style={styles.cardTitle}>ログインして始める</Text>
                <Text style={styles.cardDesc}>
                  メールアドレスに確認コードを送ります。{'\n'}授業の記録を保存するために使います（おうちの人のメールでOK）
                </Text>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="mail@example.com"
                  placeholderTextColor={c.textSub}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!busy}
                  onSubmitEditing={() => void sendCode()}
                />
                <BouncyPressable style={styles.primaryBtn} onPress={() => void sendCode()} haptic="light">
                  {busy ? <ActivityIndicator color="white" /> : <Text style={styles.primaryBtnText}>コードを送る</Text>}
                </BouncyPressable>
              </>
            ) : (
              <>
                <Text style={styles.cardTitle}>コードを入力</Text>
                <Text style={styles.cardDesc}>{email.trim()} に届いた数字を入力してください</Text>
                <TextInput
                  style={[styles.input, styles.codeInput]}
                  value={code}
                  onChangeText={setCode}
                  placeholder="123456"
                  placeholderTextColor={c.textSub}
                  keyboardType="number-pad"
                  editable={!busy}
                  onSubmitEditing={() => void verifyCode()}
                />
                <BouncyPressable style={styles.primaryBtn} onPress={() => void verifyCode()} haptic="light">
                  {busy ? <ActivityIndicator color="white" /> : <Text style={styles.primaryBtnText}>ログインする</Text>}
                </BouncyPressable>
                <BouncyPressable
                  style={styles.linkBtn}
                  onPress={() => { setStep('email'); setCode(''); setError(null) }}
                  haptic="light"
                >
                  <Text style={styles.linkBtnText}>メールアドレスを入力しなおす</Text>
                </BouncyPressable>
              </>
            )}
            {error && <Text style={styles.errorText}>{error}</Text>}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.skyBg },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 36,
    fontFamily: font.roundHeavy,
    color: c.skyStrong,
    letterSpacing: 1,
    marginBottom: 8,
  },
  subtitle: { fontSize: 14, color: c.link, marginBottom: 48 },
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
    fontFamily: font.round,
    color: c.textStrong,
    marginBottom: 8,
  },
  cardDesc: {
    fontSize: 13,
    color: c.textSub,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: c.textStrong,
    backgroundColor: c.skyBg,
    marginBottom: 12,
  },
  codeInput: { textAlign: 'center', fontSize: 22, letterSpacing: 8 },
  primaryBtn: {
    backgroundColor: c.primaryStrong,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  primaryBtnText: { color: 'white', fontFamily: font.round, fontSize: 15 },
  linkBtn: { marginTop: 14 },
  linkBtnText: { color: c.link, fontSize: 13 },
  errorText: { color: '#dc2626', fontSize: 13, marginTop: 12, textAlign: 'center' },
})
