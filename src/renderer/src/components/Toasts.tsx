import type { Toast } from '../state/useBrowser'

export default function Toasts({ items }: { items: Toast[] }) {
  if (items.length === 0) return null
  return (
    <div className="pointer-events-none absolute bottom-5 left-1/2 z-[70] flex -translate-x-1/2 flex-col items-center gap-2">
      {items.map((toast) => (
        <div
          key={toast.id}
          className="animate-toast rounded-pill px-4 py-2 text-sm font-medium"
          style={{
            background: 'var(--elevated)',
            border: '1px solid var(--line)',
            boxShadow: 'var(--shadow-lg)',
            backdropFilter: 'blur(24px) saturate(180%)'
          }}
        >
          {toast.message}
        </div>
      ))}
    </div>
  )
}
