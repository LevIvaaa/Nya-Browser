import type { Toast } from '../state/useBrowser'

export default function Toasts({ items }: { items: Toast[] }) {
  if (items.length === 0) return null
  return (
    <div className="pointer-events-none absolute bottom-5 left-1/2 z-[70] flex -translate-x-1/2 flex-col items-center gap-2">
      {items.map((toast) => (
        <div
          key={toast.id}
          className={`${toast.going ? 'animate-toast-out' : 'animate-toast'} pointer-events-auto rounded-pill py-2 pl-4 text-sm font-medium ${toast.action ? 'pr-2' : 'pr-4'}`}
          style={{
            background: 'var(--elevated)',
            border: '1px solid var(--line)',
            boxShadow: 'var(--shadow-lg)',
            backdropFilter: 'blur(24px) saturate(180%)'
          }}
        >
          <span className="align-middle">{toast.message}</span>
          {toast.action && (
            <button
              className="ml-2.5 align-middle rounded-pill px-2.5 py-[3px] text-2xs font-semibold"
              style={{ color: 'var(--accent)', background: 'var(--accent-soft)' }}
              onClick={() => void window.browser.toastAction(toast.action!.id)}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
