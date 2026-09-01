import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>

/** All icons share one geometry so the chrome reads as a single set. */
const svg = (p: P, strokeWidth = 1.7) => ({
  width: 17,
  height: 17,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...p
})

export const ArrowLeft = (p: P) => (
  <svg {...svg(p)}>
    <path d="M15 19l-7-7 7-7" />
  </svg>
)
export const ArrowRight = (p: P) => (
  <svg {...svg(p)}>
    <path d="M9 5l7 7-7 7" />
  </svg>
)
export const Reload = (p: P) => (
  <svg {...svg(p)}>
    <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
    <path d="M20.5 4.5V10H15" />
  </svg>
)
export const Cross = (p: P) => (
  <svg {...svg(p)}>
    <path d="M17.5 6.5l-11 11M6.5 6.5l11 11" />
  </svg>
)
export const Plus = (p: P) => (
  <svg {...svg(p)}>
    <path d="M12 5.5v13M5.5 12h13" />
  </svg>
)
export const Home = (p: P) => (
  <svg {...svg(p)}>
    <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" />
  </svg>
)
export const Search = (p: P) => (
  <svg {...svg(p)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m19.5 19.5-3.6-3.6" />
  </svg>
)
export const Lock = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <rect x="5.5" y="10.5" width="13" height="9" rx="2.5" />
    <path d="M8.5 10.5V8a3.5 3.5 0 1 1 7 0v2.5" />
  </svg>
)
export const Unlock = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <rect x="5.5" y="10.5" width="13" height="9" rx="2.5" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.4-2" />
  </svg>
)
export const Shield = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <path d="M12 3.5 19 6v5.6c0 4.3-2.9 7.4-7 8.9-4.1-1.5-7-4.6-7-8.9V6z" />
  </svg>
)
export const ShieldCheck = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <path d="M12 3.5 19 6v5.6c0 4.3-2.9 7.4-7 8.9-4.1-1.5-7-4.6-7-8.9V6z" />
    <path d="m9.2 11.8 2 2 3.6-3.9" />
  </svg>
)
export const Globe = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.2 2.4 3.3 5.3 3.3 8.5S14.2 18.1 12 20.5c-2.2-2.4-3.3-5.3-3.3-8.5S9.8 5.9 12 3.5z" />
  </svg>
)
export const Gear = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.2a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.2a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.2a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.2a1.6 1.6 0 0 0-1.5 1z" />
  </svg>
)
export const Sun = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
  </svg>
)
export const Moon = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.5 8.5 0 1 0 20 14.2z" />
  </svg>
)
export const Monitor = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <rect x="3" y="4.5" width="18" height="12" rx="2.5" />
    <path d="M8.5 20h7M12 16.5V20" />
  </svg>
)
export const Volume = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <path d="M11 5.5 6.5 9.5H4v5h2.5L11 18.5z" />
    <path d="M15 9.5a3.5 3.5 0 0 1 0 5M17.6 7a7 7 0 0 1 0 10" />
  </svg>
)
export const VolumeOff = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <path d="M11 5.5 6.5 9.5H4v5h2.5L11 18.5z" />
    <path d="m15.5 10 4 4M19.5 10l-4 4" />
  </svg>
)
export const Download = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <path d="M12 4v10.5M8 11l4 4 4-4" />
    <path d="M5 18.5h14" />
  </svg>
)
/** A hat and glasses: the shorthand every browser uses for a private window. */
export const Incognito = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <path d="M4 12.5h16" />
    <path d="M7.5 12.5 9 6.2a1.6 1.6 0 0 1 2-1.1l1 .3 1-.3a1.6 1.6 0 0 1 2 1.1l1.5 6.3" />
    <circle cx="7.8" cy="16.4" r="2.6" />
    <circle cx="16.2" cy="16.4" r="2.6" />
    <path d="M10.4 16.4c.5-.5 2.7-.5 3.2 0" />
  </svg>
)
export const UpdateArrow = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8v7.5M8.8 12.3 12 15.5l3.2-3.2" />
  </svg>
)
export const Clock = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 1.8" />
  </svg>
)
export const Trash = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <path d="M4.5 7h15M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" />
    <path d="M6.5 7l.8 12A1.5 1.5 0 0 0 8.8 20.5h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12" />
  </svg>
)
export const Check = (p: P) => (
  <svg {...svg(p, 2)}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </svg>
)
export const ChevronDown = (p: P) => (
  <svg {...svg(p)}>
    <path d="m6 9.5 6 6 6-6" />
  </svg>
)
export const ChevronRight = (p: P) => (
  <svg {...svg(p)}>
    <path d="m9.5 6 6 6-6 6" />
  </svg>
)
export const Sparkles = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9z" />
    <path d="M18.5 4v3M20 5.5h-3M6 16.5v2.5M7.2 17.8H4.8" />
  </svg>
)
export const Zap = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <path d="M13.5 3 5.5 13.5H11l-.5 7.5 8-10.5H13z" />
  </svg>
)
export const Sleep = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <path d="M14 4.5h6l-6 7h6" />
    <path d="M4 13h5l-5 6h5" />
  </svg>
)
export const Grid = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
  </svg>
)
export const More = (p: P) => (
  <svg {...svg(p, 2)}>
    <circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </svg>
)
export const Copy = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
    <path d="M15.5 5.5A2 2 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7a2 2 0 0 0 1.5 1.9" />
  </svg>
)
export const External = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <path d="M14 4.5h5.5V10" />
    <path d="M19.5 4.5 11 13" />
    <path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
  </svg>
)
export const Palette = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.4-.5-.7-.5-1.2 0-.9.8-1.6 1.7-1.6h1.3a4.7 4.7 0 0 0 4.7-4.7c0-3.8-3.7-6.6-8.5-6.6z" />
    <circle cx="8" cy="10.5" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="7.8" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="16" cy="10.2" r="1.1" fill="currentColor" stroke="none" />
  </svg>
)
export const Eye = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)
export const EyeOff = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <path d="M4 4l16 16" />
    <path d="M9.9 5.9A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.3 4.1M6.5 7.9A17 17 0 0 0 2.5 12S6 18.5 12 18.5c1 0 1.9-.2 2.7-.5" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </svg>
)

