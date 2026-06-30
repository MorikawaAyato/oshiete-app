import AsyncStorage from '@react-native-async-storage/async-storage'
import type { HistoryItem, PreviewContent } from './types'

const KEY = 'oshiete_history'
const GROUPS_KEY = 'oshiete_groups'
export const HISTORY_MAX = 18

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
  const updated = [newItem, ...history].slice(0, HISTORY_MAX)
  await AsyncStorage.setItem(KEY, JSON.stringify(updated))
  return newItem
}

export async function deleteFromHistory(id: string): Promise<void> {
  const history = await loadHistory()
  await AsyncStorage.setItem(KEY, JSON.stringify(history.filter((h) => h.id !== id)))
}

export async function renameHistoryItem(id: string, newTitle: string): Promise<void> {
  const history = await loadHistory()
  const updated = history.map((h) => h.id === id ? { ...h, title: newTitle } : h)
  await AsyncStorage.setItem(KEY, JSON.stringify(updated))
}

export async function updateHistoryPreview(id: string, previewContent: PreviewContent): Promise<void> {
  const history = await loadHistory()
  const updated = history.map((h) => (h.id === id ? { ...h, previewContent } : h))
  await AsyncStorage.setItem(KEY, JSON.stringify(updated))
}

export async function loadSavedGroups(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(GROUPS_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export async function saveGroupsList(groups: string[]): Promise<void> {
  await AsyncStorage.setItem(GROUPS_KEY, JSON.stringify(groups))
}

export async function moveItemToGroup(id: string, groupName: string | undefined): Promise<void> {
  const history = await loadHistory()
  const updated = history.map((h) => h.id === id ? { ...h, groupName } : h)
  await AsyncStorage.setItem(KEY, JSON.stringify(updated))
}

export async function renameGroupInStorage(oldName: string, newName: string): Promise<void> {
  const history = await loadHistory()
  const updated = history.map((h) => h.groupName === oldName ? { ...h, groupName: newName } : h)
  await AsyncStorage.setItem(KEY, JSON.stringify(updated))
}

export async function deleteGroupFromStorage(groupName: string): Promise<void> {
  const history = await loadHistory()
  const updated = history.map((h) => h.groupName === groupName ? { ...h, groupName: undefined } : h)
  await AsyncStorage.setItem(KEY, JSON.stringify(updated))
}
