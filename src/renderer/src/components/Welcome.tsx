import { useEffect, useRef, useState } from 'react'
import type { Profile, SearchEngine, Settings } from '../../../shared/types'
import logoUrl from '../assets/logo.png'
import { Check, Cross, Film, Image, Palette, Shield, Sparkles, Zap } from './Icons'
import { Avatar, Slider, TextField, Toggle, cx } from './ui'
import WindowControls from './WindowControls'

/* ---------------------------------------------------------------- pieces */

const ACCENTS = ['#7C6CFF', '#0A84FF', '#00B8A9', '#2FBF71', '#F5A524', '#FF6B6B', '#E255A1', '#8E8E93']
const AVATARS = ['🐱', '🦊', '🐼', '🦉', '🐧', '🐙', '🦄', '🐝', '🌙', '⭐', '🔥', '🌿']

type StepId = 'hello' | 'profile' | 'look' | 'glass' | 'wallpaper' | 'search' | 'privacy' | 'done'

const STEPS: { id: StepId; title: string }[] = [
  { id: 'hello', title: 'Знакомство' },
  { id: 'profile', title: 'Профиль' },
  { id: 'look', title: 'Тема' },
  { id: 'glass', title: 'Прозрачность' },
  { id: 'wallpaper', title: 'Обои' },
  { id: 'search', title: 'Поиск' },
  { id: 'privacy', title: 'Защита' },
  { id: 'done', title: 'Готово' }
]

/**
 * The setup a person walks through the first time the browser opens.
 *
 * Every choice is applied the moment it is made rather than at the end: the
 * window behind the flow is the real browser, so picking a colour or a
 * wallpaper shows what it will actually look like instead of a swatch.
 */
