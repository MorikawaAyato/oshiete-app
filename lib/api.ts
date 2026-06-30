const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? ''

export async function analyzeImages(
  images: { data: string; mimeType: string }[],
  existingGroups: { groupName: string; titles: string[] }[] = [],
): Promise<{ imageDescription: string; notes: string; suggestedGroupName?: string; error?: string }> {
  const res = await fetch(`${API_BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images, existingGroups }),
  })
  return res.json()
}

export async function fetchPreviewContent(
  imageDescription: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/api/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDescription }),
  })
  return res.json()
}

export async function startChat(
  studentId: string,
  imageDescription: string,
  notes: string,
): Promise<{ manaResponse?: string; error?: string }> {
  const res = await fetch(`${API_BASE}/api/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId, imageDescription, notes }),
  })
  return res.json()
}

export async function sendChat(
  studentId: string,
  imageDescription: string,
  notes: string,
  messages: { role: string; text: string }[],
): Promise<{ text?: string; error?: string }> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId, imageDescription, notes, messages }),
  })
  return res.json()
}
