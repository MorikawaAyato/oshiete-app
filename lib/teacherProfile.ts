export type TeacherProfile = {
  name: string
  title: string
  avatarId: string
}

export const TEACHER_AVATAR_IMAGES: Record<string, ReturnType<typeof require>> = {
  taka:    require('../assets/taka_sensei.png'),
  tora:    require('../assets/tora_sensei.png'),
  kitsune: require('../assets/kitsune_sensei.png'),
  neko:    require('../assets/neko_sensei.png'),
}

export const TEACHER_AVATARS = [
  { id: 'taka',    label: 'タカ' },
  { id: 'tora',    label: 'トラ' },
  { id: 'kitsune', label: 'キツネ' },
  { id: 'neko',    label: 'ネコ' },
]

export const TEACHER_TITLES = ['新人先生', '見習い先生', '一人前の先生', 'ベテラン先生', '名物先生']

export const DEFAULT_TEACHER: TeacherProfile = { name: '', title: '新人先生', avatarId: 'taka' }

export function getTeacherAvatarImage(avatarId: string): ReturnType<typeof require> {
  return TEACHER_AVATAR_IMAGES[avatarId] ?? TEACHER_AVATAR_IMAGES['taka']
}
