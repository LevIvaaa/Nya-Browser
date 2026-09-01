import { app } from 'electron'
import { copyFileSync, mkdirSync, readdirSync, rmSync, existsSync, statSync, unlinkSync } from 'fs'
import { extname, join } from 'path'
import { randomUUID } from 'crypto'
import { JsonStore, track } from './store'
import type { AvatarCrop, Profile, ProfilesState } from '../shared/types'

const PROFILES_VERSION = 1

const AVATARS = ['🐱', '🦊', '🐼', '🦉', '🐧', '🐙', '🦄', '🐝', '🌙', '⭐', '🔥', '🌿']
const COLORS = ['#7C6CFF', '#0A84FF', '#00B8A9', '#2FBF71', '#F5A524', '#FF6B6B', '#E255A1', '#8E8E93']

/** Formats a browser can draw in an <img>, animation included. */
const PICTURE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp']
/** A picture 8 MB into a 40-pixel circle is a mistake, not a preference. */
const MAX_AVATAR_BYTES = 8 * 1024 * 1024

const pick = <T>(list: T[], seed: number) => list[seed % list.length]

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

const sanitizeCrop = (raw: unknown): AvatarCrop | undefined => {
  if (!raw || typeof raw !== 'object') return undefined
  const crop = raw as Partial<AvatarCrop>
  return {
    x: clamp(crop.x, -1, 1, 0),
    y: clamp(crop.y, -1, 1, 0),
    scale: clamp(crop.scale, 1, 4, 1)
  }
}

function makeProfile(name: string, index = 0): Profile {
  return {
    id: randomUUID(),
    name: name.slice(0, 40) || 'Профиль',
    avatar: pick(AVATARS, index),
    color: pick(COLORS, index),
    created: Date.now(),
    lastUsed: Date.now()
  }
}

const sanitizeProfile = (raw: Partial<Profile>, index: number): Profile => ({
  id: typeof raw.id === 'string' && raw.id.length >= 8 ? raw.id : randomUUID(),
  name: String(raw.name ?? 'Профиль').slice(0, 40) || 'Профиль',
  avatar: typeof raw.avatar === 'string' && raw.avatar.length <= 140 ? raw.avatar : pick(AVATARS, index),
  crop: sanitizeCrop(raw.crop),
  color: /^#[0-9a-f]{6}$/i.test(String(raw.color)) ? String(raw.color) : pick(COLORS, index),
  created: Number.isFinite(raw.created) ? Number(raw.created) : Date.now(),
  lastUsed: Number.isFinite(raw.lastUsed) ? Number(raw.lastUsed) : Date.now()
})

/**
 * Profiles are fully separate browsing identities: their own cookies, cache,
 * history, bookmarks, passwords, settings and wallpapers. Nothing is shared
 * except the window geometry.
 */
class Profiles {
  private store = track(
    new JsonStore<ProfilesState>(
      'profiles.json',
      () => {
        const first = makeProfile('Личный')
        return { profiles: [first], activeId: first.id }
      },
      PROFILES_VERSION,
      (data) => data as Partial<ProfilesState>,
      (data) => {
        const list = Array.isArray(data?.profiles) ? data.profiles : []
        const profiles = list.map((p, i) => sanitizeProfile(p ?? {}, i))
        if (profiles.length === 0) profiles.push(makeProfile('Личный'))
        const activeId = profiles.some((p) => p.id === data?.activeId)
          ? (data!.activeId as string)
          : profiles[0].id
        return { profiles, activeId }
      }
    )
  )

  load() {
    this.store.open(app.getPath('userData'))
    mkdirSync(this.dir(this.activeId), { recursive: true })
    return this.state
  }

  get state(): ProfilesState {
    return this.store.get()
  }

  get activeId(): string {
    return this.store.get().activeId
  }

  get active(): Profile {
    const state = this.store.get()
    return state.profiles.find((p) => p.id === state.activeId) ?? state.profiles[0]
  }

  /** Directory holding everything that belongs to one profile. */
  dir(id = this.activeId): string {
    return join(app.getPath('userData'), 'profiles', id)
  }