/* --- layout pickers ------------------------------------------------------ */
export const LayoutTop = (p: P) => (
  <svg {...svg(p, 1.5)}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M3 9.5h18" />
    <path d="M7 6.8h3.5" strokeWidth={2.4} />
  </svg>
)
export const LayoutLeft = (p: P) => (
  <svg {...svg(p, 1.5)}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M9.5 4v16" />
    <path d="M5.4 8h2.6M5.4 11h2.6" strokeWidth={2.2} />
  </svg>
)
export const LayoutRight = (p: P) => (
  <svg {...svg(p, 1.5)}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M14.5 4v16" />
    <path d="M16 8h2.6M16 11h2.6" strokeWidth={2.2} />
  </svg>
)
export const LayoutHidden = (p: P) => (
  <svg {...svg(p, 1.5)}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M3 7.5h18" strokeDasharray="2.5 2.5" />
  </svg>
)

/* --- Windows-style caption controls (crisp at 1x, no stroke rounding) ---- */
export const WinMinimize = (p: P) => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" {...p}>
    <path d="M0 5.2h10" stroke="currentColor" strokeWidth="1" />
  </svg>
)
export const WinMaximize = (p: P) => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" {...p}>
    <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" rx="1.4" />
  </svg>
)
export const WinRestore = (p: P) => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" {...p}>
    <rect x="0.5" y="2.5" width="7" height="7" stroke="currentColor" strokeWidth="1" rx="1.2" />
    <path d="M2.6 2.2V1.9A1.4 1.4 0 0 1 4 0.5h4.1A1.4 1.4 0 0 1 9.5 1.9V6a1.4 1.4 0 0 1-1.4 1.4h-.3" stroke="currentColor" strokeWidth="1" />
  </svg>
)
export const WinClose = (p: P) => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" {...p}>
    <path d="M0.6 0.6l8.8 8.8M9.4 0.6L0.6 9.4" stroke="currentColor" strokeWidth="1" />
  </svg>
)

