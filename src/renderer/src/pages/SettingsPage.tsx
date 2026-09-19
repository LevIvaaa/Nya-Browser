import { availableLanguages, currentLanguage, t } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import type {
  FilterRefresh,
  AppInfo,
  AvatarCrop,
  InstalledApp,
  DefaultBrowserState,
  FilterStatus,
  InstalledExtension,
  PermissionPolicy,
  PermissionSettings,
  Profile,
  ProfilesState,
  SearchEngine,
  SecurityStats,
  Settings,
  StartPageFont,
  TileShape,
  TileStyle,
  UpdateState,
  WidevineState
} from '../../../shared/types'
import { DEFAULT_LAYOUT } from '../../../shared/startPage'
import { LANGUAGES } from '../../../shared/i18n'
import type { ImportSource, VaultState } from '../../../preload/index'
import { RELEASES_PAGE } from '../../../shared/types'
import logoUrl from '../assets/logo.png'
import { Shortcuts } from '../components/Shortcuts'
import { Wellbeing } from '../components/Wellbeing'
import { Backup } from '../components/Backup'
import { Diagnostics } from '../components/Diagnostics'
import {
  Alert,
  Clock,
  Cross,
  Download,
  Eraser,
  Eye,
  Film,
  Gear,
  Globe,
  Grid,
  Image,
  Install,
  Key,
  Keyboard,
  LayoutHidden,
  LayoutLeft,
  LayoutRight,
  LayoutTop,
  Monitor,
  Moon,
  More,
  Palette,
  Plus,
  Refresh,
  Search,
  Shield,
  Sparkles,
  Sun,
  Trash,
  Users,
  Wallet,
  Zap
} from '../components/Icons'
import {
  Avatar,
  ChoiceCard,
  FullSettings,
  Looking,
  Modal,
  Pill,
  Row,
  Section,
  Segmented,
  Select,
  Slider,
  TextField,
  Toggle,
  avatarImageStyle,
  avatarUrl,
  cx,
  formatBytes
} from '../components/ui'
import { Arrangement, DensityDemo } from '../components/Arrangement'
import { ProtectionReportPanel } from '../components/Shield'
import { DEFAULT_SETTINGS, LOOK_KEYS } from '../../../shared/defaults'
import { MENU_ROWS, TOOLBAR_BUTTONS, TOOLBAR_REQUIRED } from '../../../shared/chrome'

interface Props {
  settings: Settings
  engines: SearchEngine[]
  stats: SecurityStats
  profiles: ProfilesState | null
  onPatch: (patch: Partial<Settings>) => void
  onReset: () => void
  onClose: () => void
  onOpenPasswords: () => void
  /** the section to open at, when something asked for one in particular */
  section?: string
}

const ACCENTS = ['#7C6CFF', '#0A84FF', '#00B8A9', '#2FBF71', '#F5A524', '#FF6B6B', '#E255A1', '#8E8E93']

const TABS = [
  { id: 'look', label: 'Внешний вид', icon: <Palette width={15} height={15} /> },
  { id: 'wallpaper', label: 'Обои', icon: <Image width={15} height={15} /> },
  { id: 'tabs', label: 'Вкладки', icon: <LayoutTop width={15} height={15} /> },
  { id: 'start', label: 'Главная', icon: <Sparkles width={15} height={15} /> },
  { id: 'search', label: 'Поиск', icon: <Search width={15} height={15} /> },
  { id: 'profiles', label: 'Профили', icon: <Users width={15} height={15} /> },
  { id: 'privacy', label: 'Приватность', icon: <Shield width={15} height={15} /> },
  { id: 'passwords', label: 'Пароли и карты', icon: <Wallet width={15} height={15} /> },
  { id: 'speed', label: 'Скорость', icon: <Zap width={15} height={15} /> },
  { id: 'downloads', label: 'Загрузки', icon: <Download width={15} height={15} /> },
  { id: 'time', label: 'Цифровое благополучие', icon: <Clock width={15} height={15} /> },
  { id: 'notify', label: 'Уведомления', icon: <Alert width={15} height={15} /> },
  { id: 'keys', label: 'Горячие клавиши', icon: <Keyboard width={15} height={15} /> },
  { id: 'system', label: 'Система', icon: <Monitor width={15} height={15} /> },
  { id: 'data', label: 'Данные', icon: <Eraser width={15} height={15} /> },
  { id: 'about', label: 'О браузере', icon: <Gear width={15} height={15} /> }
] as const

type TabId = (typeof TABS)[number]['id']

const PERMISSION_ROWS: Array<{ key: keyof PermissionSettings; title: string; hint: string }> = [
  { key: 'camera', title: 'Камера', hint: 'Видеозвонки и съёмка' },
  { key: 'microphone', title: 'Микрофон', hint: 'Голосовые звонки и запись' },
  { key: 'geolocation', title: 'Геопозиция', hint: 'Точное местоположение устройства' },
  { key: 'notifications', title: 'Уведомления', hint: 'Push-сообщения от сайтов' },
  { key: 'clipboard', title: 'Буфер обмена', hint: 'Чтение того, что вы скопировали' },
  { key: 'midi', title: 'MIDI-устройства', hint: 'Музыкальное оборудование' },
  { key: 'usb', title: 'USB, HID, Bluetooth', hint: 'Прямой доступ к оборудованию' },
  { key: 'fullscreen', title: 'Полный экран', hint: 'Развернуть страницу на весь экран' },
  { key: 'download', title: 'Внешние приложения', hint: 'Открытие ссылок в других программах' }
]

/** One line describing what DRM can and cannot do right now. */
function drmHint(state: (WidevineState & { needsRestart: boolean }) | null, wanted: boolean): string {
  if (!state) return t('Проверяем состояние…')
  if (!state.supported) return state.error || t('Эта сборка без поддержки Widevine')
  if (!wanted) {
    return t('Выключено. При включении Chromium один раз скачает модуль Widevine с серверов Google — это единственная причина, по которой пункт не включён сразу')
  }
  if (state.error) return t('Не удалось установить модуль: {e}', { e: state.error })
  if (state.ready) return t('Модуль Widevine {v} готов', { v: state.version })
  return t('Модуль скачивается — это около минуты. Если видео не пошло, обновите страницу')
}

/** One line describing where the updater has got to. */
function updateHint(state: UpdateState | null): string {
  if (!state) return t('Проверяем состояние…')
  // A package-managed build says nothing about being unsupported: it checks, it
  // just cannot install. The stages below say the rest.
  if (!state.supported && !state.manual) {
    return state.error || t('Обновляться умеет только установленная версия, не портативная')
  }
  switch (state.stage) {
    case 'checking':
      return t('Спрашиваем GitHub…')
    case 'available':
      return state.manual
        ? t('Доступна версия {v} — скачайте пакет и установите его', { v: state.available ?? '' })
        : t('Доступна версия {v} — загрузить?', { v: state.available ?? '' })
    case 'downloading':
      return t('Скачиваем {v} — {p}%', { v: state.available ?? '', p: state.percent })
    case 'ready':
      return t('Версия {v} загружена и установится при перезапуске', { v: state.available ?? '' })
    case 'current':
      return t('Установлена последняя версия')
    case 'error':
      return t('Не получилось: {e}', { e: state.error ?? '' })
    default:
      return t('Проверка выполняется автоматически раз в 6 часов')
  }
}

const POLICY_OPTIONS: Array<{ value: PermissionPolicy; label: string }> = [
  { value: 'ask', label: 'Спрашивать' },
  { value: 'allow', label: 'Разрешать' },
  { value: 'block', label: 'Запрещать' }
]

