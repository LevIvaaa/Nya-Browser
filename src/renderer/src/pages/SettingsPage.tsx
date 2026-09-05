import { availableLanguages, currentLanguage, t } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import type {
  AppInfo,
  AvatarCrop,
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
import logoUrl from '../assets/logo.png'
import {
  Alert,
  Cross,
  Download,
  Eraser,
  Film,
  Gear,
  Globe,
  Grid,
  Image,
  Key,
  Keyboard,
  LayoutHidden,
  LayoutLeft,
  LayoutRight,
  LayoutTop,
  Monitor,
  Moon,
  Palette,
  Plus,
  Refresh,
  Search,
  Shield,
  Sparkles,
  Sun,
  Trash,
  Users,
  Zap
} from '../components/Icons'
import {
  Avatar,
  ChoiceCard,
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
  cx
} from '../components/ui'

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
  { id: 'passwords', label: 'Пароли', icon: <Key width={15} height={15} /> },
  { id: 'speed', label: 'Скорость', icon: <Zap width={15} height={15} /> },
  { id: 'downloads', label: 'Загрузки', icon: <Download width={15} height={15} /> },
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
  if (!state.supported) {
    return state.error || t('Обновляться умеет только установленная версия, не портативная')
  }
  switch (state.stage) {
    case 'checking':
      return t('Спрашиваем GitHub…')
    case 'available':
      return t('Доступна версия {v} — загрузить?', { v: state.available ?? '' })
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
  const [notice, setNotice] = useState('')
  const [newDomain, setNewDomain] = useState('')
  const [newAllowed, setNewAllowed] = useState('')
  const [editProfile, setEditProfile] = useState<Profile | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [defaults, setDefaults] = useState<DefaultBrowserState | null>(null)
  const [sources, setSources] = useState<ImportSource[] | null>(null)
  const [filters, setFilters] = useState<FilterStatus | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [extensions, setExtensions] = useState<InstalledExtension[] | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [drm, setDrm] = useState<(WidevineState & { needsRestart: boolean }) | null>(null)

  useEffect(() => {
    void window.browser.appInfo().then(setInfo)
    void window.browser.vaultState().then(setVault)
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
    }
    if (tab === 'privacy') void window.browser.filterStatus().then(setFilters)
  }, [tab])

  const engine = engines.find((item) => item.id === settings.searchEngine) ?? engines[0]
  const bg = settings.background
  const flash = (message: string) => {
    setNotice(message)
    setTimeout(() => setNotice(''), 2600)
  }

  return (
    <div className="relative z-10 flex h-full min-h-0">
      {/* nav */}
      <nav className="contain flex w-[218px] shrink-0 flex-col gap-1 overflow-y-auto p-3" style={{ borderRight: '1px solid var(--line)' }}>
        <div className="px-2 pb-3 pt-1">
          <div className="text-[17px] font-semibold tracking-[-0.02em]">{t('Настройки')}</div>
          <div className="text-sm text-dim">Nya Browser</div>
        </div>
        {TABS.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-base"
            style={{
              background: tab === item.id ? 'var(--surface-solid)' : 'transparent',
              boxShadow: tab === item.id ? 'var(--shadow-sm)' : 'none',
              color: tab === item.id ? 'var(--text)' : 'var(--text-dim)',
              fontWeight: tab === item.id ? 500 : 400,
              transition: 'background var(--t-base) var(--ease-out), color var(--t-fast) linear, box-shadow var(--t-base) var(--ease-out)'
            }}
          >
            <span style={{ color: tab === item.id ? 'var(--accent)' : 'inherit' }}>{item.icon}</span>
            {t(item.label)}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={onReset}
          className="rounded-[10px] px-2.5 py-2 text-left text-sm text-dim hover:bg-[var(--surface-hover)]"
          style={{ transition: 'background var(--t-fast) linear' }}
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

        <div key={tab} className="animate-fade-up mx-auto flex max-w-[720px] flex-col gap-7 px-6 pb-16">
          {/* ---------------------------------------------------------- look */}
          {tab === 'look' && (
            <>
              <Section
                title={t('Язык браузера')}
                icon={<Globe width={15} height={15} />}
                description={t('Интерфейс, меню и язык, который сообщается сайтам')}
              >
                <Row
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
                <Row title={t('Оформление')}>
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
                <Row title={t('Акцентный цвет')} hint={t('Подсветка, активные элементы и процедурный фон')}>
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
                <Row title={t('Скругление углов')} hint={t('Вкладки, панели и окно страницы')}>
                  <Slider value={settings.radius} min={0} max={24} onChange={(value) => onPatch({ radius: value })} format={(v) => `${v}px`} />
                </Row>
                <Row title={t('Компактный режим')} hint={t('Меньше высота панелей и вкладок')}>
                  <Toggle checked={settings.compact} onChange={(value) => onPatch({ compact: value })} />
                </Row>
                <Row title={t('Эффект стекла')} hint={t('Насколько плотные панели, вкладки и карточки — обои под ними остаются как есть')}>
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

              <Section title={t('Движение')} icon={<Sparkles width={15} height={15} />} description={t('Скорость и плавность анимаций')}>
                <Row title={t('Скорость анимаций')} hint={t('1× — как задумано, меньше — быстрее и резче')}>
                  <Slider
                    value={settings.animationSpeed}
                    min={0.4}
                    max={2}
                    step={0.1}
                    onChange={(value) => onPatch({ animationSpeed: value })}
                    format={(v) => `${v.toFixed(1)}×`}
                  />
                </Row>
                <Row title={t('Меньше движения')} hint={t('Полностью отключает анимации интерфейса')}>
                  <Toggle checked={settings.reduceMotion} onChange={(value) => onPatch({ reduceMotion: value })} />
                </Row>
              </Section>
            </>
          )}

          {/* ----------------------------------------------------- wallpaper */}
          {tab === 'wallpaper' && (
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
                    <Row title={t('Файл обоев')} hint={bg.file || t('Файл ещё не выбран')}>
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
                    <Row title={t('Заполнение')}>
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
                    <Row title={t('Размытие')} hint={t('Чтобы текст поверх обоев читался лучше')}>
                      <Slider value={bg.blur} min={0} max={40} onChange={(blur) => onPatch({ background: { ...bg, blur } })} format={(v) => `${v}px`} />
                    </Row>
                    <Row title={t('Затемнение')}>
                      <Slider value={bg.dim} min={0} max={85} onChange={(dim) => onPatch({ background: { ...bg, dim } })} format={(v) => `${v}%`} />
                    </Row>
                  </>
                )}

                {bg.kind === 'video' && (
                  <>
                    <Row title={t('Скорость видео')}>
                      <Slider value={bg.speed} min={0.25} max={2} step={0.05} onChange={(speed) => onPatch({ background: { ...bg, speed } })} format={(v) => `${v.toFixed(2)}×`} />
                    </Row>
                    <Row title={t('Без звука')} hint={t('Видеообои почти всегда лучше без звука')}>
                      <Toggle checked={bg.muted} onChange={(muted) => onPatch({ background: { ...bg, muted } })} />
                    </Row>
                    <Row title={t('Пауза при просмотре сайта')} hint={t('Экономит заряд и процессор, пока обои не видно')}>
                      <Toggle checked={bg.pauseWhenBrowsing} onChange={(pauseWhenBrowsing) => onPatch({ background: { ...bg, pauseWhenBrowsing } })} />
                    </Row>
                  </>
                )}

                {['aurora', 'mesh', 'waves'].includes(bg.kind) && (
                  <Row title={t('Интенсивность')}>
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
          {tab === 'tabs' && (
            <>
              <Section title={t('Расположение')} icon={<LayoutTop width={15} height={15} />} description={t('Сверху или вертикально сбоку')}>
                <div className="flex gap-2 p-3">
                  <ChoiceCard value="top" current={settings.tabPosition} onSelect={(value) => onPatch({ tabPosition: value })} icon={<LayoutTop width={15} height={15} />} title={t('Сверху')} hint={t('Классическая полоса')} />
                  <ChoiceCard value="left" current={settings.tabPosition} onSelect={(value) => onPatch({ tabPosition: value })} icon={<LayoutLeft width={15} height={15} />} title={t('Слева')} hint={t('Вертикальный список')} />
                  <ChoiceCard value="right" current={settings.tabPosition} onSelect={(value) => onPatch({ tabPosition: value })} icon={<LayoutRight width={15} height={15} />} title={t('Справа')} hint={t('У правого края')} />
                </div>
                {settings.tabPosition !== 'top' ? (
                  <Row title={t('Ширина панели')}>
                    <Slider value={settings.railWidth} min={168} max={420} step={4} onChange={(value) => onPatch({ railWidth: value })} format={(v) => `${v}px`} />
                  </Row>
                ) : (
                  <Row title={t('Максимальная ширина вкладки')}>
                    <Slider value={settings.tabMaxWidth} min={120} max={420} step={10} onChange={(value) => onPatch({ tabMaxWidth: value })} format={(v) => `${v}px`} />
                  </Row>
                )}
                <Row title={t('Кнопка закрытия')}>
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
                <Row title={t('Автоскрытие интерфейса')} hint={t('Остаётся только страница; вернуть — курсор к краю или Ctrl+Shift+B')}>
                  <Toggle checked={settings.tabAutoHide} onChange={(value) => onPatch({ tabAutoHide: value })} />
                </Row>
                <Row title={t('Новая вкладка рядом с текущей')}>
                  <Toggle checked={settings.newTabAfterCurrent} onChange={(value) => onPatch({ newTabAfterCurrent: value })} />
                </Row>
                <Row title={t('Закрывать средней кнопкой мыши')}>
                  <Toggle checked={settings.middleClickClose} onChange={(value) => onPatch({ middleClickClose: value })} />
                </Row>
                <Row title={t('Подтверждать закрытие нескольких вкладок')}>
                  <Toggle checked={settings.confirmCloseMultiple} onChange={(value) => onPatch({ confirmCloseMultiple: value })} />
                </Row>
              </Section>
            </>
          )}

          {/* --------------------------------------------------------- start */}
          {tab === 'start' && (
            <Section title={t('Главная страница')} icon={<Sparkles width={15} height={15} />} description={t('Что показывать на стартовом экране')}>
              <Row title={t('Приветствие')}><Toggle checked={settings.startPage.greeting} onChange={(v) => onPatch({ startPage: { ...settings.startPage, greeting: v } })} /></Row>
              <Row title={t('Часы')}><Toggle checked={settings.startPage.clock} onChange={(v) => onPatch({ startPage: { ...settings.startPage, clock: v } })} /></Row>
              <Row title={t('Плитки избранного')}><Toggle checked={settings.startPage.favorites} onChange={(v) => onPatch({ startPage: { ...settings.startPage, favorites: v } })} /></Row>
              <Row title={t('Колонок в избранном')}>
                <Slider value={settings.startPage.columns} min={4} max={12} onChange={(v) => onPatch({ startPage: { ...settings.startPage, columns: v } })} width={120} />
              </Row>
              <Row title={t('Недавние страницы')}><Toggle checked={settings.startPage.recent} onChange={(v) => onPatch({ startPage: { ...settings.startPage, recent: v } })} /></Row>
              <Row title={t('Недавно закрытые вкладки')}><Toggle checked={settings.startPage.closed} onChange={(v) => onPatch({ startPage: { ...settings.startPage, closed: v } })} /></Row>
              <Row title={t('Счётчик защиты')}><Toggle checked={settings.startPage.stats} onChange={(v) => onPatch({ startPage: { ...settings.startPage, stats: v } })} /></Row>
              <Row title={t('Погода')} hint={t('Город выбирается в самом виджете; без него никуда ничего не уходит')}>
                <Toggle checked={settings.startPage.weather} onChange={(v) => onPatch({ startPage: { ...settings.startPage, weather: v } })} />
              </Row>
              <Row title={t('Шрифт главной')}>
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
              <Row title={t('Вид плиток')}>
                <Segmented
                  value={settings.startPage.tiles}
                  options={[
                    { value: 'card', label: t('Карточки') },
                    { value: 'icon', label: t('Значки') }
                  ]}
                  onChange={(v) => onPatch({ startPage: { ...settings.startPage, tiles: v as TileStyle } })}
                />
              </Row>
              <Row title={t('Форма плиток и карточек')}>
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
              <Row title={t('Подписи под значками')} hint={t('Выключите, чтобы на плитке остался только логотип сайта')}>
                <Toggle
                  checked={settings.startPage.tileLabels}
                  onChange={(v) => onPatch({ startPage: { ...settings.startPage, tileLabels: v } })}
                />
              </Row>
              <Row title={t('Цвет текста')} hint={settings.startPage.ink || t('По теме — тёмный на светлой, светлый на тёмной')}>
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
              <Row title={t('Расположение виджетов')} hint={t('Двигать и менять размер можно прямо на главной — кнопка «Настроить» в углу')}>
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
          {tab === 'search' && (
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
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-base font-medium">
                        {item.name}
                        <Pill tone={item.privacy === 'high' ? 'good' : item.privacy === 'medium' ? 'warn' : 'bad'}>
                          {item.privacy === 'high' ? t('приватный') : item.privacy === 'medium' ? t('средне') : t('трекинг')}
                        </Pill>
                      </span>
                      <span className="block truncate text-sm text-dim">{item.hint}</span>
                    </span>
                  </button>
                ))}
                {settings.searchEngine === 'custom' && (
                  <Row title={t('Адрес поиска')} hint={t('%s подставляется вместо запроса')}>
                    <TextField value={settings.customSearchUrl} onChange={(v) => onPatch({ customSearchUrl: v })} width={300} mono />
                  </Row>
                )}
              </Section>

              <Section title={t('Адресная строка')} icon={<Search width={15} height={15} />}>
                <Row title={t('Подсказки из истории')} hint={t('Подсказки строятся локально и никуда не отправляются')}>
                  <Toggle checked={settings.historySuggestions} onChange={(v) => onPatch({ historySuggestions: v })} />
                </Row>
                <Row title={t('Домашняя страница')} hint={t('Открывается по кнопке «домой»; пусто — стартовый экран')}>
                  <TextField value={settings.homepage} onChange={(v) => onPatch({ homepage: v })} placeholder="https://" width={260} />
                </Row>
                <Row title={t('Текущий движок')}>
                  <span className="text-sm text-dim">{engine?.name}</span>
                </Row>
              </Section>
            </>
          )}

          {/* ------------------------------------------------------ profiles */}
          {tab === 'profiles' && profiles && (
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
                    <div className="flex items-center gap-2 text-base font-medium">
                      {profile.name}
                      {profile.id === profiles.activeId && <Pill tone="accent">{t('активный')}</Pill>}
                    </div>
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
          {tab === 'privacy' && (
            <>
              <Section
                title={t('Блокировка')}
                icon={<Shield width={15} height={15} />}
                description={t('С запуска заблокировано: {n}', { n: stats.ads + stats.trackers + stats.crypto })}
              >
                <Row title={t('Реклама')} hint={t('Рекламные сети отсекаются до сетевого запроса')}>
                  <Toggle checked={settings.blockAds} onChange={(v) => onPatch({ blockAds: v })} />
                </Row>
                <Row title={t('Трекеры')} hint={t('Аналитика, пиксели, запись сессий')}>
                  <Toggle checked={settings.blockTrackers} onChange={(v) => onPatch({ blockTrackers: v })} />
                </Row>
                <Row title={t('Майнеры')} hint={t('Скрипты, считающие криптовалюту на вашем процессоре')}>
                  <Toggle checked={settings.blockCrypto} onChange={(v) => onPatch({ blockCrypto: v })} />
                </Row>
                <Row title={t('Убирать метки из ссылок')} hint={t('utm_*, fbclid, gclid, yclid и ещё около 60')}>
                  <Toggle checked={settings.stripTrackingParams} onChange={(v) => onPatch({ stripTrackingParams: v })} />
                </Row>
              </Section>

              <Section
                title={t('Списки фильтров')}
                icon={<Shield width={15} height={15} />}
                description={t('EasyList и другие правила поверх встроенного списка доменов — без них реклама на YouTube и баннеры на сайтах остаются')}
              >
                <Row
                  title={t('Использовать списки фильтров')}
                  hint={
                    filters?.enabled
                      ? t('{a} сетевых правил, {b} косметических', { a: filters.rules.toLocaleString(), b: filters.cosmetic.toLocaleString() })
                      : t('Списки скачиваются один раз и обновляются раз в 5 дней')
                  }
                >
                  <Toggle checked={settings.filterLists} onChange={(v) => onPatch({ filterLists: v })} />
                </Row>
                <Row title={t('Прятать пустые блоки')} hint={t('Скрывает рамки и заглушки, оставшиеся от заблокированной рекламы')}>
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
                        flash(t('Списки обновлены'))
                      } finally {
                        setRefreshing(false)
                      }
                    }}
                  >
                    {refreshing ? t('Обновляем…') : t('Обновить сейчас')}
                  </button>
                </Row>
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
                <Row title={t('Блокировать домен')}>
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
                <Row title={t('Никогда не блокировать')} hint={t('Если блокировка что-то ломает на конкретном сайте')}>
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

              <Section title={t('Соединение и данные')} icon={<Shield width={15} height={15} />}>
                <Row title={t('Только HTTPS')} hint={t('HTTP повышается автоматически; исключение можно подтвердить вручную')}>
                  <Toggle checked={settings.httpsOnly} onChange={(v) => onPatch({ httpsOnly: v })} />
                </Row>
                <Row title={t('Блокировать сторонние cookie')} hint={t('Разрывает сквозную слежку между сайтами')}>
                  <Toggle checked={settings.blockThirdPartyCookies} onChange={(v) => onPatch({ blockThirdPartyCookies: v })} />
                </Row>
                <Row title={t('Заголовки DNT и Sec-GPC')}>
                  <Toggle checked={settings.doNotTrack} onChange={(v) => onPatch({ doNotTrack: v })} />
                </Row>
                <Row title="WebRTC" hint={t('Ограничивает утечку локальных IP-адресов через видеозвонки')}>
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
                <Row title={t('Сохранять историю')}>
                  <Toggle checked={settings.saveHistory} onChange={(v) => onPatch({ saveHistory: v })} />
                </Row>
                <Row title={t('Очищать данные при выходе')} hint={t('Cookies, кэш и история удаляются при закрытии')}>
                  <Toggle checked={settings.clearOnExit} onChange={(v) => onPatch({ clearOnExit: v })} />
                </Row>
              </Section>

              <Section title={t('Доступ сайтов к устройствам')} icon={<Alert width={15} height={15} />} description={t('По умолчанию всё спрашивается или запрещается')}>
                {PERMISSION_ROWS.map((row) => (
                  <Row key={row.key} title={t(row.title)} hint={t(row.hint)}>
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
          {tab === 'passwords' && (
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
            </Section>
          )}

          {/* --------------------------------------------------------- speed */}
          {tab === 'speed' && (
            <>
              <Section title={t('Ускорение')} icon={<Zap width={15} height={15} />} description={t('Часть параметров вступает в силу после перезапуска')}>
                <Row title={t('Аппаратное ускорение')} hint={t('Отрисовка и декодирование видео на видеокарте')}>
                  <Toggle checked={settings.hardwareAcceleration} onChange={(v) => onPatch({ hardwareAcceleration: v })} />
                </Row>
                <Row title={t('Предподключение')} hint={t('TLS-соединение устанавливается ещё до клика по ссылке')}>
                  <Toggle checked={settings.preconnect} onChange={(v) => onPatch({ preconnect: v })} />
                </Row>
                <Row title={t('Предзагрузка DNS')}>
                  <Toggle checked={settings.prefetchDns} onChange={(v) => onPatch({ prefetchDns: v })} />
                </Row>
                <Row title={t('Плавная прокрутка')}>
                  <Toggle checked={settings.smoothScrolling} onChange={(v) => onPatch({ smoothScrolling: v })} />
                </Row>
                <Row title={t('Размер кэша')}>
                  <Slider value={settings.cacheSizeMb} min={128} max={4096} step={128} onChange={(v) => onPatch({ cacheSizeMb: v })} format={(v) => (v >= 1024 ? `${(v / 1024).toFixed(1)} ГБ` : `${v} МБ`)} />
                </Row>
                <Row title={t('Масштаб страниц по умолчанию')}>
                  <Slider value={settings.defaultZoom} min={-3} max={4} step={0.5} onChange={(v) => onPatch({ defaultZoom: v })} format={(v) => `${Math.round(1.2 ** v * 100)}%`} />
                </Row>
              </Section>

              <Section title={t('Память')} icon={<Zap width={15} height={15} />}>
                <Row title={t('Усыплять фоновые вкладки')} hint={t('Освобождает память неактивных вкладок')}>
                  <Toggle checked={settings.sleepBackgroundTabs} onChange={(v) => onPatch({ sleepBackgroundTabs: v })} />
                </Row>
                {settings.sleepBackgroundTabs && (
                  <Row title={t('Засыпать через')}>
                    <Slider value={settings.sleepAfterMinutes} min={1} max={120} onChange={(v) => onPatch({ sleepAfterMinutes: v })} format={(v) => `${v} мин`} />
                  </Row>
                )}
                <Row title={t('Восстанавливать вкладки при запуске')}>
                  <Toggle checked={settings.restoreSession} onChange={(v) => onPatch({ restoreSession: v })} />
                </Row>
                <Row title={t('Ленивое восстановление')} hint={t('При старте грузится только активная вкладка')}>
                  <Toggle checked={settings.lazyRestore} onChange={(v) => onPatch({ lazyRestore: v })} />
                </Row>
              </Section>
            </>
          )}

          {/* ----------------------------------------------------- downloads */}
          {tab === 'downloads' && (
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
              <Row title={t('Спрашивать, куда сохранять')} hint={t('Диалог для каждого файла')}>
                <Toggle checked={settings.askWhereToSave} onChange={(v) => onPatch({ askWhereToSave: v })} />
              </Row>
            </Section>
          )}

          {/* ---------------------------------------------------------- data */}
          {tab === 'data' && (
            <>
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
          {tab === 'system' && (
            <>
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

              <Section
                title={t('Защищённое видео')}
                icon={<Film width={15} height={15} />}
                description={t('Widevine — без него Netflix, Spotify и Кинопоиск не играют')}
              >
                <Row
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
                  title={t('Установить')}
                  hint={t('Работает всё на content-скриптах: Dark Reader, Stylus и подобные. Блокировщики рекламы и менеджеры паролей — нет: Electron не даёт расширениям ни блокирующий webRequest, ни кнопку на панели')}
                >
                  <button
                    className="btn btn-primary"
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
          {tab === 'about' && (
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
                <Row title={t('Правил в списке блокировки')}><span className="text-sm text-dim">{info?.blocklistSize ?? '—'}</span></Row>
                <Row title={t('Проверка безопасности')} hint={t('Живые тесты изоляции, блокировки и разрешений')}>
                  <button className="btn btn-primary" onClick={() => window.browser.newTab('nya://security')}>
                    <Shield width={15} height={15} />
                    {t('Запустить')}
                  </button>
                </Row>
              </Section>

              <Section title={t('Горячие клавиши')} icon={<Keyboard width={15} height={15} />}>
                {[
                  ['Ctrl+T / Ctrl+W', t('Новая вкладка / закрыть')],
                  ['Ctrl+Shift+T', t('Вернуть закрытую вкладку')],
                  ['Ctrl+L, Alt+D, F6', t('Адресная строка')],
                  ['Ctrl+D', t('Добавить в закладки')],
                  ['Ctrl+F', t('Поиск по странице')],
                  ['Ctrl+J / Ctrl+H', t('Загрузки / история')],
                  ['Ctrl+Shift+O', t('Закладки')],
                  ['Ctrl+Shift+B', t('Автоскрытие панелей')],
                  ['Ctrl+Tab', t('Следующая вкладка')],
                  ['Ctrl+1…9', t('Перейти к вкладке')],
                  ['Ctrl + / −  / 0', t('Масштаб страницы')],
                  ['F11 / F12', t('Полный экран / DevTools')]
                ].map(([keys, label]) => (
                  <Row key={keys} title={label}>
                    <kbd className="rounded-[7px] px-2 py-1 text-2xs" style={{ background: 'var(--field-idle)' }}>{keys}</kbd>
                  </Row>
                ))}
              </Section>
            </>
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
