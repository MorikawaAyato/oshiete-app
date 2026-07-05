import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Image,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { useApp } from '@/lib/AppContext'
import { STUDENTS } from '@/lib/students'
import type { Section } from '@/lib/types'
import { c, font } from '@/lib/theme'
import BouncyPressable from '@/components/BouncyPressable'

export default function PreviewScreen() {
  const router = useRouter()
  const { previewContent, selectedStudentId, setSelectedStudentId, chatMessages, classEnded } = useApp()
  const student = STUDENTS.find(s => s.id === selectedStudentId) ?? null
  const hasActiveChat = chatMessages.length > 0 && !classEnded
  const [step, setStep] = useState(0)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [hiddenMode, setHiddenMode] = useState(false)

  if (!previewContent) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      </SafeAreaView>
    )
  }

  const totalSteps = 2 + previewContent.sections.length
  const isFirst = step === 0
  const isLast = step === totalSteps - 1

  const toggleReveal = (key: string) => {
    setRevealed((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  // キーワード隠し: [word] ブラケット記法をパースしてインライン要素を返す
  const buildTextNodes = (raw: string, lineIdx: number): React.ReactNode => {
    if (!hiddenMode) return raw.replace(/\[([^\]]+)\]/g, '$1')
    const bracketPat = /\[([^\]]+)\]/g
    const parts: React.ReactNode[] = []
    let last = 0; let ki = 0; let m: RegExpExecArray | null
    while ((m = bracketPat.exec(raw)) !== null) {
      if (m.index > last) parts.push(<Text key={last}>{raw.slice(last, m.index)}</Text>)
      const key = `${lineIdx}-${ki++}`
      const isRev = revealed.has(key)
      parts.push(
        <Text key={key} onPress={() => toggleReveal(key)}
          style={[styles.keyword, isRev ? styles.keywordRevealed : styles.keywordHidden]}>
          {m[1]}
        </Text>
      )
      last = m.index + m[0].length
    }
    if (last < raw.length) parts.push(<Text key={last}>{raw.slice(last)}</Text>)
    return parts.length > 0 ? parts : raw
  }

  const renderDetailText = (raw: string, _keywords: string[], lineIdx: number) => (
    <Text style={styles.detailText}>{buildTextNodes(raw, lineIdx)}</Text>
  )

  let content: React.ReactNode
  const currentSection: Section | null = step >= 2 ? previewContent.sections[step - 2] : null
  const showHiddenToggle = !!currentSection && currentSection.keywords.length > 0

  if (step === 0) {
    content = (
      <View style={styles.centerContent}>
        <Text style={styles.stepLabel}>この教材のテーマ</Text>
        <Text style={styles.themeText}>{previewContent.theme}</Text>
        <Text style={styles.hint}>次へ進んで各項目の詳細を確認しよう →</Text>
      </View>
    )
  } else if (step === 1) {
    content = (
      <View>
        <Text style={styles.stepLabel}>全体の概要</Text>
        {previewContent.sections.map((s, i) => (
          <View key={i} style={styles.flowItem}>
            <View style={styles.flowNum}>
              <Text style={styles.flowNumText}>{i + 1}</Text>
            </View>
            <View style={styles.flowInfo}>
              <Text style={styles.flowTitle}>{s.title}</Text>
              <Text style={styles.flowSummary}>{s.summary}</Text>
            </View>
          </View>
        ))}
      </View>
    )
  } else {
    const section = currentSection!
    const v = section.visual
    content = (
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionNum}>
            <Text style={styles.sectionNumText}>{step - 1}</Text>
          </View>
          <Text style={styles.sectionTitle}>{section.title}</Text>
        </View>

        <View style={styles.summaryBox}>
          <Text style={styles.summaryText}>{section.summary}</Text>
        </View>

        {v && v.type === 'table' && (
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              {v.headers.map((h, i) => (
                <Text key={i} style={styles.tableHeaderCell}>{buildTextNodes(h, 1000 + i)}</Text>
              ))}
            </View>
            {v.rows.map((row, ri) => (
              <View key={ri} style={[styles.tableRow, ri % 2 === 0 && styles.tableRowAlt]}>
                {row.map((cell, ci) => (
                  <Text key={ci} style={[styles.tableCell, ci === 0 && styles.tableCellBold]}>
                    {buildTextNodes(cell, 2000 + ri * 20 + ci)}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        )}

        {v && v.type === 'steps' && (
          <View style={styles.stepsBox}>
            {v.items.map((item, i) => (
              <View key={i} style={styles.stepItem}>
                <View style={styles.stepBullet}>
                  <Text style={styles.stepBulletText}>{i + 1}</Text>
                </View>
                <Text style={styles.stepItemText}>{buildTextNodes(item, 3000 + i)}</Text>
              </View>
            ))}
          </View>
        )}

        {v && v.type === 'comparison' && (
          <View style={styles.stepsBox}>
            {v.items.map((item, i) => (
              <View key={i} style={styles.compItem}>
                <Text style={styles.compLabel}>{buildTextNodes(item.label, 4000 + i * 2)}</Text>
                <Text style={styles.compValue}>{buildTextNodes(item.value, 4000 + i * 2 + 1)}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.detailsBox}>
          {section.details.map((d, i) => (
            <View key={i} style={styles.detailRow}>
              <Text style={styles.detailBullet}>•</Text>
              {renderDetailText(d, section.keywords, i)}
            </View>
          ))}
        </View>

        <View style={styles.keywordsRow}>
          {section.keywords.map((kw, i) => (
            <View key={i} style={[styles.kwBadge, hiddenMode && styles.kwBadgeHidden]}>
              <Text style={[styles.kwText, hiddenMode && styles.kwTextHidden]}>{kw}</Text>
            </View>
          ))}
        </View>
        {hiddenMode && (
          <Text style={styles.revealHint}>キーワードをタップして確認</Text>
        )}
        <View style={{ height: 16 }} />
      </ScrollView>
    )
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {/* ナビゲーションバー */}
        <View style={styles.navbar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>← 戻る</Text>
          </TouchableOpacity>
          <Text style={styles.navTitle}>📖 教材を見る</Text>
          <Text style={styles.navStep}>{step + 1} / {totalSteps}</Text>
        </View>

        {/* コンテンツ */}
        <View style={styles.body}>{content}</View>

        {/* 前へ / 隠して覚える / 次へ */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.navBtn, isFirst && styles.navBtnDisabled]}
            onPress={() => { setStep(step - 1); setRevealed(new Set()) }}
            disabled={isFirst}
          >
            <Text style={[styles.navBtnText, isFirst && styles.navBtnTextDisabled]}>← 前へ</Text>
          </TouchableOpacity>

          {showHiddenToggle ? (
            <TouchableOpacity
              style={[styles.hiddenPill, hiddenMode && styles.hiddenPillOn]}
              onPress={() => { setHiddenMode(!hiddenMode); setRevealed(new Set()) }}
            >
              <Text style={[styles.hiddenPillText, hiddenMode && styles.hiddenPillTextOn]}>
                隠す
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.hiddenPillSpace} />
          )}

          <TouchableOpacity
            style={[styles.navBtn, styles.navBtnNext, isLast && styles.navBtnDisabled]}
            onPress={() => { setStep(step + 1); setRevealed(new Set()) }}
            disabled={isLast}
          >
            <Text style={[styles.navBtnText, styles.navBtnTextNext, isLast && styles.navBtnTextDisabled]}>
              次へ →
            </Text>
          </TouchableOpacity>
        </View>

        {/* 授業ボタン */}
        {student ? (
          <BouncyPressable
            style={styles.startClassBtn}
            onPress={() => {
              if (hasActiveChat) {
                router.back()
              } else {
                router.push('/chat')
              }
            }}
            haptic="medium"
          >
            <Text style={styles.startClassBtnText}>
              {hasActiveChat ? `🎓　${student.name}との授業に戻る` : `🎓　${student.name}と授業を始める`}
            </Text>
          </BouncyPressable>
        ) : (
          <View style={styles.startClassBtnDisabled}>
            <Text style={styles.startClassBtnDisabledText}>生徒を選ぶと授業を始められます</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.skyBg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { flex: 1 },

  navbar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: 'white',
    borderBottomWidth: 1, borderBottomColor: c.border,
  },
  backBtn: { paddingVertical: 4, paddingRight: 8 },
  backText: { fontSize: 13, color: c.link },
  navTitle: { fontSize: 15, fontFamily: font.round, color: c.textStrong },
  navStep: { fontSize: 12, color: c.primary, fontWeight: '700' },

  body: { flex: 1, paddingHorizontal: 20, paddingTop: 24 },

  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  stepLabel: { fontSize: 11, fontWeight: '700', color: c.primary, letterSpacing: 1, marginBottom: 16, textTransform: 'uppercase' },
  themeText: { fontSize: 22, fontWeight: 'bold', color: c.textStrong, textAlign: 'center', lineHeight: 32 },
  hint: { fontSize: 13, color: c.textSub, marginTop: 32 },

  flowItem: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  flowNum: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: c.pinkSoft, borderWidth: 1, borderColor: c.pinkBorder,
    justifyContent: 'center', alignItems: 'center', marginTop: 2,
  },
  flowNumText: { fontSize: 12, fontWeight: 'bold', color: c.primary },
  flowInfo: { flex: 1 },
  flowTitle: { fontSize: 15, fontFamily: font.round, color: c.textStrong },
  flowSummary: { fontSize: 13, color: c.textMid, marginTop: 3, lineHeight: 19 },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  sectionNum: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: c.pinkSoft, borderWidth: 1, borderColor: c.pinkBorder,
    justifyContent: 'center', alignItems: 'center',
  },
  sectionNumText: { fontSize: 12, fontWeight: 'bold', color: c.primary },
  sectionTitle: { fontSize: 17, fontFamily: font.round, color: c.textStrong, flex: 1 },

  summaryBox: {
    borderLeftWidth: 3, borderLeftColor: c.pinkMuted,
    backgroundColor: c.pinkTint, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 14,
  },
  summaryText: { fontSize: 13, color: c.textMid, lineHeight: 20 },

  table: { borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: c.border, marginBottom: 14 },
  tableHeader: { flexDirection: 'row', backgroundColor: c.bgSub },
  tableHeaderCell: { flex: 1, fontSize: 12, fontWeight: '700', color: c.textMid, padding: 8 },
  tableRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: c.bgSub },
  tableRowAlt: { backgroundColor: c.bgSub },
  tableCell: { flex: 1, fontSize: 12, color: c.textMid, padding: 8 },
  tableCellBold: { fontWeight: '600', color: c.text },

  stepsBox: { marginBottom: 14, gap: 8 },
  stepItem: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  stepBullet: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: c.skyBorder, justifyContent: 'center', alignItems: 'center',
  },
  stepBulletText: { fontSize: 11, fontWeight: 'bold', color: c.link },
  stepItemText: { flex: 1, fontSize: 13, color: c.text, lineHeight: 19 },

  compItem: {
    backgroundColor: c.bg, borderRadius: 8,
    padding: 10, borderWidth: 1, borderColor: c.border,
  },
  compLabel: { fontSize: 12, fontWeight: '700', color: c.link, marginBottom: 2 },
  compValue: { fontSize: 12, color: c.textMid, lineHeight: 18 },

  detailsBox: { gap: 10, marginBottom: 14 },
  detailRow: { flexDirection: 'row', gap: 6 },
  detailBullet: { fontSize: 13, color: c.faint, marginTop: 1 },
  detailText: { flex: 1, fontSize: 13, color: c.text, lineHeight: 21 },
  keyword: { fontWeight: '600', borderRadius: 3, overflow: 'hidden' },
  keywordRevealed: { backgroundColor: c.pinkSoft, color: c.primaryStrong },
  keywordHidden: { backgroundColor: c.border, color: c.border },

  keywordsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  kwBadge: { backgroundColor: c.skyTint, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  kwBadgeHidden: { backgroundColor: c.border },
  kwText: { fontSize: 11, fontWeight: '600', color: c.link },
  kwTextHidden: { color: c.border },
  revealHint: { fontSize: 11, color: c.textSub, marginBottom: 4 },

  hiddenPill: {
    paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1.5, borderColor: c.border, backgroundColor: c.bg,
    alignItems: 'center', justifyContent: 'center', minWidth: 56,
  },
  hiddenPillOn: { borderColor: c.primary, backgroundColor: c.pinkTint },
  hiddenPillText: { fontSize: 12, fontWeight: '700', color: c.textSub },
  hiddenPillTextOn: { color: c.primaryStrong },
  hiddenPillSpace: { minWidth: 56 },

  startClassBtn: {
    marginHorizontal: 16, marginBottom: 8, paddingVertical: 13,
    backgroundColor: c.primaryStrong, borderRadius: 14, alignItems: 'center',
  },
  startClassBtnText: { fontSize: 15, fontFamily: font.round, color: 'white' },
  startClassBtnDisabled: {
    marginHorizontal: 16, marginBottom: 8, paddingVertical: 13,
    backgroundColor: c.bgSub, borderRadius: 14, alignItems: 'center',
    borderWidth: 1, borderColor: c.border,
  },
  startClassBtnDisabledText: { fontSize: 13, color: c.textSub },

  footer: {
    flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: 'white', borderTopWidth: 1, borderTopColor: c.border,
  },
  navBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1.5, borderColor: c.borderStrong, alignItems: 'center',
  },
  navBtnNext: { borderColor: c.link, backgroundColor: c.skyBg },
  navBtnDisabled: { borderColor: c.border, backgroundColor: c.bg },
  navBtnText: { fontSize: 14, fontFamily: font.round, color: c.link },
  navBtnTextNext: { color: c.link },
  navBtnTextDisabled: { color: c.borderStrong },
})
