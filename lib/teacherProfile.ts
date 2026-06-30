export type TeacherProfile = {
  name: string
  title: string
  avatarId: string
}

export const TEACHER_AVATARS = [
  { id: 'cat',     emoji: '🐱' },
  { id: 'dog',     emoji: '🐶' },
  { id: 'fox',     emoji: '🦊' },
  { id: 'bear',    emoji: '🐻' },
  { id: 'panda',   emoji: '🐼' },
  { id: 'koala',   emoji: '🐨' },
  { id: 'tiger',   emoji: '🐯' },
  { id: 'lion',    emoji: '🦁' },
  { id: 'rabbit',  emoji: '🐰' },
  { id: 'penguin', emoji: '🐧' },
  { id: 'owl',     emoji: '🦉' },
  { id: 'frog',    emoji: '🐸' },
]

export const TEACHER_TITLES = ['新人先生', '見習い先生', '一人前の先生', 'ベテラン先生', '名物先生']

export const DEFAULT_TEACHER: TeacherProfile = { name: '', title: '新人先生', avatarId: 'cat' }

export function getTeacherEmoji(avatarId: string): string {
  return TEACHER_AVATARS.find(a => a.id === avatarId)?.emoji ?? '🐱'
}