export default function SettingsPage({
  settings,
  engines,
  stats,
  profiles,
  onPatch,
  onReset,
  onClose,
  onOpenPasswords,
  section
}: Props) {
  const [tab, setTab] = useState<TabId>(
    () => (TABS.some((t) => t.id === section) ? (section as TabId) : 'look')
  )

  // Asking for the same section again while the page is open should still
  // move to it — the settings page is not remounted between requests.
  useEffect(() => {
    if (section && TABS.some((t) => t.id === section)) setTab(section as TabId)
  }, [section])
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [vault, setVault] = useState<VaultState | null>(null)
  // Asked once: whether this machine has a PIN or a biometric enrolled at all.
  const [helloAvailable, setHelloAvailable] = useState(false)
  const [notice, setNotice] = useState('')
  const [newDomain, setNewDomain] = useState('')
  const [newAllowed, setNewAllowed] = useState('')
  const [editProfile, setEditProfile] = useState<Profile | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [defaults, setDefaults] = useState<DefaultBrowserState | null>(null)
  const [sources, setSources] = useState<ImportSource[] | null>(null)
  const [filters, setFilters] = useState<FilterStatus | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  /** what the last refresh of the lists actually changed */
  const [refreshed, setRefreshed] = useState<FilterRefresh | null>(null)
  const [extensions, setExtensions] = useState<InstalledExtension[] | null>(null)
  /** What is being looked for, as typed and as compared. */
  const [query, setQuery] = useState('')
  const looking = query.trim().toLowerCase()
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [drm, setDrm] = useState<(WidevineState & { needsRestart: boolean }) | null>(null)
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([])
  /** the pictures this profile has, for the wallpaper rotation */
  const [pictures, setPictures] = useState<string[]>([])

  useEffect(() => {
    void window.browser.appInfo().then(setInfo)
    void window.browser.vaultState().then(setVault)
    void window.browser.vaultHelloAvailable().then(setHelloAvailable)
    void window.browser.updateState().then(setUpdate)
    // Download progress arrives on its own, so the panel must not have to poll.
    return window.browser.onUpdate(setUpdate)
  }, [])

  // Shell and disk lookups, so they are only paid for when the tab is opened.
  useEffect(() => {
    if (tab === 'system') {
      void window.browser.defaultBrowser().then(setDefaults)
      void window.browser.importSources().then(setSources)
      void window.browser.extensions().then(setExtensions)
      void window.browser.drmState().then(setDrm)
      void window.browser.installedApps().then(setInstalledApps)
    }
    if (tab === 'privacy') {
      void window.browser.filterStatus().then(setFilters)
      void window.browser.filterRefresh().then(setRefreshed)
    }
    if (tab === 'wallpaper') void window.browser.wallpapers().then(setPictures)
  }, [tab])

  /*
   * "You changed this", and the way back.
   *
   * Every row can say whether it still holds what the browser was installed
   * with, and offer to put that one setting back without touching the other
   * two hundred. Comparing as JSON is what makes it work for the settings that
   * are objects — the wallpaper, the start page — as well as the numbers.
   */
  const of = <K extends keyof Settings>(key: K) => ({
    changed: JSON.stringify(settings[key]) !== JSON.stringify(DEFAULT_SETTINGS[key]),
    onRevert: () => onPatch({ [key]: DEFAULT_SETTINGS[key] } as unknown as Partial<Settings>)
  })

  /** Everything on the appearance page, under a name, kept for later. */
  const saveLook = () => {
    const look: Partial<Settings> = {}
    for (const key of LOOK_KEYS) (look as Record<string, unknown>)[key] = settings[key]
    const id = String(Date.now())
    onPatch({
      looks: [...settings.looks, { id, name: t('Оформление {n}', { n: settings.looks.length + 1 }), look }]
    })
    flash(t('Оформление сохранено'))
  }

  const engine = engines.find((item) => item.id === settings.searchEngine) ?? engines[0]
  const bg = settings.background
  const flash = (message: string) => {
    setNotice(message)
    setTimeout(() => setNotice(''), 2600)
  }

  /**
   * Everything one tab holds. It is a function and not markup so that a
   * search can ask for all thirteen of them at once without the page being
   * written out thirteen times.
   */
  const body = (which: TabId) => (
    <>
          {/* ---------------------------------------------------------- look */}
          {which === 'look' && (
            <>
              <Section
                title={t('Язык браузера')}
                icon={<Globe width={15} height={15} />}
                description={t('Интерфейс, меню и язык, который сообщается сайтам')}
              >
                <Row
                  {...of('language')}
                  title={t('Язык')}
                  hint={t('Интерфейс переключается сразу; сайты и системные надписи — после перезапуска')}
                >
                  <Select
                    value={settings.language}
                    options={[
                      { value: '', label: t('Как в системе') },
                      ...LANGUAGES.filter((item) => availableLanguages().has(item.code)).map(
                        (item) => ({ value: item.code, label: item.name })
                      )
                    ]}
                    onChange={(value) => onPatch({ language: value })}
                  />
                </Row>
              </Section>

              <Section title={t('Тема')} icon={<Sun width={15} height={15} />} description={t('Как выглядит браузер')}>
                <Row title={t('Оформление')} {...of('theme')}>
                  <Segmented
                    value={settings.theme}
                    onChange={(value) => onPatch({ theme: value })}
                    options={[
                      { value: 'light', label: t('Светлая'), icon: <Sun width={13} height={13} /> },
                      { value: 'dark', label: t('Тёмная'), icon: <Moon width={13} height={13} /> },
                      { value: 'system', label: t('Система'), icon: <Monitor width={13} height={13} /> }
                    ]}
                  />
                </Row>
                <Row title={t('Акцентный цвет')} hint={t('Подсветка, активные элементы и процедурный фон')} {...of('accent')}>
                  <div className="flex items-center gap-1.5">
                    {ACCENTS.map((color) => (
                      <button
                        key={color}
                        onClick={() => onPatch({ accent: color })}
                        className="h-[22px] w-[22px] rounded-pill"
                        style={{
                          background: color,
                          outline: settings.accent === color ? `2px solid ${color}` : 'none',
                          outlineOffset: 2,
                          transition: 'transform var(--t-fast) var(--ease-spring)'
                        }}
                        onMouseOver={(event) => (event.currentTarget.style.transform = 'scale(1.15)')}
                        onMouseOut={(event) => (event.currentTarget.style.transform = '')}
                      />
                    ))}
                    <input
                      type="color"
                      value={settings.accent}
                      onChange={(event) => onPatch({ accent: event.target.value })}
                      className="ml-1 h-[24px] w-[30px] cursor-pointer rounded-[7px] border-0 bg-transparent p-0"
                      title={t('Свой цвет')}
                    />
                  </div>
                </Row>
                <Row title={t('Скругление углов')} hint={t('Вкладки, панели и окно страницы')} {...of('radius')} advanced>
                  <Slider value={settings.radius} min={0} max={24} onChange={(value) => onPatch({ radius: value })} format={(v) => `${v}px`} />
                </Row>
                <Row title={t('Компактный режим')} hint={t('Меньше высота панелей и вкладок')} {...of('compact')}>
                  <Toggle checked={settings.compact} onChange={(value) => onPatch({ compact: value })} />
                </Row>
                <Row title={t('Эффект стекла')} hint={t('Насколько плотные панели, вкладки и карточки — обои под ними остаются как есть')} {...of('glass')} advanced>
                  <Slider
                    value={settings.glass}
                    min={0}
                    max={100}
                    step={5}
                    format={(v) => `${v}%`}
                    onChange={(value) => onPatch({ glass: value })}
                  />
                </Row>
              </Section>

              {/* How big and how tight, which between them decide how much
                  browser is on the screen and how much page. */}
              <Section
                title={t('Размер и плотность')}
                icon={<Grid width={15} height={15} />}
                description={t('Насколько крупно нарисован сам браузер')}
              >
                <Row
                  title={t('Масштаб интерфейса')}
                  hint={t('Панели, вкладки и меню — страница масштабируется отдельно')}
                  {...of('uiScale')}
                >
                  <Slider
                    value={settings.uiScale}
                    min={0.8}
                    max={1.4}
                    step={0.05}
                    format={(v) => `${Math.round(v * 100)}%`}
                    onChange={(value) => onPatch({ uiScale: value })}
                  />
                </Row>
                <Row
                  title={t('Плотность')}
                  hint={t('Свободнее — выше панели и больше воздуха; плотнее — больше страницы')}
                  {...of('density')}
                  demo={<DensityDemo value={settings.density} />}
                >
                  <Segmented
                    value={String(settings.density)}
                    onChange={(value) => onPatch({ density: Number(value), compact: false })}
                    options={[
                      { value: '0', label: t('Свободно') },
                      { value: '1', label: t('Обычно') },
                      { value: '2', label: t('Плотно') }
                    ]}
                  />
                </Row>
                <Row
                  title={t('Шрифт интерфейса')}
                  hint={t('Любой шрифт, установленный в системе; пусто — как в системе')}
                  {...of('uiFont')} advanced
                  
                >
                  <TextField
                    value={settings.uiFont}
                    onChange={(value) => onPatch({ uiFont: value })}
                    placeholder={t('Как в системе')}
                    width={200}
                  />
                </Row>
              </Section>

              {/* Light by day and dark by night, decided by the clock rather
                  than by whatever the operating system thinks. */}
              <Section
                title={t('Тема по времени суток')}
                icon={<Clock width={15} height={15} />}
                description={t('Светлая днём, тёмная вечером')}
              >
                <Row title={t('Переключать по часам')} {...of('themeSchedule')}>
                  <Toggle
                    checked={settings.themeSchedule.on}
                    onChange={(on) => onPatch({ themeSchedule: { ...settings.themeSchedule, on } })}
                  />
                </Row>
                {settings.themeSchedule.on && (
                  <>
                    <Row title={t('Светлая с')} {...of('themeSchedule')}>
                      <TextField
                        value={settings.themeSchedule.light}
                        onChange={(light) => onPatch({ themeSchedule: { ...settings.themeSchedule, light } })}
                        placeholder="07:00"
                        width={92}
                        mono
                      />
                    </Row>
                    <Row title={t('Тёмная с')} {...of('themeSchedule')}>
                      <TextField
                        value={settings.themeSchedule.dark}
                        onChange={(dark) => onPatch({ themeSchedule: { ...settings.themeSchedule, dark } })}
                        placeholder="20:00"
                        width={92}
                        mono
                      />
                    </Row>
                  </>
                )}
              </Section>

              {/* Contrast is not a style: for somebody who needs it, it is
                  whether the browser can be used at all. */}
              <Section
                title={t('Доступность')}
                icon={<Eye width={15} height={15} />}
                description={t('Когда важнее разглядеть, чем красиво')}
              >
                <Row
                  title={t('Высокий контраст')}
                  hint={t('Полная яркость текста, границы у всего, что нажимается, без прозрачности')}
                  {...of('highContrast')}
                >
                  <Toggle checked={settings.highContrast} onChange={(v) => onPatch({ highContrast: v })} />
                </Row>
                <Row
                  title={t('Цвет окна по профилю')}
                  hint={t('Окно носит цвет своего профиля — два окна рядом видно сразу')}
                  {...of('accentFromProfile')} advanced
                >
                  <Toggle checked={settings.accentFromProfile} onChange={(v) => onPatch({ accentFromProfile: v })} />
                </Row>
                <Row
                  title={t('Отдача на действия')}
                  hint={t('Нажатая кнопка коротко отвечает, что нажатие дошло')}
                  {...of('feedback')} advanced
                >
                  <Toggle checked={settings.feedback} onChange={(v) => onPatch({ feedback: v })} />
                </Row>
                <Row
                  title={t('Горячие клавиши в подсказках')}
                  hint={t('Каждая подсказка называет клавиши, которые делают то же самое')}
                  {...of('shortcutsInTips')} advanced
                >
                  <Toggle checked={settings.shortcutsInTips} onChange={(v) => onPatch({ shortcutsInTips: v })} />
                </Row>
              </Section>

              {/* A whole appearance, saved and put on again in one press. */}
              <Section
                title={t('Профили оформления')}
                icon={<Palette width={15} height={15} />}
                description={t('Весь внешний вид целиком — сохранить и вернуть одним нажатием')}
                action={
                  <button className="btn" onClick={saveLook}>
                    <Plus width={15} height={15} />
                    {t('Сохранить нынешнее')}
                  </button>
                }
              >
                {settings.looks.length === 0 && (
                  <div className="px-4 py-3 text-sm text-faint">
                    {t('Настройте вид и сохраните — потом можно будет вернуться к нему одним нажатием')}
                  </div>
                )}
                {settings.looks.map((one) => (
                  <Row key={one.id} title={one.name} {...of('looks')}>
                    <div className="flex items-center gap-1.5">
                      <button className="btn" onClick={() => onPatch(one.look)}>
                        {t('Применить')}
                      </button>
                      <button
                        className="icon-btn"
                        aria-label={t('Удалить')}
                        onClick={() => onPatch({ looks: settings.looks.filter((row) => row.id !== one.id) })}
                      >
                        <Cross width={14} height={14} />
                      </button>
                    </div>
                  </Row>
                ))}
                <Row
                  title={t('Файл оформления')}
                  hint={t('Только внешний вид — ни истории, ни паролей, ни адресов')}
                >
                  <div className="flex items-center gap-1.5">
                    <button
                      className="btn"
                      onClick={async () => {
                        const look: Record<string, unknown> = {}
                        for (const key of LOOK_KEYS) look[key] = settings[key]
                        const saved = await window.browser.saveText(
                          'nya-look.json',
                          JSON.stringify({ nyaLook: 1, look }, null, 2)
                        )
                        if (saved) flash(t('Оформление выгружено'))
                      }}
                    >
                      <Download width={15} height={15} />
                      {t('Выгрузить')}
                    </button>
                    <button
                      className="btn"
                      onClick={async () => {
                        const text = await window.browser.openText()
                        if (!text) return
                        try {
                          const parsed = JSON.parse(text) as { nyaLook?: number; look?: Record<string, unknown> }
                          if (!parsed.look) throw new Error('not a look')
                          const look: Record<string, unknown> = {}
                          for (const key of LOOK_KEYS) {
                            if (key in parsed.look) look[key] = parsed.look[key]
                          }
                          onPatch(look as Partial<Settings>)
                          flash(t('Оформление загружено'))
                        } catch {
                          flash(t('Это не файл оформления'))
                        }
                      }}
                    >
                      <Install width={15} height={15} />
                      {t('Загрузить')}
                    </button>
                  </div>
                </Row>
              </Section>

              {/* The toolbar, arranged by the person who looks at it. */}
              <Section
                title={t('Панель инструментов')}
                icon={<LayoutTop width={15} height={15} />}
                description={t('Что стоит на панели и в каком порядке')}
                action={
                  <button className="btn" onClick={() => onPatch({ toolbar: DEFAULT_SETTINGS.toolbar })}>
                    <Refresh width={15} height={15} />
                    {t('Как было')}
                  </button>
                }
              >
                <Arrangement
                  chosen={settings.toolbar}
                  all={TOOLBAR_BUTTONS.map((one) => ({ id: one.id, name: t(one.name) }))}
                  required={TOOLBAR_REQUIRED}
                  repeatable={['space']}
                  onChange={(toolbar) => onPatch({ toolbar })}
                />
              </Section>

              <Section
                title={t('Порядок меню')}
                icon={<More width={15} height={15} />}
                description={t('Строки главного меню, в вашем порядке')}
                action={
                  <button className="btn" onClick={() => onPatch({ menuOrder: DEFAULT_SETTINGS.menuOrder })}>
                    <Refresh width={15} height={15} />
                    {t('Как было')}
                  </button>
                }
              >
                <Arrangement
                  chosen={settings.menuOrder}
                  all={MENU_ROWS.map((one) => ({ id: one.id, name: t(one.name) }))}
                  required={[]}
                  repeatable={[]}
                  onChange={(menuOrder) => onPatch({ menuOrder })}
                />
              </Section>

              <Section title={t('Движение')} icon={<Sparkles width={15} height={15} />} description={t('Скорость и плавность анимаций')}>
                <Row title={t('Скорость анимаций')} hint={t('1× — как задумано, меньше — быстрее и резче')} {...of('animationSpeed')} advanced>
                  <Slider
                    value={settings.animationSpeed}
                    min={0.4}
                    max={2}
                    step={0.1}
                    onChange={(value) => onPatch({ animationSpeed: value })}
                    format={(v) => `${v.toFixed(1)}×`}
                  />
                </Row>
                <Row title={t('Меньше движения')} hint={t('Полностью отключает анимации интерфейса')} {...of('reduceMotion')}>
                  <Toggle checked={settings.reduceMotion} onChange={(value) => onPatch({ reduceMotion: value })} />
                </Row>
              </Section>
            </>
          )}

          {/* ----------------------------------------------------- wallpaper */}
          {which === 'wallpaper' && (
            <>
              <Section title={t('Тип фона')} icon={<Image width={15} height={15} />} description={t('Живая анимация или ваши обои')}>
                <div className="grid grid-cols-3 gap-2 p-3">
                  <ChoiceCard value="off" current={bg.kind} onSelect={(kind) => onPatch({ background: { ...bg, kind } })} icon={<Cross width={14} height={14} />} title={t('Выкл')} hint={t('Ровный фон')} />
                  <ChoiceCard value="aurora" current={bg.kind} onSelect={(kind) => onPatch({ background: { ...bg, kind } })} icon={<Sparkles width={14} height={14} />} title={t('Аврора')} hint={t('Плывущие пятна')} />
                  <ChoiceCard value="mesh" current={bg.kind} onSelect={(kind) => onPatch({ background: { ...bg, kind } })} icon={<Palette width={14} height={14} />} title={t('Меш')} hint={t('Градиентная сетка')} />
                  <ChoiceCard value="waves" current={bg.kind} onSelect={(kind) => onPatch({ background: { ...bg, kind } })} icon={<Zap width={14} height={14} />} title={t('Волны')} hint={t('Мягкие переливы')} />
                  <ChoiceCard value="image" current={bg.kind} onSelect={(kind) => onPatch({ background: { ...bg, kind } })} icon={<Image width={14} height={14} />} title={t('Картинка')} hint="PNG, JPG, WebP, GIF" />
                  <ChoiceCard value="video" current={bg.kind} onSelect={(kind) => onPatch({ background: { ...bg, kind } })} icon={<Film width={14} height={14} />} title={t('Видео')} hint="MP4, WebM, MOV" />
                </div>

                {(bg.kind === 'image' || bg.kind === 'video') && (
                  <>
                    <Row title={t('Файл обоев')} hint={bg.file || t('Файл ещё не выбран')} {...of('background')}>
                      <div className="flex gap-2">
                        {bg.file && (
                          <button className="btn" onClick={() => onPatch({ background: { ...bg, file: '' } })}>
                            {t('Убрать')}
                          </button>
                        )}
                        <button
                          className="btn btn-primary"
                          onClick={async () => {
                            const file = await window.browser.pickWallpaper()
                            if (file) flash(t('Обои обновлены'))
                          }}
                        >
                          {t('Выбрать файл')}
                        </button>
                      </div>
                    </Row>
                    <Row title={t('Заполнение')} {...of('background')}>
                      <Segmented
                        value={bg.fit}
                        onChange={(fit) => onPatch({ background: { ...bg, fit } })}
                        options={[
                          { value: 'cover', label: t('Заполнить') },
                          { value: 'contain', label: t('Вписать') },
                          { value: 'center', label: t('По центру') },
                          { value: 'tile', label: t('Плитка') }
                        ]}
                        size="sm"
                      />
                    </Row>
                    <Row title={t('Размытие')} hint={t('Чтобы текст поверх обоев читался лучше')} {...of('background')}>
                      <Slider value={bg.blur} min={0} max={40} onChange={(blur) => onPatch({ background: { ...bg, blur } })} format={(v) => `${v}px`} />
                    </Row>
                    <Row title={t('Затемнение')} {...of('background')}>
                      <Slider value={bg.dim} min={0} max={85} onChange={(dim) => onPatch({ background: { ...bg, dim } })} format={(v) => `${v}%`} />
                    </Row>
                  </>
                )}

                {/* Pictures that change themselves. One wallpaper for a year
                    is a wallpaper nobody sees any more. */}
                {bg.kind === 'image' && (
                  <>
                    <Row
                      title={t('Менять обои по расписанию')}
                      hint={t('Выберите несколько картинок — браузер будет ставить их по очереди')}
                      {...of('background')}
                    >
                      <Toggle
                        checked={bg.rotate.on}
                        onChange={(on) => onPatch({ background: { ...bg, rotate: { ...bg.rotate, on } } })}
                      />
                    </Row>
                    {bg.rotate.on && (
                      <>
                        <Row title={t('Как часто')}>
                          <Select
                            value={String(bg.rotate.everyMinutes)}
                            options={[
                              { value: '15', label: t('Каждые 15 минут') },
                              { value: '60', label: t('Каждый час') },
                              { value: '360', label: t('Каждые 6 часов') },
                              { value: '1440', label: t('Раз в день') },
                              { value: '10080', label: t('Раз в неделю') }
                            ]}
                            onChange={(value) =>
                              onPatch({ background: { ...bg, rotate: { ...bg.rotate, everyMinutes: Number(value) } } })
                            }
                          />
                        </Row>
                        <Row title={t('В случайном порядке')}>
                          <Toggle
                            checked={bg.rotate.shuffle}
                            onChange={(shuffle) =>
                              onPatch({ background: { ...bg, rotate: { ...bg.rotate, shuffle } } })
                            }
                          />
                        </Row>
                        <Row
                          title={t('Какие картинки')}
                          hint={t('Выбрано: {n}', { n: bg.rotate.files.length })}
                        >
                          <button className="btn" onClick={() => void window.browser.wallpapers().then(setPictures)}>
                            <Refresh width={15} height={15} />
                            {t('Обновить список')}
                          </button>
                        </Row>
                        {pictures.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 px-4 pb-3">
                            {pictures.map((name) => {
                              const on = bg.rotate.files.includes(name)
                              return (
                                <button
                                  key={name}
                                  className="h-[26px] max-w-[220px] truncate rounded-pill px-3 text-2xs font-medium"
                                  style={{
                                    background: on ? 'var(--accent)' : 'var(--field-idle)',
                                    color: on ? '#fff' : 'var(--text-dim)'
                                  }}
                                  onClick={() =>
                                    onPatch({
                                      background: {
                                        ...bg,
                                        rotate: {
                                          ...bg.rotate,
                                          files: on
                                            ? bg.rotate.files.filter((one) => one !== name)
                                            : [...bg.rotate.files, name]
                                        }
                                      }
                                    })
                                  }
                                >
                                  {name}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}

                {bg.kind === 'video' && (
                  <>
                    <Row title={t('Скорость видео')} {...of('background')}>
                      <Slider value={bg.speed} min={0.25} max={2} step={0.05} onChange={(speed) => onPatch({ background: { ...bg, speed } })} format={(v) => `${v.toFixed(2)}×`} />
                    </Row>
                    <Row title={t('Без звука')} hint={t('Видеообои почти всегда лучше без звука')} {...of('background')}>
                      <Toggle checked={bg.muted} onChange={(muted) => onPatch({ background: { ...bg, muted } })} />
                    </Row>
                    <Row title={t('Пауза при просмотре сайта')} hint={t('Экономит заряд и процессор, пока обои не видно')} {...of('background')}>
                      <Toggle checked={bg.pauseWhenBrowsing} onChange={(pauseWhenBrowsing) => onPatch({ background: { ...bg, pauseWhenBrowsing } })} />
                    </Row>
                  </>
                )}

                {['aurora', 'mesh', 'waves'].includes(bg.kind) && (
                  <Row title={t('Интенсивность')} {...of('background')}>
                    <Segmented
                      value={bg.intensity}
                      onChange={(intensity) => onPatch({ background: { ...bg, intensity } })}
                      options={[
                        { value: 'subtle', label: t('Тихо') },
                        { value: 'medium', label: t('Средне') },
                        { value: 'vivid', label: t('Ярко') }
                      ]}
                    />
                  </Row>
                )}
              </Section>
            </>
          )}

          {/* ---------------------------------------------------------- tabs */}
          {which === 'tabs' && (
            <>
              <Section title={t('Расположение')} icon={<LayoutTop width={15} height={15} />} description={t('Сверху или вертикально сбоку')}>
                <div className="flex gap-2 p-3">
                  <ChoiceCard value="top" current={settings.tabPosition} onSelect={(value) => onPatch({ tabPosition: value })} icon={<LayoutTop width={15} height={15} />} title={t('Сверху')} hint={t('Классическая полоса')} />
                  <ChoiceCard value="left" current={settings.tabPosition} onSelect={(value) => onPatch({ tabPosition: value })} icon={<LayoutLeft width={15} height={15} />} title={t('Слева')} hint={t('Вертикальный список')} />
                  <ChoiceCard value="right" current={settings.tabPosition} onSelect={(value) => onPatch({ tabPosition: value })} icon={<LayoutRight width={15} height={15} />} title={t('Справа')} hint={t('У правого края')} />
                </div>
                {settings.tabPosition !== 'top' ? (
                  <Row title={t('Ширина панели')} {...of('railWidth')} advanced>
                    <Slider value={settings.railWidth} min={168} max={420} step={4} onChange={(value) => onPatch({ railWidth: value })} format={(v) => `${v}px`} />
                  </Row>
                ) : (
                  <Row title={t('Максимальная ширина вкладки')} {...of('tabMaxWidth')} advanced>
                    <Slider value={settings.tabMaxWidth} min={120} max={420} step={10} onChange={(value) => onPatch({ tabMaxWidth: value })} format={(v) => `${v}px`} />
                  </Row>
                )}
                <Row title={t('Кнопка закрытия')} {...of('closeButton')} advanced>
                  <Segmented
                    value={settings.closeButton}
                    onChange={(value) => onPatch({ closeButton: value })}
                    options={[
                      { value: 'always', label: t('Всегда') },
                      { value: 'hover', label: t('При наведении') },
                      { value: 'active', label: t('Только активная') }
                    ]}
                    size="sm"
                  />
                </Row>
              </Section>

              <Section title={t('Поведение')} icon={<LayoutHidden width={15} height={15} />}>
                <Row
                  title={t('Что в новой вкладке')}
                  hint={t('Стартовая страница, ваша домашняя или пустая')}
                  {...of('newTabShows')}
                >
                  <Segmented
                    value={settings.newTabShows}
                    onChange={(value) => onPatch({ newTabShows: value })}
                    options={[
                      { value: 'start', label: t('Стартовая') },
                      { value: 'home', label: t('Домашняя') },
                      { value: 'blank', label: t('Пустая') }
                    ]}
                  />
                </Row>
                <Row
                  title={t('Средняя кнопка по ссылке')}
                  hint={t('Открывать вкладку сзади или сразу переходить в неё')}
                  {...of('middleClick')} advanced
                >
                  <Segmented
                    value={settings.middleClick}
                    onChange={(value) => onPatch({ middleClick: value })}
                    options={[
                      { value: 'background', label: t('Сзади') },
                      { value: 'foreground', label: t('Сразу') }
                    ]}
                  />
                </Row>
                <Row
                  title={t('Масштаб щипком')}
                  hint={t('Два пальца на тачпаде или щипок на сенсорном экране увеличивают страницу')}
                  {...of('pinchZoom')} advanced
                >
                  <Toggle checked={settings.pinchZoom} onChange={(v) => onPatch({ pinchZoom: v })} />
                </Row>
                <Row
                  title={t('Клавиатурная навигация по ссылкам')}
                  hint={t('Нажмите клавишу — у каждой ссылки появится буква; наберите её, и ссылка откроется')}
                  {...of('linkHints')}
                >
                  <Toggle checked={settings.linkHints} onChange={(v) => onPatch({ linkHints: v })} />
                </Row>
                {settings.linkHints && (
                  <Row title={t('Клавиша подсказок')} hint={t('Одна латинская буква')} {...of('linkHintsKey')} advanced >
                    <TextField
                      value={settings.linkHintsKey}
                      onChange={(value) => onPatch({ linkHintsKey: value.slice(-1).toLowerCase() })}
                      width={64}
                      mono
                    />
                  </Row>
                )}
                <Row title={t('Автоскрытие интерфейса')} hint={t('Остаётся только страница; вернуть — курсор к краю или Ctrl+Shift+B')} {...of('tabAutoHide')}>
                  <Toggle checked={settings.tabAutoHide} onChange={(value) => onPatch({ tabAutoHide: value })} />
                </Row>
                <Row title={t('Новая вкладка рядом с текущей')} {...of('newTabAfterCurrent')} advanced>
                  <Toggle checked={settings.newTabAfterCurrent} onChange={(value) => onPatch({ newTabAfterCurrent: value })} />
                </Row>
                <Row title={t('Закрывать средней кнопкой мыши')} {...of('middleClickClose')} advanced>
                  <Toggle checked={settings.middleClickClose} onChange={(value) => onPatch({ middleClickClose: value })} />
                </Row>
                <Row title={t('Подтверждать закрытие нескольких вкладок')} {...of('confirmCloseMultiple')} advanced>
                  <Toggle checked={settings.confirmCloseMultiple} onChange={(value) => onPatch({ confirmCloseMultiple: value })} />
                </Row>
                <Row
                  {...of('tabPreview')} advanced
                  title={t('Показывать вкладку при наведении')}
                  hint={t('Картинка страницы, если задержать курсор')}
                >
                  <Toggle checked={settings.tabPreview} onChange={(value) => onPatch({ tabPreview: value })} />
                </Row>
                <Row
                  title={t('Куда переходить после закрытия')}
                  hint={t('По умолчанию — к вкладке, из которой эта была открыта')}
                >
                  <Select
                    value={settings.afterClose}
                    onChange={(afterClose) => onPatch({ afterClose })}
                    options={[
                      { value: 'opener', label: t('К родительской') },
                      { value: 'right', label: t('К правой') },
                      { value: 'left', label: t('К левой') },
                      { value: 'recent', label: t('К последней открытой') }
                    ]}
                  />
                </Row>
                <Row
                  title={t('Жесты мышью')}
                  hint={t('Правая кнопка и движение по странице')}
                >
                  <Toggle
                    checked={settings.mouseGestures}
                    onChange={(mouseGestures) => onPatch({ mouseGestures })}
                  />
                </Row>
                <Row title={t('Окно поверх всех')} {...of('alwaysOnTop')} advanced>
                  <Toggle
                    checked={settings.alwaysOnTop}
                    onChange={(on) => {
                      onPatch({ alwaysOnTop: on })
                      void window.browser.alwaysOnTop(on)
                    }}
                  />
                </Row>
              </Section>
            </>
          )}

          {/* --------------------------------------------------------- start */}
          {which === 'start' && (
            <Section title={t('Главная страница')} icon={<Sparkles width={15} height={15} />} description={t('Что показывать на стартовом экране')}>
              <Row title={t('Приветствие')}><Toggle checked={settings.startPage.greeting} onChange={(v) => onPatch({ startPage: { ...settings.startPage, greeting: v } })} /></Row>
              <Row title={t('Часы')}><Toggle checked={settings.startPage.clock} onChange={(v) => onPatch({ startPage: { ...settings.startPage, clock: v } })} /></Row>
              <Row title={t('Плитки избранного')}><Toggle checked={settings.startPage.favorites} onChange={(v) => onPatch({ startPage: { ...settings.startPage, favorites: v } })} /></Row>
              <Row title={t('Колонок в избранном')} {...of('startPage')}>
                <Slider value={settings.startPage.columns} min={4} max={12} onChange={(v) => onPatch({ startPage: { ...settings.startPage, columns: v } })} width={120} />
              </Row>
              <Row title={t('Недавние страницы')}><Toggle checked={settings.startPage.recent} onChange={(v) => onPatch({ startPage: { ...settings.startPage, recent: v } })} /></Row>
              <Row title={t('Недавно закрытые вкладки')}><Toggle checked={settings.startPage.closed} onChange={(v) => onPatch({ startPage: { ...settings.startPage, closed: v } })} /></Row>
              <Row title={t('Счётчик защиты')}><Toggle checked={settings.startPage.stats} onChange={(v) => onPatch({ startPage: { ...settings.startPage, stats: v } })} /></Row>
              <Row title={t('Погода')} hint={t('Город выбирается в самом виджете; без него никуда ничего не уходит')} {...of('startPage')}>
                <Toggle checked={settings.startPage.weather} onChange={(v) => onPatch({ startPage: { ...settings.startPage, weather: v } })} />
              </Row>
              {/* The eight that came later. Every one is off until somebody
                  asks for it, and two of them say plainly what they cost. */}
              <Row title={t('Последние загрузки')} hint={t('Пять последних файлов, каждый — нажатие до папки')}>
                <Toggle checked={settings.startPage.downloads} onChange={(v) => onPatch({ startPage: { ...settings.startPage, downloads: v } })} />
              </Row>
              <Row title={t('Календарь')} hint={t('Этот месяц с отмеченным сегодня — ни с чем не связан и никуда не ходит')}>
                <Toggle checked={settings.startPage.calendar} onChange={(v) => onPatch({ startPage: { ...settings.startPage, calendar: v } })} />
              </Row>
              <Row title={t('Стикеры')} hint={t('Заметки лежат в папке этого профиля и никуда не отправляются')}>
                <Toggle checked={settings.startPage.notes} onChange={(v) => onPatch({ startPage: { ...settings.startPage, notes: v } })} />
              </Row>
              <Row title={t('Список дел')}>
                <Toggle checked={settings.startPage.todo} onChange={(v) => onPatch({ startPage: { ...settings.startPage, todo: v } })} />
              </Row>
              <Row title={t('График заблокированного')} hint={t('Две недели по дням — видно, становится ли тише')}>
                <Toggle checked={settings.startPage.chart} onChange={(v) => onPatch({ startPage: { ...settings.startPage, chart: v } })} />
              </Row>
              <Row title={t('Частое в это время')} hint={t('Что вы обычно открываете примерно сейчас; хранятся только домены и часы')}>
                <Toggle checked={settings.startPage.habits} onChange={(v) => onPatch({ startPage: { ...settings.startPage, habits: v } })} />
              </Row>
              <Row title={t('Сейчас играет')}>
                <Toggle checked={settings.startPage.playing} onChange={(v) => onPatch({ startPage: { ...settings.startPage, playing: v } })} />
              </Row>
              <Row
                title={t('Курс валют')}
                hint={t('Единственное, кроме погоды, что ходит в сеть: три кода валют, без ключа и учётной записи')}
              >
                <Toggle checked={settings.startPage.rates} onChange={(v) => onPatch({ startPage: { ...settings.startPage, rates: v } })} />
              </Row>
              {settings.startPage.rates && (
                <Row title={t('Какие валюты')} hint={t('Из чего и во что — трёхбуквенными кодами')}>
                  <div className="flex items-center gap-2">
                    <TextField
                      value={settings.startPage.ratesBase}
                      onChange={(v) => onPatch({ startPage: { ...settings.startPage, ratesBase: v.toUpperCase().slice(0, 3) } })}
                      width={64}
                      mono
                    />
                    <span className="text-sm text-faint">→</span>
                    <TextField
                      value={settings.startPage.ratesTo.join(' ')}
                      onChange={(v) =>
                        onPatch({
                          startPage: {
                            ...settings.startPage,
                            ratesTo: v.toUpperCase().split(/[s,]+/).filter(Boolean).slice(0, 6)
                          }
                        })
                      }
                      placeholder="EUR RUB"
                      width={160}
                      mono
                    />
                  </div>
                </Row>
              )}

              <Row title={t('Шрифт главной')} {...of('startPage')}>
                <Select
                  value={settings.startPage.font}
                  options={[
                    { value: 'system', label: t('Системный') },
                    { value: 'rounded', label: t('Округлый') },
                    { value: 'serif', label: t('С засечками') },
                    { value: 'mono', label: t('Моноширинный') }
                  ]}
                  onChange={(v) => onPatch({ startPage: { ...settings.startPage, font: v as StartPageFont } })}
                />
              </Row>
              <Row title={t('Вид плиток')} {...of('startPage')}>
                <Segmented
                  value={settings.startPage.tiles}
                  options={[
                    { value: 'card', label: t('Карточки') },
                    { value: 'icon', label: t('Значки') }
                  ]}
                  onChange={(v) => onPatch({ startPage: { ...settings.startPage, tiles: v as TileStyle } })}
                />
              </Row>
              <Row title={t('Форма плиток и карточек')} {...of('startPage')}>
                <Select
                  value={settings.startPage.shape}
                  options={[
                    { value: 'rounded', label: t('Скруглённые') },
                    { value: 'soft', label: t('Мягкие') },
                    { value: 'circle', label: t('Круглые') },
                    { value: 'square', label: t('Прямые') }
                  ]}
                  onChange={(v) => onPatch({ startPage: { ...settings.startPage, shape: v as TileShape } })}
                />
              </Row>
              <Row title={t('Подписи под значками')} hint={t('Выключите, чтобы на плитке остался только логотип сайта')} {...of('startPage')}>
                <Toggle
                  checked={settings.startPage.tileLabels}
                  onChange={(v) => onPatch({ startPage: { ...settings.startPage, tileLabels: v } })}
                />
              </Row>
              <Row title={t('Цвет текста')} hint={settings.startPage.ink || t('По теме — тёмный на светлой, светлый на тёмной')} {...of('startPage')}>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    className="h-8 w-10 cursor-pointer rounded-[9px] border-0 bg-transparent p-0"
                    value={settings.startPage.ink || '#ffffff'}
                    onChange={(event) =>
                      onPatch({ startPage: { ...settings.startPage, ink: event.target.value } })
                    }
                  />
                  {settings.startPage.ink && (
                    <button
                      className="btn"
                      onClick={() => onPatch({ startPage: { ...settings.startPage, ink: '' } })}
                    >
                      {t('По теме')}
                    </button>
                  )}
                </div>
              </Row>
              <Row title={t('Расположение виджетов')} hint={t('Двигать и менять размер можно прямо на главной — кнопка «Настроить» в углу')} {...of('startPage')}>
                <button
                  className="btn"
                  onClick={() => onPatch({ startPage: { ...settings.startPage, layout: { ...DEFAULT_LAYOUT } } })}
                >
                  {t('Сбросить')}
                </button>
              </Row>
            </Section>
          )}

          {/* -------------------------------------------------------- search */}
          {which === 'search' && (
            <>
              <Section title={t('Поисковая система')} icon={<Search width={15} height={15} />} description={t('Используется для запросов из адресной строки')}>
                {engines.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onPatch({ searchEngine: item.id })}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--surface-hover)]"
                    style={{ borderTop: '1px solid var(--line)', transition: 'background var(--t-fast) linear' }}
                  >
                    <span
                      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] text-sm font-semibold"
                      style={{
                        background: settings.searchEngine === item.id ? 'var(--accent)' : 'var(--field-idle)',
                        color: settings.searchEngine === item.id ? '#fff' : 'var(--text-dim)',
                        transition: 'background var(--t-base) var(--ease-out)'
                      }}
                    >
                      {item.name.charAt(0)}
                    </span>
                    {/* The name and nothing else. Grading each engine as
                        "private" or "tracking" and explaining it underneath
                        turned a list of five names into a wall of opinion. */}
                    <span className="min-w-0 flex-1 truncate text-base font-medium">{item.name}</span>
                  </button>
                ))}
                {settings.searchEngine === 'custom' && (
                  <Row title={t('Адрес поиска')} hint={t('%s подставляется вместо запроса')} {...of('customSearchUrl')} advanced>
                    <TextField value={settings.customSearchUrl} onChange={(v) => onPatch({ customSearchUrl: v })} width={300} mono />
                  </Row>
                )}
              </Section>

              {/* Somebody's own engines, each with the word that reaches it.
                  "w Тьюринг" is thirty years old and still the fastest way to
                  search anything that is not your default. */}
              <Section
                title={t('Свои поисковики')}
                icon={<Globe width={15} height={15} />}
                description={t('Слово, пробел, запрос — и он уходит туда')}
                action={
                  <button
                    className="btn"
                    onClick={() =>
                      onPatch({
                        customEngines: [
                          ...settings.customEngines,
                          { key: '', name: '', template: 'https://example.com/search?q=%s' }
                        ]
                      })
                    }
                  >
                    <Plus width={15} height={15} />
                    {t('Добавить')}
                  </button>
                }
              >
                {settings.customEngines.length === 0 && (
                  <div className="px-4 py-3 text-sm text-faint">
                    {t('Например: w — Википедия, gh — GitHub')}
                  </div>
                )}
                {settings.customEngines.map((one, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 px-4 py-2.5"
                    style={{ borderTop: '1px solid var(--line)' }}
                  >
                    <TextField
                      value={one.key}
                      onChange={(key) =>
                        onPatch({
                          customEngines: settings.customEngines.map((row, at) =>
                            at === index ? { ...row, key } : row
                          )
                        })
                      }
                      placeholder="w"
                      width={64}
                      mono
                    />
                    <TextField
                      value={one.name}
                      onChange={(name) =>
                        onPatch({
                          customEngines: settings.customEngines.map((row, at) =>
                            at === index ? { ...row, name } : row
                          )
                        })
                      }
                      placeholder={t('Название')}
                      width={140}
                    />
                    <TextField
                      value={one.template}
                      onChange={(template) =>
                        onPatch({
                          customEngines: settings.customEngines.map((row, at) =>
                            at === index ? { ...row, template } : row
                          )
                        })
                      }
                      placeholder="https://…%s"
                      width={260}
                      mono
                    />
                    <button
                      className="icon-btn shrink-0"
                      aria-label={t('Удалить')}
                      onClick={() =>
                        onPatch({
                          customEngines: settings.customEngines.filter((_row, at) => at !== index)
                        })
                      }
                    >
                      <Cross width={14} height={14} />
                    </button>
                  </div>
                ))}
              </Section>

              <Section title={t('Адресная строка')} icon={<Search width={15} height={15} />}>
                <Row title={t('Подсказки из истории')} hint={t('Подсказки строятся локально и никуда не отправляются')} {...of('historySuggestions')}>
                  <Toggle checked={settings.historySuggestions} onChange={(v) => onPatch({ historySuggestions: v })} />
                </Row>
                <Row title={t('Подсказки')} hint={t('Строки под тем, что вы печатаете')} {...of('suggestions')}>
                  <Toggle checked={settings.suggestions} onChange={(v) => onPatch({ suggestions: v })} />
                </Row>
                <Row title={t('Страницы сайта')} hint={t('Не только главная, но и то, где вы были')} {...of('siteSuggestions')} advanced>
                  <Toggle checked={settings.siteSuggestions} onChange={(v) => onPatch({ siteSuggestions: v })} />
                </Row>
                <Row
                  {...of('inlineAnswers')}
                  title={t('Считать прямо в строке')}
                  hint={t('Арифметика, единицы, время в городе — без отправки запроса')}
                >
                  <Toggle checked={settings.inlineAnswers} onChange={(v) => onPatch({ inlineAnswers: v })} />
                </Row>
                <Row title={t('Забыть поисковые запросы')} hint={t('Страницы останутся, запросы уйдут')}>
                  <button
                    className="btn"
                    onClick={async () => {
                      const gone = await window.browser.forgetSearches()
                      flash(t('Убрано запросов: {n}', { n: gone }))
                    }}
                  >
                    <Trash width={15} height={15} />
                    {t('Очистить')}
                  </button>
                </Row>
                <Row title={t('Домашняя страница')} hint={t('Открывается по кнопке «домой»; пусто — стартовый экран')} {...of('homepage')}>
                  <TextField value={settings.homepage} onChange={(v) => onPatch({ homepage: v })} placeholder="https://" width={260} />
                </Row>
                <Row title={t('Текущий движок')}>
                  <span className="text-sm text-dim">{engine?.name}</span>
                </Row>
              </Section>
            </>
          )}

          {/* ------------------------------------------------------ profiles */}
          {which === 'profiles' && profiles && (
            <Section
              title={t('Профили')}
              icon={<Users width={15} height={15} />}
              description={t('У каждого профиля свои cookies, история, закладки, пароли и настройки')}
              action={
                <button
                  className="btn"
                  onClick={async () => {
                    const profile = await window.browser.createProfile(t('Новый профиль'))
                    setEditProfile(profile)
                  }}
                >
                  <Plus width={15} height={15} />
                  {t('Добавить')}
                </button>
              }
            >
              {profiles.profiles.map((profile) => (
                <div key={profile.id} className="flex items-center gap-3 px-4 py-3" style={{ borderTop: '1px solid var(--line)' }}>
                  <Avatar avatar={profile.avatar} crop={profile.crop} color={profile.color} size={34} ring={profile.id === profiles.activeId} />
                  <div className="min-w-0 flex-1">
                    {/* The ring around the avatar already says which one you
                        are in, and the one you are in is the one without a
                        "Войти" button. */}
                    <div className="truncate text-base font-medium">{profile.name}</div>
                    <div className="text-sm text-dim">
                      {t('создан {date}', {
                        date: new Date(profile.created).toLocaleDateString(
                          currentLanguage() || undefined
                        )
                      })}
                    </div>
                  </div>
                  {profile.id !== profiles.activeId && (
                    <button className="btn" onClick={() => window.browser.switchProfile(profile.id)}>
                      {t('Войти')}
                    </button>
                  )}
                  <button className="btn" onClick={() => setEditProfile(profile)}>
                    {t('Изменить')}
                  </button>
                  {profiles.profiles.length > 1 && (
                    <button
                      className="icon-btn"
                      title={t('Удалить профиль вместе с данными')}
                      onClick={async () => {
                        await window.browser.removeProfile(profile.id)
                        flash(t('Профиль удалён'))
                      }}
                    >
                      <Trash width={15} height={15} />
                    </button>
                  )}
                </div>
              ))}
            </Section>
          )}

          {/* ------------------------------------------------------- privacy */}
          {which === 'privacy' && (
            <>
              <Section
                title={t('Блокировка')}
                icon={<Shield width={15} height={15} />}
                description={t('С запуска заблокировано: {n}', { n: stats.ads + stats.trackers + stats.crypto })}
              >
                <Row title={t('Реклама')} hint={t('Рекламные сети отсекаются до сетевого запроса')} {...of('blockAds')}>
                  <Toggle checked={settings.blockAds} onChange={(v) => onPatch({ blockAds: v })} />
                </Row>
                <Row title={t('Трекеры')} hint={t('Аналитика, пиксели, запись сессий')} {...of('blockTrackers')}>
                  <Toggle checked={settings.blockTrackers} onChange={(v) => onPatch({ blockTrackers: v })} />
                </Row>
                <Row title={t('Майнеры')} hint={t('Скрипты, считающие криптовалюту на вашем процессоре')} {...of('blockCrypto')} advanced>
                  <Toggle checked={settings.blockCrypto} onChange={(v) => onPatch({ blockCrypto: v })} />
                </Row>
                <Row title={t('Убирать метки из ссылок')} hint={t('utm_*, fbclid, gclid, yclid и ещё около 60')} {...of('stripTrackingParams')} advanced>
                  <Toggle checked={settings.stripTrackingParams} onChange={(v) => onPatch({ stripTrackingParams: v })} />
                </Row>
              </Section>

              <Section
                title={t('Списки фильтров')}
                icon={<Shield width={15} height={15} />}
                description={t('EasyList и другие правила поверх встроенного списка доменов — без них реклама на YouTube и баннеры на сайтах остаются')}
              >
                <Row
                  {...of('filterLists')} advanced
                  title={t('Использовать списки фильтров')}
                  hint={
                    filters?.enabled
                      ? t('{a} сетевых правил, {b} косметических', { a: filters.rules.toLocaleString(), b: filters.cosmetic.toLocaleString() })
                      : t('Списки скачиваются один раз и обновляются раз в 5 дней')
                  }
                >
                  <Toggle checked={settings.filterLists} onChange={(v) => onPatch({ filterLists: v })} />
                </Row>
                <Row title={t('Прятать пустые блоки')} hint={t('Скрывает рамки и заглушки, оставшиеся от заблокированной рекламы')} {...of('cosmeticFiltering')} advanced>
                  <Toggle
                    checked={settings.cosmeticFiltering}
                    onChange={(v) => onPatch({ cosmeticFiltering: v })}
                  />
                </Row>
                <Row
                  title={t('Обновление')}
                  hint={
                    filters && filters.updated > 0
                      ? t('Последнее: {when}', { when: new Date(filters.updated).toLocaleString() })
                      : t('Списки ещё не загружались')
                  }
                >
                  <button
                    className="btn"
                    disabled={refreshing}
                    onClick={async () => {
                      setRefreshing(true)
                      try {
                        setFilters(await window.browser.refreshFilters())
                        setRefreshed(await window.browser.filterRefresh())
                        flash(t('Списки обновлены'))
                      } finally {
                        setRefreshing(false)
                      }
                    }}
                  >
                    {refreshing ? t('Обновляем…') : t('Обновить сейчас')}
                  </button>
                </Row>
                {/* What that refresh actually did. A timestamp says a check
                    happened; this says whether anything changed. */}
                {refreshed && (
                  <Row
                    title={
                      refreshed.changed.length > 0
                        ? t('Обновилось списков: {n}', { n: refreshed.changed.length })
                        : t('Всё уже было свежим')
                    }
                    hint={
                      refreshed.changed.length > 0
                        ? `${refreshed.changed.map((one) => one.name).join(', ')} · ${t(
                            'Правил было {before}, стало {after}',
                            { before: refreshed.rules.before, after: refreshed.rules.after }
                          )}`
                        : t('Проверено списков: {n}', { n: refreshed.unchanged })
                    }
                  />
                )}
                {filters?.lists.map((list) => (
                  <Row
                    key={list.id}
                    title={list.name}
                    hint={
                      list.updated > 0
                        ? new Date(list.updated).toLocaleDateString(currentLanguage() || undefined)
                        : t('нет данных')
                    }
                  >
                    <span className="text-sm text-dim">{Math.round(list.bytes / 1024)} КБ</span>
                  </Row>
                ))}
              </Section>

              <Section title={t('Свои списки')} icon={<Eraser width={15} height={15} />} description={t('Дополнительные домены поверх встроенного списка')}>
                <Row title={t('Блокировать домен')} {...of('customBlocked')}>
                  <div className="flex gap-2">
                    <TextField value={newDomain} onChange={setNewDomain} placeholder="example.com" width={200} onEnter={() => {
                      if (!newDomain.trim()) return
                      onPatch({ customBlocked: [...settings.customBlocked, newDomain.trim()] })
                      setNewDomain('')
                    }} />
                    <button
                      className="btn"
                      onClick={() => {
                        if (!newDomain.trim()) return
                        onPatch({ customBlocked: [...settings.customBlocked, newDomain.trim()] })
                        setNewDomain('')
                      }}
                    >
                      <Plus width={15} height={15} />
                    </button>
                  </div>
                </Row>
                {settings.customBlocked.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-4 py-3" style={{ borderTop: '1px solid var(--line)' }}>
                    {settings.customBlocked.map((domain) => (
                      <span key={domain} className="flex items-center gap-1 rounded-pill px-2 py-1 text-xs" style={{ background: 'var(--field-idle)' }}>
                        {domain}
                        <button onClick={() => onPatch({ customBlocked: settings.customBlocked.filter((d) => d !== domain) })}>
                          <Cross width={11} height={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <Row title={t('Никогда не блокировать')} hint={t('Если блокировка что-то ломает на конкретном сайте')} {...of('customAllowed')}>
                  <div className="flex gap-2">
                    <TextField value={newAllowed} onChange={setNewAllowed} placeholder="example.com" width={200} onEnter={() => {
                      if (!newAllowed.trim()) return
                      onPatch({ customAllowed: [...settings.customAllowed, newAllowed.trim()] })
                      setNewAllowed('')
                    }} />
                    <button
                      className="btn"
                      onClick={() => {
                        if (!newAllowed.trim()) return
                        onPatch({ customAllowed: [...settings.customAllowed, newAllowed.trim()] })
                        setNewAllowed('')
                      }}
                    >
                      <Plus width={15} height={15} />
                    </button>
                  </div>
                </Row>
                {settings.customAllowed.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-4 py-3" style={{ borderTop: '1px solid var(--line)' }}>
                    {settings.customAllowed.map((domain) => (
                      <span key={domain} className="flex items-center gap-1 rounded-pill px-2 py-1 text-xs" style={{ background: 'var(--field-idle)' }}>
                        {domain}
                        <button onClick={() => onPatch({ customAllowed: settings.customAllowed.filter((d) => d !== domain) })}>
                          <Cross width={11} height={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </Section>

              {/* The things a site does to work out which machine it is
                  talking to, and what is done about them. */}
              <Section
                title={t('Слежка и отпечаток')}
                icon={<Eye width={15} height={15} />}
                description={t('Чем сайт узнаёт именно вашу машину — и что с этим делается')}
              >
                <Row
                  title={t('Притуплять отпечаток')}
                  hint={t('Холст и звук читаются с еле заметным шумом, счётчики ядер и памяти округляются. Шум свой для каждого сайта и на один сеанс')}
                  {...of('fingerprintGuard')}
                >
                  <Toggle checked={settings.fingerprintGuard} onChange={(v) => onPatch({ fingerprintGuard: v })} />
                </Row>
                <Row
                  title={t('Не давать читать буфер обмена')}
                  hint={t('Страница узнаёт скопированное, только когда вы сами вставляете')}
                  {...of('clipboardGuard')}
                >
                  <Toggle checked={settings.clipboardGuard} onChange={(v) => onPatch({ clipboardGuard: v })} />
                </Row>
                <Row
                  title={t('Предупреждать о похожих адресах')}
                  hint={t('Проверка идёт на этой машине: ни списка, ни запроса наружу')}
                  {...of('phishingGuard')}
                >
                  <Toggle checked={settings.phishingGuard} onChange={(v) => onPatch({ phishingGuard: v })} />
                </Row>
                <Row
                  title={t('Прятать баннеры о куках')}
                  hint={t('Скрывает окна согласия, но ни на что за вас не соглашается')}
                  {...of('cookieBanners')}
                >
                  <Toggle checked={settings.cookieBanners} onChange={(v) => onPatch({ cookieBanners: v })} />
                </Row>
                <Row
                  title={t('Снова спрашивать про место')}
                  hint={t('Разрешение на геопозицию перестаёт действовать через столько дней; 0 — не переспрашивать')}
                  {...of('reaskLocationDays')}
                  advanced
                >
                  <Slider
                    value={settings.reaskLocationDays}
                    min={0}
                    max={180}
                    step={5}
                    format={(v) => (v === 0 ? t('Никогда') : t('{n} дн.', { n: v }))}
                    onChange={(value) => onPatch({ reaskLocationDays: value })}
                  />
                </Row>
              </Section>

              {/* Jars of cookies with names on them. */}
              <Section
                title={t('Контейнеры')}
                icon={<Grid width={15} height={15} />}
                description={t('Отдельная банка с cookie: два аккаунта на одном сайте, работа рядом с личным')}
                action={
                  <button
                    className="btn"
                    onClick={() =>
                      onPatch({
                        containers: [
                          ...settings.containers,
                          {
                            id: String(Date.now()).slice(-8),
                            name: t('Контейнер {n}', { n: settings.containers.length + 1 }),
                            colour: '#7c6cff',
                            icon: '📦'
                          }
                        ]
                      })
                    }
                  >
                    <Plus width={15} height={15} />
                    {t('Добавить')}
                  </button>
                }
              >
                {settings.containers.length === 0 && (
                  <div className="px-4 py-3 text-sm text-faint">
                    {t('Контейнеров нет. У каждого свои cookie и свои входы — сайт в одном не знает о другом')}
                  </div>
                )}
                {settings.containers.map((one, index) => (
                  <div
                    key={one.id}
                    className="flex items-center gap-2 px-4 py-2.5"
                    style={{ borderTop: '1px solid var(--line)' }}
                  >
                    <TextField
                      value={one.icon}
                      onChange={(icon) =>
                        onPatch({
                          containers: settings.containers.map((row, at) =>
                            at === index ? { ...row, icon: [...icon].slice(0, 2).join('') } : row
                          )
                        })
                      }
                      width={52}
                    />
                    <TextField
                      value={one.name}
                      onChange={(name) =>
                        onPatch({
                          containers: settings.containers.map((row, at) =>
                            at === index ? { ...row, name } : row
                          )
                        })
                      }
                      width={200}
                    />
                    <input
                      type="color"
                      value={one.colour}
                      onChange={(event) =>
                        onPatch({
                          containers: settings.containers.map((row, at) =>
                            at === index ? { ...row, colour: event.target.value } : row
                          )
                        })
                      }
                      className="h-[24px] w-[30px] cursor-pointer rounded-[7px] border-0 bg-transparent p-0"
                      title={t('Цвет')}
                    />
                    <button
                      className="icon-btn shrink-0"
                      aria-label={t('Удалить')}
                      onClick={() =>
                        onPatch({ containers: settings.containers.filter((_row, at) => at !== index) })
                      }
                    >
                      <Cross width={14} height={14} />
                    </button>
                  </div>
                ))}
              </Section>

              {/* One report instead of one number. */}
              <Section
                title={t('Отчёт о защите')}
                icon={<Shield width={15} height={15} />}
                description={t('Что из этого вышло за две недели')}
              >
                <div className="px-4 py-3">
                  <ProtectionReportPanel />
                </div>
              </Section>

              <Section title={t('Соединение и данные')} icon={<Shield width={15} height={15} />}>
                <Row title={t('Только HTTPS')} hint={t('HTTP повышается автоматически; исключение можно подтвердить вручную')} {...of('httpsOnly')}>
                  <Toggle checked={settings.httpsOnly} onChange={(v) => onPatch({ httpsOnly: v })} />
                </Row>
                <Row title={t('Блокировать сторонние cookie')} hint={t('Разрывает сквозную слежку между сайтами')} {...of('blockThirdPartyCookies')}>
                  <Toggle checked={settings.blockThirdPartyCookies} onChange={(v) => onPatch({ blockThirdPartyCookies: v })} />
                </Row>
                <Row title={t('Заголовки DNT и Sec-GPC')} {...of('doNotTrack')} advanced>
                  <Toggle checked={settings.doNotTrack} onChange={(v) => onPatch({ doNotTrack: v })} />
                </Row>
                <Row title="WebRTC" hint={t('Ограничивает утечку локальных IP-адресов через видеозвонки')} {...of('webrtcPolicy')} advanced>
                  <Select
                    value={settings.webrtcPolicy}
                    onChange={(v) => onPatch({ webrtcPolicy: v })}
                    options={[
                      { value: 'public_only', label: t('Только публичный IP') },
                      { value: 'proxy_only', label: t('Только через прокси') },
                      { value: 'default', label: t('Как в Chromium') }
                    ]}
                    width={210}
                  />
                </Row>
                <Row
                  {...of('dnsProvider')}
                  title={t('DNS через HTTPS')}
                  hint={t('Иначе каждый адрес уходит провайдеру открытым текстом')}
                >
                  <Select
                    value={settings.dnsProvider}
                    onChange={(v) => onPatch({ dnsProvider: v })}
                    options={[
                      { value: 'system', label: t('Как в системе') },
                      { value: 'cloudflare', label: 'Cloudflare' },
                      { value: 'google', label: 'Google' },
                      { value: 'quad9', label: 'Quad9' },
                      { value: 'adguard', label: 'AdGuard' },
                      { value: 'custom', label: t('Свой сервер') }
                    ]}
                    width={210}
                  />
                </Row>
                {settings.dnsProvider === 'custom' && (
                  <Row title={t('Адрес DNS-сервера')} hint={t('Шаблон RFC 8484, только https://')} {...of('dohCustom')} advanced>
                    <input
                      className="field h-[32px] w-[280px]"
                      defaultValue={settings.dohCustom}
                      spellCheck={false}
                      placeholder="https://example.net/dns-query"
                      onBlur={(event) => onPatch({ dohCustom: event.target.value.trim() })}
                    />
                  </Row>
                )}
                {settings.dnsProvider !== 'system' && (
                  <Row
                    {...of('dohFallback')} advanced
                    title={t('Возвращаться к системному DNS')}
                    hint={t('Без этого сеть, где защищённый DNS не работает, не откроется вовсе')}
                  >
                    <Toggle checked={settings.dohFallback} onChange={(v) => onPatch({ dohFallback: v })} />
                  </Row>
                )}
                <Row title={t('Сохранять историю')} {...of('saveHistory')}>
                  <Toggle checked={settings.saveHistory} onChange={(v) => onPatch({ saveHistory: v })} />
                </Row>
                <Row title={t('Очищать данные при выходе')} hint={t('Cookies, кэш и история удаляются при закрытии')} {...of('clearOnExit')}>
                  <Toggle checked={settings.clearOnExit} onChange={(v) => onPatch({ clearOnExit: v })} />
                </Row>
              </Section>

              <Section title={t('Доступ сайтов к устройствам')} icon={<Alert width={15} height={15} />} description={t('По умолчанию всё спрашивается или запрещается')}>
                {PERMISSION_ROWS.map((row) => (
                  <Row key={row.key} title={t(row.title)} hint={t(row.hint)} {...of('permissions')}>
                    <Select
                      value={settings.permissions[row.key]}
                      onChange={(value) => onPatch({ permissions: { ...settings.permissions, [row.key]: value } })}
                      options={POLICY_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))}
                      width={150}
                    />
                  </Row>
                ))}
              </Section>
            </>
          )}

          {/* ------------------------------------------------------ passwords */}
          {which === 'passwords' && (
            <>
            <Section title={t('Хранилище паролей')} icon={<Key width={15} height={15} />} description={t('Шифрование AES-256-GCM для каждой записи')}>
              <Row title={t('Записей')} hint={vault?.mode === 'password' ? t('Ключ выводится из мастер-пароля') : t('Ключ запечатан средствами Windows (DPAPI)')}>
                <span className="text-sm text-dim">{vault?.count ?? 0}</span>
              </Row>
              <Row title={t('Состояние')}>
                <Pill tone={vault?.locked ? 'warn' : 'good'}>{vault?.locked ? t('заблокировано') : t('разблокировано')}</Pill>
              </Row>
              <Row title={t('Управление паролями')} hint={t('Просмотр, генератор, мастер-пароль')}>
                <button className="btn btn-primary" onClick={onOpenPasswords}>
                  {t('Открыть')}
                </button>
              </Row>
              <Row
                title={t('Держать хранилище закрытым')}
                hint={t('Мастер-пароль спросят там, где он понадобится — под полем входа')}
              >
                <Toggle
                  checked={settings.passwordsAskOnStart}
                  onChange={(passwordsAskOnStart) => onPatch({ passwordsAskOnStart })}
                />
              </Row>
              {helloAvailable && (
                <Row
                  title={t('Открывать через Windows Hello')}
                  hint={t('PIN-код, отпечаток или лицо вместо мастер-пароля')}
                >
                  <Toggle
                    checked={vault?.hello === true}
                    onChange={async (on) => {
                      // The prompt happens in the main process; the switch only
                      // moves once it has actually been answered.
                      const ok = await window.browser.vaultHelloEnable(on)
                      if (ok) setVault(await window.browser.vaultState())
                    }}
                  />
                </Row>
              )}
              {helloAvailable && (
                <Row
                  title={t('Подтверждать подстановку карты')}
                  hint={t('Windows Hello каждый раз, когда номер карты уходит на страницу')}
                >
                  <Toggle
                    checked={settings.cardHello}
                    onChange={(cardHello) => onPatch({ cardHello })}
                  />
                </Row>
              )}
            </Section>

            {/* Passwords from a file used to be filed under "System", three
                screens away from everything else about passwords. */}
            <Section
              title={t('Перенос паролей')}
              icon={<Download width={15} height={15} />}
              description={t('Из файла, который выгрузил другой браузер')}
            >
              <Row
                title={t('Пароли из CSV')}
                hint={t('В Chrome: Пароли → ⋮ → Экспорт паролей. Файл после импорта лучше удалить')}
              >
                <button
                  className="btn"
                  onClick={async () => {
                    const result = await window.browser.importPasswordsCsv()
                    if (result.error) flash(result.error)
                    else if (result.added || result.skipped)
                      flash(t('Добавлено {a}, пропущено {s}', { a: result.added, s: result.skipped }))
                  }}
                >
                  {t('Выбрать файл')}
                </button>
              </Row>
            </Section>
            </>
          )}

          {/* --------------------------------------------------------- speed */}
          {which === 'speed' && (
            <>
              <Section title={t('Ускорение')} icon={<Zap width={15} height={15} />} description={t('Часть параметров вступает в силу после перезапуска')}>
                <Row title={t('Аппаратное ускорение')} hint={t('Отрисовка и декодирование видео на видеокарте')} {...of('hardwareAcceleration')}>
                  <Toggle checked={settings.hardwareAcceleration} onChange={(v) => onPatch({ hardwareAcceleration: v })} />
                </Row>
                <Row title={t('Предподключение')} hint={t('TLS-соединение устанавливается ещё до клика по ссылке')} {...of('preconnect')} advanced>
                  <Toggle checked={settings.preconnect} onChange={(v) => onPatch({ preconnect: v })} />
                </Row>
                <Row title={t('Предзагрузка DNS')} {...of('prefetchDns')} advanced>
                  <Toggle checked={settings.prefetchDns} onChange={(v) => onPatch({ prefetchDns: v })} />
                </Row>
                <Row title={t('Плавная прокрутка')} {...of('smoothScrolling')} advanced>
                  <Toggle checked={settings.smoothScrolling} onChange={(v) => onPatch({ smoothScrolling: v })} />
                </Row>
                <Row title={t('Размер кэша')} {...of('cacheSizeMb')} advanced>
                  <Slider value={settings.cacheSizeMb} min={128} max={4096} step={128} onChange={(v) => onPatch({ cacheSizeMb: v })} format={(v) => (v >= 1024 ? `${(v / 1024).toFixed(1)} ГБ` : `${v} МБ`)} />
                </Row>
                <Row title={t('Масштаб страниц по умолчанию')} {...of('defaultZoom')} advanced>
                  <Slider value={settings.defaultZoom} min={-3} max={4} step={0.5} onChange={(v) => onPatch({ defaultZoom: v })} format={(v) => `${Math.round(1.2 ** v * 100)}%`} />
                </Row>
              </Section>

              <Section title={t('Память')} icon={<Zap width={15} height={15} />}>
                <Row title={t('Усыплять фоновые вкладки')} hint={t('Освобождает память неактивных вкладок')} {...of('sleepBackgroundTabs')}>
                  <Toggle checked={settings.sleepBackgroundTabs} onChange={(v) => onPatch({ sleepBackgroundTabs: v })} />
                </Row>
                {settings.sleepBackgroundTabs && (
                  <Row title={t('Засыпать через')} {...of('sleepAfterMinutes')} advanced>
                    <Slider value={settings.sleepAfterMinutes} min={1} max={120} onChange={(v) => onPatch({ sleepAfterMinutes: v })} format={(v) => `${v} мин`} />
                  </Row>
                )}
                <Row title={t('Восстанавливать вкладки при запуске')} {...of('restoreSession')}>
                  <Toggle checked={settings.restoreSession} onChange={(v) => onPatch({ restoreSession: v })} />
                </Row>
                <Row title={t('Ленивое восстановление')} hint={t('При старте грузится только активная вкладка')} {...of('lazyRestore')} advanced>
                  <Toggle checked={settings.lazyRestore} onChange={(v) => onPatch({ lazyRestore: v })} />
                </Row>
              </Section>

              <Section
                title={t('Вперёд и в запас')}
                icon={<Zap width={15} height={15} />}
                description={t('Страница начинает грузиться до того, как вы по ней кликнете')}
              >
                <Row
                  title={t('Начинать загрузку при наведении')}
                  hint={t('Пока вы ведёте курсор к ссылке, соединение уже открыто')}
                  {...of('prefetchOnHover')}
                >
                  <Toggle checked={settings.prefetchOnHover} onChange={(v) => onPatch({ prefetchOnHover: v })} />
                </Row>
                <Row
                  title={t('Подгружать следующую страницу')}
                  hint={t('Если сайт сам указывает, какая страница идёт за этой')}
                  {...of('prefetchNext')}
                >
                  <Toggle checked={settings.prefetchNext} onChange={(v) => onPatch({ prefetchNext: v })} />
                </Row>
                <Row
                  title={t('Быстрый старт')}
                  hint={t('Браузер запускается вместе с системой и ждёт свёрнутым — первое окно открывается мгновенно')}
                  {...of('fastStart')}
                >
                  <Toggle checked={settings.fastStart} onChange={(v) => onPatch({ fastStart: v })} />
                </Row>
                <Row
                  title={t('Экономия от батареи')}
                  hint={t('Без розетки вкладки засыпают быстрее, обои перестают меняться, предзагрузка выключается')}
                  {...of('batterySaver')}
                >
                  <Toggle checked={settings.batterySaver} onChange={(v) => onPatch({ batterySaver: v })} />
                </Row>
                <Row
                  title={t('Очищать кэш каждые')}
                  hint={t('Кэш, которому год, — самая частая причина «у меня показывается старая версия»')}
                  {...of('clearCacheDays')}
                  advanced
                >
                  <Slider
                    value={settings.clearCacheDays}
                    min={0}
                    max={90}
                    step={1}
                    width={160}
                    format={(v) => (v === 0 ? t('никогда') : `${v} дн.`)}
                    onChange={(clearCacheDays) => onPatch({ clearCacheDays })}
                  />
                </Row>
                <Row
                  title={t('Часы и счётчик вкладок')}
                  hint={t('В правом углу строки вкладок')}
                  {...of('stripClock')}
                >
                  <Toggle checked={settings.stripClock} onChange={(v) => onPatch({ stripClock: v })} />
                </Row>
              </Section>

              <Diagnostics flash={flash} />
            </>
          )}

          {/* ----------------------------------------------------- downloads */}
          {which === 'downloads' && (
            <Section title={t('Загрузки')} icon={<Download width={15} height={15} />}>
              <Row title={t('Папка для файлов')} hint={settings.downloadDir || t('Папка по умолчанию')}>
                <button
                  className="btn"
                  onClick={async () => {
                    const dir = await window.browser.pickDownloadDir()
                    if (dir) flash(t('Папка обновлена'))
                  }}
                >
                  {t('Выбрать')}
                </button>
              </Row>
              <Row title={t('Спрашивать, куда сохранять')} hint={t('Диалог для каждого файла')} {...of('askWhereToSave')} advanced>
                <Toggle checked={settings.askWhereToSave} onChange={(v) => onPatch({ askWhereToSave: v })} />
              </Row>
              <Row
                title={t('Сколько качать одновременно')}
                hint={t('Остальные ждут очереди')}
              >
                <Slider
                  value={settings.downloadAtOnce}
                  min={1}
                  max={6}
                  width={140}
                  onChange={(downloadAtOnce) => onPatch({ downloadAtOnce })}
                />
              </Row>
              <Row
                title={t('Ограничить скорость')}
                hint={t('Чтобы загрузка не съедала весь канал')}
              >
                <Slider
                  value={settings.downloadLimit}
                  min={0}
                  max={20480}
                  step={256}
                  width={180}
                  format={(kb) => (kb === 0 ? t('без границ') : `${formatBytes(kb * 1024)}${t('/с')}`)}
                  onChange={(downloadLimit) => onPatch({ downloadLimit })}
                />
              </Row>
              <Row
                title={t('Имя файла по правилу')}
                hint={t('Пусто — как назвал сайт')}
              >
                <TextField
                  value={settings.downloadNameRule}
                  onChange={(downloadNameRule) => onPatch({ downloadNameRule })}
                  placeholder="{date} {name}"
                  width={200}
                />
              </Row>
              <Row
                title={t('Распаковывать архивы')}
                hint={t('ZIP рядом с файлом')}
              >
                <Toggle
                  checked={settings.downloadUnzip}
                  onChange={(downloadUnzip) => onPatch({ downloadUnzip })}
                />
              </Row>
              <Row
                title={t('Спрашивать о загрузках без клика')}
                hint={t('Когда страница начинает скачивание сама')}
              >
                <Toggle
                  checked={settings.downloadAsk}
                  onChange={(downloadAsk) => onPatch({ downloadAsk })}
                />
              </Row>
            </Section>
          )}

          {/* ---------------------------------------------------------- data */}
          {which === 'data' && (
            <>
              <Section
                title={t('Резервная копия')}
                icon={<Download width={15} height={15} />}
                description={t('Пароли, карты, закладки, история и настройки — в одном файле')}
              >
                <Backup />
              </Section>

              <Section title={t('Очистка')} icon={<Trash width={15} height={15} />}>
                <Row title={t('История просмотров')} hint={t('Локальные подсказки адресной строки')}>
                  <button className="btn" onClick={async () => { await window.browser.clearHistory(); flash(t('История очищена')) }}>
                    {t('Очистить')}
                  </button>
                </Row>
                <Row title={t('Данные сайтов')} hint={t('Cookies, кэш, localStorage, service workers')} danger>
                  <button className="btn btn-danger" onClick={async () => { await window.browser.clearBrowsingData(); flash(t('Данные удалены')) }}>
                    {t('Удалить')}
                  </button>
                </Row>
                <Row title={t('Данные всех профилей')} hint={t('То же самое, но для каждого профиля сразу')} danger>
                  <button className="btn btn-danger" onClick={async () => { await window.browser.clearAllProfiles(); flash(t('Все профили очищены')) }}>
                    {t('Удалить всё')}
                  </button>
                </Row>
              </Section>

              <Section title={t('Настройки')} icon={<Gear width={15} height={15} />}>
                <Row title={t('Экспорт настроек')} hint={t('JSON со всеми параметрами профиля')}>
                  <button
                    className="btn"
                    onClick={async () => {
                      const json = await window.browser.exportSettings()
                      await navigator.clipboard.writeText(json)
                      flash(t('Скопировано в буфер обмена'))
                    }}
                  >
                    {t('Скопировать')}
                  </button>
                </Row>
                <Row title={t('Импорт настроек')}>
                  <button className="btn" onClick={() => setImportOpen(true)}>
                    {t('Вставить JSON')}
                  </button>
                </Row>
                <Row title={t('Папка с данными')} hint={info?.userData ?? ''}>
                  <button className="btn" onClick={() => window.browser.openDataFolder()}>
                    {t('Открыть')}
                  </button>
                </Row>
              </Section>
            </>
          )}

          {/* -------------------------------------------------------- system */}
          {which === 'system' && (
            <>
              <Section
                title={t('Установленные приложения')}
                icon={<Install width={15} height={15} />}
                description={t('Сайты, установленные как приложения, со своим окном и ярлыком')}
              >
                {installedApps.length === 0 ? (
                  <Row
                    title={t('Пока ничего не установлено')}
                    hint={t('Когда сайт можно установить, в адресной строке появится значок')}
                  >
                    <span />
                  </Row>
                ) : (
                  installedApps.map((item) => (
                    <Row key={item.id} title={item.name} hint={item.startUrl}>
                      <div className="flex items-center gap-2">
                        <button className="btn" onClick={() => void window.browser.openApp(item.id)}>
                          {t('Открыть')}
                        </button>
                        <button
                          className="btn"
                          onClick={async () => setInstalledApps(await window.browser.removeApp(item.id))}
                        >
                          {t('Удалить')}
                        </button>
                      </div>
                    </Row>
                  ))
                )}
              </Section>

              <Section
                title={t('Обновления')}
                icon={<Refresh width={15} height={15} />}
                description={t('Из релизов проекта на GitHub')}
              >
                <Row
                  title={t('Установлена версия {v}', { v: info?.version ?? '—' })}
                  hint={updateHint(update)}
                >
                  {update?.stage === 'ready' ? (
                    <button className="btn btn-primary" onClick={() => window.browser.installUpdate()}>
                      {t('Перезапустить и обновить')}
                    </button>
                  ) : update?.stage === 'available' && update.manual ? (
                    <button
                      className="btn btn-primary"
                      onClick={() => window.browser.openExternal(RELEASES_PAGE)}
                    >
                      {t('Открыть страницу загрузки')}
                    </button>
                  ) : update?.stage === 'available' ? (
                    <button className="btn btn-primary" onClick={() => window.browser.downloadUpdate()}>
                      {t('Загрузить')}
                    </button>
                  ) : (
                    <button
                      className="btn"
                      disabled={update?.stage === 'checking' || update?.stage === 'downloading'}
                      onClick={async () => setUpdate(await window.browser.checkUpdates())}
                    >
                      {update?.stage === 'checking'
                        ? t('Проверяем…')
                        : update?.stage === 'downloading'
                          ? t('Загрузка {p}%', { p: update.percent })
                          : t('Проверить')}
                    </button>
                  )}
                </Row>
              </Section>

              <Section
                title={t('Первая настройка')}
                icon={<Sparkles width={15} height={15} />}
                description={t('Тот же экран, что и при первом запуске')}
              >
                <Row
                  {...of('onboarded')}
                  title={t('Пройти настройку заново')}
                  hint={t('Профиль, тема, прозрачность, обои, поиск и защита — по шагам')}
                >
                  <button className="btn" onClick={() => onPatch({ onboarded: false })}>
                    {t('Открыть')}
                  </button>
                </Row>
              </Section>

              <Section
                title={t('Браузер по умолчанию')}
                icon={<Monitor width={15} height={15} />}
                description={t('Чтобы ссылки из Telegram, почты и редактора открывались здесь')}
              >
                <Row
                  title={t('Сейчас')}
                  hint={
                    defaults?.isDefault
                      ? t('Windows открывает ссылки в Nya Browser')
                      : defaults?.registered
                        ? t('Nya есть в списке приложений, но основным выбран другой браузер')
                        : t('Nya пока не зарегистрирован в системе')
                  }
                >
                  <Pill tone={defaults?.isDefault ? 'good' : 'warn'}>
                    {defaults?.isDefault ? t('Основной') : t('Не основной')}
                  </Pill>
                </Row>
                <Row
                  title={t('Назначить основным')}
                  hint={
                    defaults && !defaults.canRegister
                      ? t('Недоступно в режиме разработки — нужна собранная версия')
                      : t('Откроется окно Windows: выберите Nya Browser для http и https')
                  }
                >
                  <button
                    className="btn btn-primary"
                    disabled={defaults ? !defaults.canRegister : true}
                    onClick={async () => {
                      setDefaults(await window.browser.makeDefaultBrowser())
                      flash(t('Выберите Nya Browser в открывшемся окне Windows'))
                    }}
                  >
                    {t('Настроить')}
                  </button>
                </Row>
              </Section>

              <Section
                title={t('Перенос из другого браузера')}
                icon={<Download width={15} height={15} />}
                description={t('Закладки читаются напрямую, пароли — из экспортированного CSV')}
              >
                {sources === null ? (
                  <Row title={t('Ищем установленные браузеры…')} />
                ) : sources.length === 0 ? (
                  <Row title={t('Ничего не найдено')} hint={t('Chrome, Edge, Brave, Vivaldi, Yandex и Opera на этом компьютере не найдены')} />
                ) : (
                  sources.map((source) => (
                    <Row
                      key={source.id}
                      title={`${source.browser} · ${source.profile}`}
                      hint={t('{n} закладок', { n: source.bookmarks })}
                    >
                      <button
                        className="btn"
                        onClick={async () => {
                          const result = await window.browser.importBookmarksFrom(source.id)
                          flash(
                            result.error
                              ? result.error
                              : t('Добавлено {a}, пропущено {s}', { a: result.added, s: result.skipped })
                          )
                        }}
                      >
                        {t('Импортировать')}
                      </button>
                    </Row>
                  ))
                )}
              </Section>

              <Section
                title={t('Защищённое видео')}
                icon={<Film width={15} height={15} />}
                description={t('Widevine — без него Netflix, Spotify и Кинопоиск не играют')}
              >
                <Row
                  {...of('drm')}
                  title={t('Разрешить DRM')}
                  hint={drmHint(drm, settings.drm)}
                >
                  <Toggle checked={settings.drm} onChange={(value) => onPatch({ drm: value })} />
                </Row>
                <Row
                  title={t('Качество ограничено')}
                  hint={t('Доступен только программный L3, поэтому сервисы отдают 480p–720p. 4K требует аппаратной защиты, которой нет ни у одного браузера на Electron')}
                >
                  <Pill>L3</Pill>
                </Row>
              </Section>

              <Section
                title={t('Расширения')}
                icon={<Grid width={15} height={15} />}
                description={t('Папка с manifest.json, либо файл .crx или .zip — распакуется сам')}
              >
                {extensions === null ? (
                  <Row title={t('Читаем список…')} />
                ) : extensions.length === 0 ? (
                  <Row title={t('Пока ничего не установлено')} />
                ) : (
                  extensions.map((item) => (
                    <Row
                      key={item.path}
                      title={item.version ? `${item.name} · ${item.version}` : item.name}
                      hint={item.loaded ? item.path : t('Не загрузилось — подробности в nya.log')}
                    >
                      <div className="flex items-center gap-2">
                        {item.loaded ? (
                          item.manifest > 0 && <Pill>MV{item.manifest}</Pill>
                        ) : (
                          <Pill tone="bad">{t('Ошибка')}</Pill>
                        )}
                        <button className="btn" onClick={() => window.browser.revealExtension(item.path)}>
                          {t('Папка')}
                        </button>
                        <button
                          className="btn btn-danger"
                          onClick={async () => {
                            await window.browser.removeExtension(item.path)
                            setExtensions(await window.browser.extensions())
                            flash(t('Расширение удалено'))
                          }}
                        >
                          {t('Удалить')}
                        </button>
                      </div>
                    </Row>
                  ))
                )}
                <Row
                  title={t('Установить из файла')}
                  hint={t('Папка с manifest.json, .crx или .zip. Работает то, что живёт на content-скриптах: темы и правки страниц. Блокировщики рекламы и расширения, которые держат свой интерфейс на связи с фоном, — нет')}
                >
                  <button
                    className="btn"
                    onClick={async () => {
                      const result = await window.browser.addExtension()
                      setExtensions(await window.browser.extensions())
                      if (result.error) flash(result.error)
                      else if (result.added) flash(t('Установлено: {name}', { name: result.added.name }))
                    }}
                  >
                    {t('Выбрать файл или папку')}
                  </button>
                </Row>
              </Section>

              <Section
                title={t('Проверка орфографии')}
                icon={<Keyboard width={15} height={15} />}
                description={t('Подчёркивает ошибки в текстовых полях на страницах')}
              >
                <Row
                  {...of('spellcheck')}
                  title={t('Проверять правописание')}
                  hint={t('Русский и английский. Словари скачиваются с серверов Google при первом включении — это единственный запрос, который браузер делает сам')}
                >
                  <Toggle
                    checked={settings.spellcheck}
                    onChange={(value) => onPatch({ spellcheck: value })}
                  />
                </Row>
              </Section>
            </>
          )}

          {/* --------------------------------------------------------- about */}
          {which === 'time' && (
            <>
              <header className="mb-3 flex items-center gap-2.5 px-1">
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-[9px]"
                  style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}
                >
                  <Clock width={15} height={15} />
                </span>
                <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{t('Цифровое благополучие')}</h2>
              </header>
              <Wellbeing />
            </>
          )}

          {which === 'notify' && (
            <>
              <Section
                title={t('Уведомления')}
                icon={<Alert width={15} height={15} />}
              >
                <Row title={t('Не беспокоить')} {...of('doNotDisturb')}>
                  <Toggle
                    checked={settings.doNotDisturb}
                    onChange={(value) => onPatch({ doNotDisturb: value })}
                  />
                </Row>
                <Row title={t('Не запускать видео и звук самостоятельно')} {...of('blockAutoplay')} advanced>
                  <Toggle
                    checked={settings.blockAutoplay}
                    onChange={(value) => onPatch({ blockAutoplay: value })}
                  />
                </Row>
              </Section>
            </>
          )}

          {which === 'keys' && (
            <>
              <Section
                title={t('Горячие клавиши')}
                icon={<Keyboard width={15} height={15} />}
                action={
                  <button className="btn" onClick={() => onPatch({ shortcuts: {} })}>
                    {t('Сбросить')}
                  </button>
                }
              >
                <Shortcuts shortcuts={settings.shortcuts} onPatch={onPatch} />
                <Row title={t('Перейти к вкладке')}>
                  <kbd className="rounded-[7px] px-2 py-1 text-2xs" style={{ background: 'var(--field-idle)' }}>Ctrl+1…9</kbd>
                </Row>
                <Row title={t('Масштаб страницы')}>
                  <kbd className="rounded-[7px] px-2 py-1 text-2xs" style={{ background: 'var(--field-idle)' }}>Ctrl + / − / 0</kbd>
                </Row>
              </Section>
            </>
          )}

          {which === 'about' && (
            <>
              <div className="animate-fade-up flex flex-col items-center gap-3 py-4 text-center">
                <img
                  src={logoUrl}
                  alt=""
                  width={104}
                  height={104}
                  className="select-none"
                  draggable={false}
                  style={{ filter: 'drop-shadow(0 10px 24px color-mix(in srgb, var(--accent) 35%, transparent))' }}
                />
                <div>
                  <div className="text-[22px] font-semibold tracking-[-0.03em]">Nya Browser</div>
                  <div className="text-sm text-dim">версия {info?.version ?? '—'}</div>
                </div>
              </div>

              <Section title={t('О браузере')} icon={<Gear width={15} height={15} />}>
                <Row title="Nya Browser"><span className="text-sm text-dim">версия {info?.version ?? '—'}</span></Row>
                <Row title={t('Движок')}><span className="text-sm text-dim">Chromium {info?.chrome ?? '—'}</span></Row>
                <Row title="Electron"><span className="text-sm text-dim">{info?.electron ?? '—'}</span></Row>
                <Row title="Node / V8"><span className="text-sm text-dim">{info?.node ?? '—'} · {info?.v8 ?? '—'}</span></Row>
                <Row title={t('Платформа')}><span className="text-sm text-dim">{info?.platform ?? '—'} {info?.arch ?? ''}</span></Row>
                <Row
                  title={t('Видеокарта')}
                  hint={
                    info?.gpu.software
                      ? t('Рисует процессор, а не карта — размытие, стекло и плавные обои могут не показываться')
                      : t('Отрисовка идёт на карте')
                  }
                >
                  <span
                    className="text-right text-sm"
                    style={{ color: info?.gpu.software ? 'var(--warn)' : 'var(--dim)' }}
                  >
                    {info?.gpu.adapter || '—'}
                    <span className="block text-2xs text-faint">
                      {t('Композитинг')}: {info?.gpu.compositing ?? '—'} · {t('Растеризация')}:{' '}
                      {info?.gpu.rasterization ?? '—'}
                    </span>
                  </span>
                </Row>
                <Row title={t('Правил в списке блокировки')}><span className="text-sm text-dim">{info?.blocklistSize ?? '—'}</span></Row>
                <Row title={t('Проверка безопасности')} hint={t('Живые тесты изоляции, блокировки и разрешений')}>
                  <button className="btn btn-primary" onClick={() => window.browser.newTab('nya://security')}>
                    <Shield width={15} height={15} />
                    {t('Запустить')}
                  </button>
                </Row>
              </Section>

            </>
          )}
    </>
  )

  return (
    <Looking.Provider value={looking}>
    <FullSettings.Provider value={settings.settingsFull}>
    <div className="relative z-10 flex h-full min-h-0">
      {/* nav */}
      <nav className="contain flex w-[218px] shrink-0 flex-col gap-1 overflow-y-auto p-3" style={{ borderRight: '1px solid var(--line)' }}>
        <div className="px-2 pb-3 pt-1">
          <div className="text-[17px] font-semibold tracking-[-0.02em]">{t('Настройки')}</div>
          <div className="text-sm text-dim">Nya Browser</div>
        </div>

        {/* Two hundred settings is a page nobody reads. The short form is the
            three dozen that most people actually change; the full one is
            everything, and it is one press away rather than hidden. */}
        <div className="mb-2 px-0.5">
          <Segmented
            value={settings.settingsFull ? 'full' : 'simple'}
            onChange={(value) => onPatch({ settingsFull: value === 'full' })}
            options={[
              { value: 'simple', label: t('Простые') },
              { value: 'full', label: t('Все') }
            ]}
          />
        </div>

        <div className="relative mb-1.5 px-0.5">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint">
            <Search width={14} height={14} />
          </span>
          <input
            className="field w-full"
            style={{ height: 32, paddingLeft: 30, paddingRight: query ? 28 : 12 }}
            placeholder={t('Поиск по настройкам')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // Escape closes the settings; while there is something typed in
              // here it empties the field first, which is what it means here.
              if (event.key === 'Escape' && query) {
                event.stopPropagation()
                setQuery('')
              }
            }}
          />
          {query && (
            <button
              className="icon-btn absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2"
              title={t('Очистить')}
              onClick={() => setQuery('')}
            >
              <Cross width={12} height={12} />
            </button>
          )}
        </div>

        {TABS.map((item) => {
          // While something is being looked for, the answers come from every
          // tab at once, so no one of them is the one you are on.
          const here = !looking && tab === item.id
          return (
          <button
            key={item.id}
            onClick={() => {
              setQuery('')
              setTab(item.id)
            }}
            className="flex items-center gap-2.5 px-2.5 py-2 text-left text-base"
            style={{
              borderRadius: 'var(--radius-sm)',
              background: here ? 'var(--surface-solid)' : 'transparent',
              boxShadow: here ? 'var(--shadow-sm)' : 'none',
              color: here ? 'var(--text)' : 'var(--text-dim)',
              fontWeight: here ? 500 : 400,
              transition: 'background var(--t-base) var(--ease-out), color var(--t-fast) linear, box-shadow var(--t-base) var(--ease-out)'
            }}
          >
            <span style={{ color: here ? 'var(--accent)' : 'inherit' }}>{item.icon}</span>
            {t(item.label)}
          </button>
          )
        })}
        <div className="flex-1" />
        <button
          onClick={onReset}
          className="px-2.5 py-2 text-left text-sm text-dim hover:bg-[var(--surface-hover)]"
          style={{ borderRadius: 'var(--radius-sm)', transition: 'background var(--t-fast) linear' }}
        >
          {t('Сбросить настройки')}
        </button>
      </nav>

      {/* content */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-end gap-3 p-3">
          {notice && <span className="animate-fade text-sm" style={{ color: 'var(--good)' }}>{notice}</span>}
          <button className="icon-btn" title={t('Закрыть · Esc')} onClick={onClose}>
            <Cross />
          </button>
        </div>

        <div
          key={looking ? 'looking' : tab}
          className="stagger mx-auto flex max-w-[720px] flex-col gap-7 px-6 pb-16"
        >
          {/* While something is being looked for, every tab is asked, and only
              the parts that answer are drawn. */}
          {looking ? (
            TABS.map((item) => (
              <div key={item.id} className="found">
                <button
                  className="found-where"
                  onClick={() => {
                    setQuery('')
                    setTab(item.id)
                  }}
                >
                  {t(item.label)}
                </button>
                {body(item.id)}
              </div>
            ))
          ) : (
            body(tab)
          )}
          {looking && (
            <p className="found-none py-10 text-center text-sm text-faint">
              {t('Ничего не найдено')}
            </p>
          )}
        </div>
      </div>

      {editProfile && (
        <ProfileDialog
          profile={editProfile}
          onClose={() => setEditProfile(null)}
          onSaved={() => {
            setEditProfile(null)
            flash(t('Профиль сохранён'))
          }}
        />
      )}

      {importOpen && (
        <ImportDialog
          onClose={() => setImportOpen(false)}
          onDone={(ok) => {
            setImportOpen(false)
            flash(ok ? t('Настройки применены') : t('Не удалось разобрать JSON'))
          }}
        />
      )}
    </div>
    </FullSettings.Provider>
    </Looking.Provider>
  )
}

/* ------------------------------------------------------------- dialogs */

/**
 * A picture can only be pushed as far as its overflow allows: at 1x it exactly
 * fills the circle and cannot move at all, and every step of zoom buys half a
 * step of travel in each direction. Without this the frame could be dragged
 * off the picture and leave a bare wedge of background.
 */
function clampCrop(crop: AvatarCrop): AvatarCrop {
  const room = Math.max(0, (crop.scale - 1) / 2)
  return {
    scale: crop.scale,
    x: Math.min(room, Math.max(-room, crop.x)),
    y: Math.min(room, Math.max(-room, crop.y))
  }
}

/** The circular viewport: drag the picture to choose what the circle shows. */
function AvatarCropper({
  picture,
  color,
  crop,
  onChange
}: {
  picture: string | null
  color: string
  crop: AvatarCrop
  onChange: (crop: AvatarCrop) => void
}) {
  const SIZE = 132
  const drag = useRef<{ id: number; x: number; y: number; from: AvatarCrop } | null>(null)

  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-pill"
      style={{
        width: SIZE,
        height: SIZE,
        background: `linear-gradient(140deg, ${color}, color-mix(in srgb, ${color} 55%, #000))`,
        boxShadow: 'var(--shadow-sm)',
        cursor: picture && crop.scale > 1 ? 'grab' : 'default',
        touchAction: 'none'
      }}
      onPointerDown={(event) => {
        if (!picture) return
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, from: crop }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const state = drag.current
        if (!state || state.id !== event.pointerId) return
        onChange(
          clampCrop({
            ...state.from,
            x: state.from.x + (event.clientX - state.x) / SIZE,
            y: state.from.y + (event.clientY - state.y) / SIZE
          })
        )
      }}
      onPointerUp={() => {
        drag.current = null
      }}
      onWheel={(event) => {
        if (!picture) return
        onChange(clampCrop({ ...crop, scale: Math.min(4, Math.max(1, crop.scale - event.deltaY / 600)) }))
      }}
    >
      {picture ? (
        <img src={picture} alt="" draggable={false} style={avatarImageStyle(crop)} />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-3xl">🖼️</div>
      )}
    </div>
  )
}

function ProfileDialog({
  profile,
  onClose,
  onSaved
}: {
  profile: Profile
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(profile.name)
  const [avatar, setAvatar] = useState(profile.avatar)
  const [crop, setCrop] = useState<AvatarCrop>(profile.crop ?? { x: 0, y: 0, scale: 1 })
  const [color, setColor] = useState(profile.color)
  const [choices, setChoices] = useState<{ avatars: string[]; colors: string[] }>({ avatars: [], colors: [] })
  const picture = avatarUrl(avatar)

  useEffect(() => {
    void window.browser.profileChoices().then(setChoices)
  }, [])

  // The picture is copied to disk the moment it is chosen, the way a file
  // dialog implies; the crop around it is what "Сохранить" commits.
  const readBack = (state: ProfilesState) => {
    const mine = state.profiles.find((p) => p.id === profile.id)
    if (!mine) return
    setAvatar(mine.avatar)
    setCrop(mine.crop ?? { x: 0, y: 0, scale: 1 })
  }

  return (
    <Modal
      title={t('Профиль')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('Отмена')}</button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              await window.browser.updateProfile(profile.id, {
                name,
                avatar,
                color,
                crop: avatar.startsWith('file:') ? crop : undefined
              })
              onSaved()
            }}
          >
            {t('Сохранить')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Avatar avatar={avatar} crop={crop} color={color} size={44} />
          <TextField value={name} onChange={setName} placeholder={t('Имя профиля')} width="100%" autoFocus />
        </div>

        <div className="flex gap-4">
          <AvatarCropper picture={picture} color={color} crop={crop} onChange={setCrop} />
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
            <p className="text-sm text-dim">
              {picture
                ? t('Тяните картинку, чтобы выбрать кадр, и меняйте масштаб ползунком. Анимация останется анимацией.')
                : t('Своя картинка или анимация — PNG, JPEG, WebP, GIF или AVIF.')}
            </p>
            {picture && (
              <Slider
                value={crop.scale}
                min={1}
                max={4}
                step={0.01}
                width={190}
                format={(value) => `${value.toFixed(1)}×`}
                onChange={(scale) => setCrop((c) => clampCrop({ ...c, scale }))}
              />
            )}
            <div className="flex gap-2">
              <button
                className="btn"
                onClick={async () => readBack(await window.browser.pickProfileAvatar(profile.id))}
              >
                {picture ? t('Заменить картинку') : t('Загрузить картинку')}
              </button>
              {picture && (
                <button
                  className="btn"
                  onClick={async () =>
                    readBack(
                      await window.browser.clearProfileAvatar(profile.id, choices.avatars[0] ?? '🐱')
                    )
                  }
                >
                  {t('Убрать')}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-dim">{t('Или значок')}</span>
          <div className="flex flex-wrap gap-1.5">
            {choices.avatars.map((value) => (
              <button
                key={value}
                onClick={() => setAvatar(value)}
                className="flex h-9 w-9 items-center justify-center rounded-[11px] text-lg"
                style={{
                  background: avatar === value ? 'color-mix(in srgb, var(--accent) 24%, transparent)' : 'var(--field-idle)',
                  transition: 'background var(--t-fast) linear, transform var(--t-fast) var(--ease-spring)'
                }}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-dim">{t('Цвет')}</span>
          <div className="flex flex-wrap gap-1.5">
            {choices.colors.map((value) => (
              <button
                key={value}
                onClick={() => setColor(value)}
                className="h-7 w-7 rounded-pill"
                style={{
                  background: value,
                  outline: color === value ? `2px solid ${value}` : 'none',
                  outlineOffset: 2
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: (ok: boolean) => void }) {
  const [json, setJson] = useState('')
  return (
    <Modal
      title={t('Импорт настроек')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('Отмена')}</button>
          <button
            className="btn btn-primary"
            onClick={async () => onDone(await window.browser.importSettings(json))}
          >
            {t('Применить')}
          </button>
        </>
      }
    >
      <textarea
        value={json}
        onChange={(event) => setJson(event.target.value)}
        placeholder='{"theme":"dark", ...}'
        className="field focus-ring w-full font-mono text-xs"
        style={{ height: 200, paddingTop: 8, resize: 'vertical' }}
      />
    </Modal>
  )
}