  /**
   * Avatars live outside any one profile: the switcher draws every profile at
   * once, and a picture kept inside a profile folder would be unreachable from
   * all the others.
   */
  avatarDir(): string {
    const dir = join(app.getPath('userData'), 'avatars')
    mkdirSync(dir, { recursive: true })
    return dir
  }

  /**
   * Copies a picture the user chose into the avatars folder and points the
   * profile at it. The name carries a stamp so the previous picture cannot be
   * served from cache in place of the new one.
   */
  setAvatarFile(id: string, source: string): ProfilesState {
    const ext = extname(source).slice(1).toLowerCase()
    if (!PICTURE_EXTENSIONS.includes(ext)) return this.state
    if (statSync(source).size > MAX_AVATAR_BYTES) return this.state

    const name = `${id}-${Date.now()}.${ext}`
    copyFileSync(source, join(this.avatarDir(), name))
    this.forgetAvatarFiles(id, name)
    // A new picture starts uncropped; the old crop belonged to the old one.
    return this.update(id, { avatar: `file:${name}`, crop: { x: 0, y: 0, scale: 1 } })
  }

  /** Drops the picture and leaves the profile on whatever emoji it names. */
  clearAvatarFile(id: string, emoji: string): ProfilesState {
    this.forgetAvatarFiles(id)
    return this.update(id, { avatar: emoji, crop: undefined })
  }

  /** Removes this profile's pictures, except one it is allowed to keep. */
  private forgetAvatarFiles(id: string, keep?: string) {
    try {
      for (const name of readdirSync(this.avatarDir())) {
        if (name.startsWith(`${id}-`) && name !== keep) unlinkSync(join(this.avatarDir(), name))
      }
    } catch {
      /* a leftover picture is not worth failing the change over */
    }
  }

  wallpaperDir(id = this.activeId): string {
    const dir = join(this.dir(id), 'wallpapers')
    mkdirSync(dir, { recursive: true })
    return dir
  }

  /** Session partition name — this is what keeps cookies separate. */
  partition(id = this.activeId): string {
    return `persist:profile-${id}`
  }

  create(name: string): Profile {
    const state = this.store.get()
    const profile = makeProfile(name, state.profiles.length)
    this.store.replace({ profiles: [...state.profiles, profile], activeId: state.activeId })
    mkdirSync(this.dir(profile.id), { recursive: true })
    this.store.flush()
    return profile
  }

  update(id: string, patch: Partial<Pick<Profile, 'name' | 'avatar' | 'crop' | 'color'>>): ProfilesState {
    // Settling on an emoji leaves the old picture with nothing pointing at it.
    if (typeof patch.avatar === 'string' && !patch.avatar.startsWith('file:')) {
      this.forgetAvatarFiles(id)
    }
    const state = this.store.get()
    const profiles = state.profiles.map((p) =>
      p.id === id
        ? sanitizeProfile({ ...p, ...patch }, 0)
        : p
    )
    this.store.replace({ profiles, activeId: state.activeId })
    this.store.flush()
    return this.store.get()
  }

  /** Deleting a profile also removes its data from disk. */
  remove(id: string): ProfilesState {
    const state = this.store.get()
    if (state.profiles.length <= 1) return state
    const profiles = state.profiles.filter((p) => p.id !== id)
    const activeId = state.activeId === id ? profiles[0].id : state.activeId
    this.store.replace({ profiles, activeId })
    this.store.flush()
    this.forgetAvatarFiles(id)
    try {
      const dir = this.dir(id)
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    } catch {
      /* the folder can be cleaned up later */
    }
    return this.store.get()
  }

  setActive(id: string): Profile {
    const state = this.store.get()
    if (!state.profiles.some((p) => p.id === id)) return this.active
    const profiles = state.profiles.map((p) => (p.id === id ? { ...p, lastUsed: Date.now() } : p))
    this.store.replace({ profiles, activeId: id })
    this.store.flush()
    mkdirSync(this.dir(id), { recursive: true })
    return this.active
  }

  flush() {
    this.store.flush()
  }

  static get avatars() {
    return AVATARS
  }
  static get colors() {
    return COLORS
  }
}

export const profiles = new Profiles()
export const AVATAR_PICTURE_EXTENSIONS = PICTURE_EXTENSIONS
export const AVATAR_CHOICES = AVATARS
export const COLOR_CHOICES = COLORS
