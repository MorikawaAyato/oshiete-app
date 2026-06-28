import AsyncStorage from '@react-native-async-storage/async-storage'
import type { HistoryItem, PreviewContent } from './types'

const KEY = 'oshiete_history'
const MAX = 6

export async function loadHistory(): Promise<HistoryItem[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as HistoryItem[]) : []
  } catch {
    return []
  }
}

export async function saveToHistory(
  item: Omit<HistoryItem, 'id' | 'savedAt'>,
): Promise<HistoryItem> {
  const history = await loadHistory()
  const newItem: HistoryItem = {
    ...item,
    id: Date.now().toString(),
    savedAt: new Date().toISOString(),
  }
  const updated = [newItem, ...history].slice(0, MAX)
  await AsyncStorage.setItem(KEY, JSON.stringify(updated))
  return newItem
}

export async function deleteFromHistory(id: string): Promise<void> {
  const history = await loadHistory()
  await AsyncStorage.setItem(KEY, JSON.stringify(history.filter((h) => h.id !== id)))
}

export async function updateHistoryPreview(id: string, previewContent: PreviewContent): Promise<void> {
  const history = await loadHistory()
  const updated = history.map((h) => (h.id === id ? { ...h, previewContent } : h))
  await AsyncStorage.setItem(KEY, JSON.stringify(updated))
}