export const Star = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <path d="m12 4 2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-3.9 5.6-.8z" />
  </svg>
)
export const StarFilled = (p: P) => (
  <svg {...svg(p, 1.6)} fill="currentColor">
    <path d="m12 4 2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-3.9 5.6-.8z" />
  </svg>
)
export const Key = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <circle cx="8" cy="15" r="3.6" />
    <path d="m10.6 12.4 7-7M15.5 6.5l2 2M18 4l2.5 2.5" />
  </svg>
)
export const LockOpen = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <rect x="5.5" y="10.5" width="13" height="9" rx="2.5" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.8-1.2" />
  </svg>
)
export const User = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <circle cx="12" cy="8.5" r="3.6" />
    <path d="M5 20c.9-3.4 3.6-5.2 7-5.2s6.1 1.8 7 5.2" />
  </svg>
)
export const Users = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <circle cx="9.5" cy="9" r="3.2" />
    <path d="M3.5 19.5c.8-3 3.1-4.6 6-4.6s5.2 1.6 6 4.6" />
    <path d="M16.5 6.4a3.2 3.2 0 0 1 0 6.2M17.5 15.2c2.1.5 3.4 1.9 4 4.3" />
  </svg>
)
export const Image = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m4.5 17.5 4.6-4.3 3.2 2.9 2.7-2.4 4.5 3.8" />
  </svg>
)
export const Film = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <rect x="3.5" y="5" width="17" height="14" rx="3" />
    <path d="M8 5v14M16 5v14M3.5 12h17" />
  </svg>
)
export const Folder = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <path d="M3.5 8a2 2 0 0 1 2-2h3.2l1.8 2.2h6a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z" />
  </svg>
)
export const Pause = (p: P) => (
  <svg {...svg(p, 1.8)}>
    <path d="M9 5.5v13M15 5.5v13" />
  </svg>
)
export const Play = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <path d="M7.5 5.5 18 12 7.5 18.5z" />
  </svg>
)
export const Shuffle = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <path d="M4 7h3.5l3 4M20 7h-4l-8 10H4M20 17h-4" />
    <path d="M17.5 4.5 20 7l-2.5 2.5M17.5 14.5 20 17l-2.5 2.5" />
  </svg>
)
export const Refresh = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5" />
    <path d="M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.6L4 15.5" />
    <path d="M4 20v-4.5h4.5" />
  </svg>
)
export const Info = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5M12 7.8h.01" />
  </svg>
)
export const Alert = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <path d="M12 4.5 21 19.5H3z" />
    <path d="M12 10v4M12 17h.01" />
  </svg>
)
export const Keyboard = (p: P) => (
  <svg {...svg(p, 1.5)}>
    <rect x="2.5" y="6.5" width="19" height="11" rx="2.5" />
    <path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M6.5 13.5h11" />
  </svg>
)
export const Wand = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <path d="M5 19 15.5 8.5M14 5.5l1.2 2.3 2.3 1.2-2.3 1.2L14 12.5l-1.2-2.3L10.5 9l2.3-1.2z" />
    <path d="M19 14.5l.7 1.3 1.3.7-1.3.7-.7 1.3-.7-1.3-1.3-.7 1.3-.7z" />
  </svg>
)
export const Eraser = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <path d="m6.5 17.5-2-2a2 2 0 0 1 0-2.8l7-7a2 2 0 0 1 2.8 0l4 4a2 2 0 0 1 0 2.8l-5 5z" />
    <path d="M9 20h11" />
  </svg>
)
export const Pencil = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <path d="M4.5 19.5h4l10-10a2.1 2.1 0 0 0-3-3l-10 10z" />
    <path d="m14.5 6.5 3 3" />
  </svg>
)
export const Printer = (p: P) => (
  <svg {...svg(p, 1.6)}>
    <path d="M7 9V4.5h10V9" />
    <rect x="4" y="9" width="16" height="7" rx="2" />
    <path d="M7 14h10v5.5H7z" />
  </svg>
)
