export type TeacherProfile = {
  name: string
  title: string
  avatarId: string
  unlockedTitleCount?: number // 解放済み称号数（昇進試験で増える。旧データは現称号から補完）
}

export const TEACHER_AVATAR_IMAGES: Record<string, ReturnType<typeof require>> = {
  usagi:   require('../assets/usagi_sensei.webp'),
  ookami:  require('../assets/ookami_sensei.webp'),
  kitsune: require('../assets/kitsune_sensei.webp'),
  neko:    require('../assets/neko_sensei.webp'),
}

// 先頭がデフォルトの先生（初回起動時に設定される）
export const TEACHER_AVATARS = [
  { id: 'ookami',  label: 'オオカミ', character: 'オオカミ（男性教師）' },
  { id: 'usagi',   label: 'ウサギ',   character: 'ウサギ（男性教師）' },
  { id: 'kitsune', label: 'キツネ',   character: 'キツネ（女性教師）' },
  { id: 'neko',    label: 'ネコ',     character: 'ネコ（女性教師）' },
]

// 旧キャラクターID（タカ→ウサギ、トラ→オオカミ）。保存済みプロフィールを新IDへ読み替える
const LEGACY_AVATAR_IDS: Record<string, string> = { taka: 'usagi', tora: 'ookami' }

export function normalizeAvatarId(avatarId: string): string {
  return LEGACY_AVATAR_IDS[avatarId] ?? avatarId
}

export const TEACHER_TITLES = ['新人先生', '見習い先生', '一人前の先生', 'ベテラン先生', '名物先生']

// 解放済み称号数。昇進試験導入前のプロフィールは現在の称号までを解放済みとして扱う
export function getUnlockedTitleCount(profile: TeacherProfile): number {
  const fromTitle = TEACHER_TITLES.indexOf(profile.title) + 1
  return Math.min(TEACHER_TITLES.length, Math.max(profile.unlockedTitleCount ?? 1, fromTitle, 1))
}

export const DEFAULT_TEACHER: TeacherProfile = { name: '', title: '新人先生', avatarId: 'ookami' }

export function getTeacherAvatarImage(avatarId: string): ReturnType<typeof require> {
  return TEACHER_AVATAR_IMAGES[normalizeAvatarId(avatarId)] ?? TEACHER_AVATAR_IMAGES['ookami']
}

export function getTeacherCharacter(avatarId: string): string {
  const id = normalizeAvatarId(avatarId)
  return TEACHER_AVATARS.find(a => a.id === id)?.character ?? 'オオカミ（男性教師）'
}
