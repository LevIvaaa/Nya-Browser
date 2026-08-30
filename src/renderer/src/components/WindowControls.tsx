import { useState } from 'react'
import { WinClose, WinMaximize, WinMinimize, WinRestore } from './Icons'

/**
 * Windows-style caption buttons, pinned to the top-right corner: same 46×32
 * hit targets, same hover tints and the same red close button users expect.
 */
export default function WindowControls({ maximized }: { maximized: boolean }) {
  const [hover, setHover] = useState<string | null>(null)

  const button = (
    id: 'min' | 'max' | 'close',
    label: string,
    icon: React.ReactNode,
    onClick: () => void
  ) => {
    const isClose = id === 'close'
    const active = hover === id
    return (
      <button
        aria-label={label}
        title={label}
        onClick={onClick}
        onMouseEnter={() => setHover(id)}
        onMouseLeave={() => setHover(null)}
        className="no-drag flex h-[34px] w-[46px] items-center justify-center transition-colors duration-100"
        style={{
          background: active ? (isClose ? '#c42b1c' : 'var(--surface-hover)') : 'transparent',
          color: active && isClose ? '#fff' : 'var(--text-dim)',
          borderTopRightRadius: isClose ? 10 : 0
        }}
      >
        {icon}
      </button>
    )
  }

  return (
    <div className="no-drag flex items-stretch self-start overflow-hidden">
      {button('min', 'Свернуть', <WinMinimize />, () => window.browser.minimize())}
      {button(
        'max',
        maximized ? 'Восстановить' : 'Развернуть',
        maximized ? <WinRestore /> : <WinMaximize />,
        () => window.browser.maximize()
      )}
      {button('close', 'Закрыть', <WinClose />, () => window.browser.close())}
    </div>
  )
}