export default function Welcome({
  settings,
  engines,
  profile,
  maximized,
  onPatch,
  onDone
}: {
  settings: Settings
  engines: SearchEngine[]
  profile: Profile | null
  maximized: boolean
  onPatch: (patch: Partial<Settings>) => void
  onDone: () => void
}) {
  const [index, setIndex] = useState(0)
  // Which way the last move went, so the arriving panel slides in from the
  // side it came from instead of always from the right.
  const [back, setBack] = useState(false)
  const step = STEPS[index]
  const lastMove = useRef(0)

  // One move per beat. A double-click on «Дальше» or a held-down Enter would
  // otherwise walk through steps faster than they can be seen — which reads
  // as the flow skipping parts of the setup.
  const go = (to: number) => {
    const now = Date.now()
    if (now - lastMove.current < 300) return
    lastMove.current = now
    setBack(to < index)
    setIndex(Math.min(STEPS.length - 1, Math.max(0, to)))
  }

  // The flow owns the keyboard while it is up: Enter moves on, Escape steps
  // back rather than dropping someone halfway through with no way out.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Autorepeat is never "next, next, next" on purpose.
      if (event.repeat) return
      const inField = Boolean((event.target as HTMLElement | null)?.closest('input'))
      if (event.key === 'Enter' && !inField) {
        event.preventDefault()
        if (index === STEPS.length - 1) onDone()
        else go(index + 1)
      }
      if (event.key === 'Escape' && index > 0) {
        event.preventDefault()
        go(index - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // The wallpaper step is the one place the flow steps aside: the real
  // wallpaper is already painted behind it, and a solid backdrop would make
  // this a step about swatches rather than about what the browser will look
  // like.
  const seeThrough = step.id === 'wallpaper'

  return (
    <div
      className="drag animate-fade fixed inset-0 z-[200] flex flex-col overflow-hidden"
      style={{
        background: seeThrough ? 'color-mix(in srgb, var(--bg) 58%, transparent)' : 'var(--bg)',
        backdropFilter: seeThrough ? 'blur(3px)' : undefined,
        transition: 'background var(--t-slow) linear'
      }}
    >
      {!seeThrough && <Aurora accent={settings.accent} />}

      {/* The flow covers the toolbar, and with it the only way to close a
          frameless window. It brings its own. */}
      <div className="no-drag absolute right-0 top-0 z-20">
        <WindowControls maximized={maximized} />
      </div>

      {/* ------------------------------------------------------- progress */}
      <div className="no-drag relative z-10 flex shrink-0 items-center justify-center gap-1.5 px-6 pt-6">
        {STEPS.map((item, i) => (
          <button
            key={item.id}
            onClick={() => i <= index && go(i)}
            title={item.title}
            className="h-1.5 rounded-pill"
            style={{
              width: i === index ? 34 : 16,
              cursor: i <= index ? 'pointer' : 'default',
              background:
                i <= index ? 'var(--accent)' : 'var(--line-strong)',
              transition: 'width var(--t-base) var(--ease-spring), background var(--t-base) linear'
            }}
          />
        ))}
      </div>

      {/* ---------------------------------------------------------- panel */}
      <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-6 py-4">
        <div
          key={step.id}
          className={cx('no-drag w-full max-w-[620px]', back ? 'animate-step-back' : 'animate-step')}
        >
          {step.id === 'hello' && <Hello />}
          {step.id === 'profile' && <ProfileStep profile={profile} />}
          {step.id === 'look' && <LookStep settings={settings} onPatch={onPatch} />}
          {step.id === 'glass' && <GlassStep settings={settings} onPatch={onPatch} />}
          {step.id === 'wallpaper' && <WallpaperStep settings={settings} onPatch={onPatch} />}
          {step.id === 'search' && (
            <SearchStep settings={settings} engines={engines} onPatch={onPatch} />
          )}
          {step.id === 'privacy' && <PrivacyStep settings={settings} onPatch={onPatch} />}
          {step.id === 'done' && <Done settings={settings} engines={engines} profile={profile} />}
        </div>
      </div>

      {/* --------------------------------------------------------- footer */}
      <div className="no-drag relative z-10 flex shrink-0 items-center justify-between gap-3 px-8 pb-7">
        <button
          className="btn"
          onClick={() => go(index - 1)}
          style={{ visibility: index === 0 ? 'hidden' : 'visible' }}
        >
          Назад
        </button>
        <div className="flex items-center gap-2">
          {index > 0 && index < STEPS.length - 1 && (
            <button className="btn" onClick={onDone}>
              Пропустить настройку
            </button>
          )}
          <button
            className="btn btn-primary px-6"
            onClick={() => (index === STEPS.length - 1 ? onDone() : go(index + 1))}
          >
            {index === 0 ? 'Начать' : index === STEPS.length - 1 ? 'Открыть браузер' : 'Дальше'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- chrome */

/** Slow drifting light in the accent colour, so the flow is never a flat wall. */
function Aurora({ accent }: { accent: string }) {
  const blobs = [
    { size: 620, top: '-16%', left: '-10%', dur: '26s', alpha: 38 },
    { size: 520, top: '38%', left: '62%', dur: '34s', alpha: 30 },
    { size: 440, top: '64%', left: '10%', dur: '30s', alpha: 24 }
  ]
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {blobs.map((blob, i) => (
        <span
          key={blob.left}
          className="absolute rounded-pill"
          style={{
            width: blob.size,
            height: blob.size,
            top: blob.top,
            left: blob.left,
            background: `radial-gradient(circle, color-mix(in srgb, ${accent} ${blob.alpha}%, transparent), transparent 70%)`,
            filter: 'blur(30px)',
            animation: `welcome-drift ${blob.dur} ease-in-out ${i * -6}s infinite`
          }}
        />
      ))}
    </div>
  )
}

function Title({ title, hint }: { title: string; hint: string }) {
  return (
    <header className="mb-6 text-center">
      <h1 className="text-[30px] font-semibold tracking-[-0.03em]">{title}</h1>
      <p className="mt-1.5 text-base text-dim">{hint}</p>
    </header>
  )
}

/** A big pickable card; most of the flow is built out of these. */
function Choice({
  active,
  onClick,
  icon,
  title,
  hint,
  children
}: {
  active: boolean
  onClick: () => void
  icon?: React.ReactNode
  title: string
  hint?: string
  children?: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="lift relative flex flex-col items-start gap-1.5 rounded-card border p-3.5 text-left"
      style={{
        background: active ? 'color-mix(in srgb, var(--accent) 12%, var(--surface))' : 'var(--surface)',
        borderColor: active ? 'var(--accent)' : 'var(--line)',
        boxShadow: active ? 'var(--shadow-md)' : 'var(--shadow-sm)',
        transition:
          'background var(--t-base) linear, border-color var(--t-base) linear, transform var(--t-fast) var(--ease-spring)'
      }}
    >
      {active && (
        <span
          className="animate-pop absolute right-2.5 top-2.5 flex h-4 w-4 items-center justify-center rounded-pill text-white"
          style={{ background: 'var(--accent)' }}
        >
          <Check width={10} height={10} />
        </span>
      )}
      {children ?? (
        <>
          <span className="text-dim">{icon}</span>
          <span className="text-base font-medium">{title}</span>
          {hint && <span className="text-sm text-faint">{hint}</span>}
        </>
      )}
    </button>
  )
}

/* ---------------------------------------------------------------- steps */

function Hello() {
  const badges = [
    { icon: <Shield width={13} height={13} />, text: 'Блокировщик рекламы и трекеров' },
    { icon: <Sparkles width={13} height={13} />, text: 'Живые обои и своя главная' },
    { icon: <Zap width={13} height={13} />, text: 'Профили с отдельными данными' }
  ]
  return (
    <div className="flex flex-col items-center text-center">
      <img
        src={logoUrl}
        alt=""
        className="animate-pop mb-5 h-[92px] w-[92px]"
        style={{ filter: 'drop-shadow(0 12px 28px rgba(0,0,0,0.22))' }}
      />
      <h1 className="text-[38px] font-semibold leading-tight tracking-[-0.035em]">
        Добро пожаловать в Nya Browser
      </h1>
      <p className="mt-3 max-w-[440px] text-base text-dim">
        Несколько шагов — и браузер будет выглядеть и вести себя так, как нужно вам. Всё, что
        выберете, можно поменять потом в настройках.
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
        {badges.map((item) => (
          <span
            key={item.text}
            className="flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-sm text-dim"
            style={{ background: 'var(--surface)' }}
          >
            {item.icon}
            {item.text}
          </span>
        ))}
      </div>
    </div>
  )
}

function ProfileStep({ profile }: { profile: Profile | null }) {
  const [name, setName] = useState(profile?.name ?? '')
  const [avatar, setAvatar] = useState(profile?.avatar ?? AVATARS[0])
  const [color, setColor] = useState(profile?.color ?? ACCENTS[0])
  const id = profile?.id
  const saved = useRef({ name, avatar, color })

  // Saved on a pause rather than on every keystroke: the name field would
  // otherwise write the file once per letter.
  useEffect(() => {
    if (!id) return
    const timer = setTimeout(() => {
      const next = { name: name.trim() || 'Профиль', avatar, color }
      if (JSON.stringify(next) === JSON.stringify(saved.current)) return
      saved.current = next
      void window.browser.updateProfile(id, next)
    }, 350)
    return () => clearTimeout(timer)
  }, [id, name, avatar, color])

  return (
    <div>
      <Title
        title="Как вас зовут?"
        hint="Имя и значок профиля видно только вам, на этом компьютере"
      />

      <div className="flex items-center gap-4 rounded-card p-4" style={{ background: 'var(--surface)' }}>
        <Avatar avatar={avatar} crop={profile?.crop} color={color} size={64} />
        <div className="flex-1">
          <TextField value={name} onChange={setName} placeholder="Имя профиля" width="100%" autoFocus />
          <p className="mt-1.5 text-sm text-faint">
            Позже сюда можно поставить свою картинку или анимацию.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <span className="text-sm text-dim">Значок</span>
        <div className="flex flex-wrap gap-1.5">
          {AVATARS.map((value) => (
            <button
              key={value}
              onClick={() => setAvatar(value)}
              className="flex h-10 w-10 items-center justify-center rounded-[12px] text-xl"
              style={{
                background:
                  avatar === value
                    ? 'color-mix(in srgb, var(--accent) 24%, transparent)'
                    : 'var(--field-idle)',
                transition: 'background var(--t-fast) linear'
              }}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <span className="text-sm text-dim">Цвет профиля</span>
        <div className="flex flex-wrap gap-2">
          {ACCENTS.map((value) => (
            <button
              key={value}
              onClick={() => setColor(value)}
              className="h-8 w-8 rounded-pill"
              style={{
                background: value,
                outline: color === value ? `2px solid ${value}` : 'none',
                outlineOffset: 3
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function LookStep({
  settings,
  onPatch
}: {
  settings: Settings
  onPatch: (patch: Partial<Settings>) => void
}) {
  const themes = [
    { value: 'light', title: 'Светлая', hint: 'Днём', swatch: '#F6F7FB' },
    { value: 'dark', title: 'Тёмная', hint: 'Вечером', swatch: '#15161B' },
    {
      value: 'system',
      title: 'Как в системе',
      hint: 'Переключается сама',
      swatch: 'linear-gradient(105deg, #F6F7FB 50%, #15161B 50%)'
    }
  ] as const

  return (
    <div>
      <Title title="Тема и цвет" hint="Меняется сразу — смотрите, как отзывается окно вокруг" />

      <div className="grid grid-cols-3 gap-2.5">
        {themes.map((item) => (
          <Choice
            key={item.value}
            active={settings.theme === item.value}
            onClick={() => onPatch({ theme: item.value })}
            title={item.title}
          >
            <span
              className="mb-2 block h-[52px] w-full overflow-hidden rounded-[10px] border"
              style={{ borderColor: 'var(--line)', background: item.swatch }}
            />
            <span className="text-base font-medium">{item.title}</span>
            <span className="text-sm text-faint">{item.hint}</span>
          </Choice>
        ))}
      </div>

      <div className="mt-5 flex flex-col gap-2">
        <span className="text-sm text-dim">Акцент</span>
        <div className="flex flex-wrap gap-2.5">
          {ACCENTS.map((color) => (
            <button
              key={color}
              onClick={() => onPatch({ accent: color })}
              className="h-9 w-9 rounded-pill"
              style={{
                background: color,
                outline: settings.accent === color ? `2px solid ${color}` : 'none',
                outlineOffset: 3
              }}
            />
          ))}
          <label
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-pill"
            style={{ background: 'var(--field-idle)' }}
            title="Свой цвет"
          >
            <Palette width={15} height={15} />
            <input
              type="color"
              className="h-0 w-0 opacity-0"
              value={settings.accent}
              onChange={(event) => onPatch({ accent: event.target.value })}
            />
          </label>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-4">
        <span className="text-sm text-dim">Скругление углов</span>
        <Slider
          value={settings.radius}
          min={0}
          max={28}
          onChange={(radius) => onPatch({ radius })}
          format={(value) => `${value}px`}
          width={260}
        />
      </div>
    </div>
  )
}

function GlassStep({
  settings,
  onPatch
}: {
  settings: Settings
  onPatch: (patch: Partial<Settings>) => void
}) {
  return (
    <div>
      <Title
        title="Насколько прозрачны панели"
        hint="Это про панели и карточки — обои под ними остаются как есть"
      />

      <div className="rounded-card p-5" style={{ background: 'var(--surface)' }}>
        <div className="mb-4 flex flex-col gap-2">
          {['Верхняя панель', 'Карточка на главной'].map((label, i) => (
            <div
              key={label}
              className="flex items-center rounded-[12px] border px-3.5"
              style={{
                height: i === 0 ? 40 : 58,
                background: 'var(--surface)',
                borderColor: 'var(--line)',
                backdropFilter: 'blur(20px) saturate(170%)'
              }}
            >
              <span className="text-sm text-dim">{label}</span>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-dim">
            {settings.glass >= 95 ? 'Сплошные' : settings.glass <= 30 ? 'Почти стекло' : 'Стекло'}
          </span>
          <Slider
            value={settings.glass}
            min={10}
            max={100}
            onChange={(glass) => onPatch({ glass })}
            format={(value) => `${value}%`}
            width={280}
          />
        </div>
      </div>
    </div>
  )
}

function WallpaperStep({
  settings,
  onPatch
}: {
  settings: Settings
  onPatch: (patch: Partial<Settings>) => void
}) {
  const bg = settings.background
  const kinds = [
    { value: 'aurora', title: 'Аврора', hint: 'Плывущие пятна', icon: <Sparkles width={14} height={14} /> },
    { value: 'mesh', title: 'Меш', hint: 'Градиентная сетка', icon: <Palette width={14} height={14} /> },
    { value: 'waves', title: 'Волны', hint: 'Мягкие переливы', icon: <Zap width={14} height={14} /> },
    { value: 'off', title: 'Без фона', hint: 'Ровный цвет', icon: <Cross width={14} height={14} /> }
  ] as const

  return (
    <div>
      <Title title="Обои" hint="Живой фон или своя картинка — видно прямо за этим окном" />

      <div className="grid grid-cols-4 gap-2.5">
        {kinds.map((item) => (
          <Choice
            key={item.value}
            active={bg.kind === item.value}
            onClick={() => onPatch({ background: { ...bg, kind: item.value } })}
            icon={item.icon}
            title={item.title}
            hint={item.hint}
          />
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2.5">
        {(
          [
            { kind: 'image', icon: <Image width={16} height={16} />, title: 'Своя картинка', hint: 'PNG, JPG, WebP, GIF' },
            { kind: 'video', icon: <Film width={16} height={16} />, title: 'Видео-обои', hint: 'MP4, WebM, MOV' }
          ] as const
        ).map((item) => (
          <Choice
            key={item.kind}
            active={bg.kind === item.kind}
            onClick={() => void window.browser.pickWallpaper()}
            title={item.title}
          >
            <span className="flex items-center gap-2.5">
              <span className="text-dim">{item.icon}</span>
              <span>
                <span className="block text-base font-medium">{item.title}</span>
                <span className="block text-sm text-faint">{item.hint}</span>
              </span>
            </span>
          </Choice>
        ))}
      </div>

      {bg.file && (
        <p className="mt-3 text-sm text-faint">
          Выбрано: {bg.file}. Затемнение и размытие настраиваются в «Настройки → Обои».
        </p>
      )}
    </div>
  )
}

function SearchStep({
  settings,
  engines,
  onPatch
}: {
  settings: Settings
  engines: SearchEngine[]
  onPatch: (patch: Partial<Settings>) => void
}) {
  const list = engines.filter((item) => item.id !== 'custom')
  return (
    <div>
      <Title title="Чем искать" hint="Поменять можно в любой момент в настройках" />
      {/* No max-height and no scroller here: with just the names the list fits,
          and a container that can scroll grows a scrollbar the moment a card
          lifts on hover. */}
      <div className="grid grid-cols-3 gap-2.5">
        {list.map((item) => (
          <Choice
            key={item.id}
            active={settings.searchEngine === item.id}
            onClick={() => onPatch({ searchEngine: item.id })}
            title={item.name}
          >
            <span className="truncate pr-5 text-base font-medium">{item.name}</span>
          </Choice>
        ))}
      </div>
    </div>
  )
}

function PrivacyStep({
  settings,
  onPatch
}: {
  settings: Settings
  onPatch: (patch: Partial<Settings>) => void
}) {
  const rows = [
    {
      key: 'blockAds' as const,
      title: 'Блокировать рекламу',
      hint: 'Меньше запросов — страницы открываются быстрее'
    },
    {
      key: 'blockTrackers' as const,
      title: 'Блокировать трекеры',
      hint: 'Счётчики и пиксели, которые следят за вами между сайтами'
    },
    {
      key: 'blockCrypto' as const,
      title: 'Блокировать майнеры',
      hint: 'Скрипты, которые считают чужую криптовалюту вашим процессором'
    },
    {
      key: 'historySuggestions' as const,
      title: 'Подсказки из истории',
      hint: 'В адресной строке. История хранится только у вас на диске'
    }
  ]

  return (
    <div>
      <Title title="Защита" hint="Включено по умолчанию — выключить можно в любой момент" />
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <label
            key={row.key}
            className="flex cursor-pointer items-center justify-between gap-4 rounded-card p-3.5"
            style={{ background: 'var(--surface)' }}
          >
            <span>
              <span className="block text-base font-medium">{row.title}</span>
              <span className="block text-sm text-faint">{row.hint}</span>
            </span>
            <Toggle checked={settings[row.key]} onChange={(value) => onPatch({ [row.key]: value })} />
          </label>
        ))}
      </div>
    </div>
  )
}

function Done({
  settings,
  engines,
  profile
}: {
  settings: Settings
  engines: SearchEngine[]
  profile: Profile | null
}) {
  const engine = engines.find((item) => item.id === settings.searchEngine)
  const theme =
    settings.theme === 'dark' ? 'Тёмная' : settings.theme === 'light' ? 'Светлая' : 'Как в системе'

  const summary = [
    { label: 'Профиль', value: profile?.name || 'Профиль' },
    { label: 'Тема', value: theme },
    { label: 'Прозрачность панелей', value: `${settings.glass}%` },
    { label: 'Поиск', value: engine?.name ?? '—' }
  ]

  return (
    <div className="text-center">
      <span
        className="animate-pop mx-auto mb-5 flex h-[76px] w-[76px] items-center justify-center rounded-pill text-white"
        style={{ background: 'var(--accent)', boxShadow: 'var(--shadow-lg)' }}
      >
        <Check width={36} height={36} />
      </span>
      <h1 className="text-[30px] font-semibold tracking-[-0.03em]">Всё готово</h1>
      <p className="mt-1.5 text-base text-dim">
        Настройки уже применены. Поменять их можно в любой момент — Ctrl+, откроет настройки.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-2.5 text-left">
        {summary.map((item) => (
          <div key={item.label} className="rounded-card p-3.5" style={{ background: 'var(--surface)' }}>
            <div className="text-2xs font-semibold uppercase tracking-wider text-faint">
              {item.label}
            </div>
            <div className="mt-0.5 truncate text-base font-medium">{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
