import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import OverlayApp from './OverlayApp'
import './styles/index.css'

/** Renders the failure instead of a blank window when something throws. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('UI crashed:', error.stack ?? error.message)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui', color: '#e5484d', whiteSpace: 'pre-wrap' }}>
        <h2>Интерфейс не загрузился</h2>
        <pre style={{ fontSize: 12 }}>{this.state.error.stack ?? this.state.error.message}</pre>
      </div>
    )
  }
}

window.addEventListener('error', (e) => console.error('window error:', e.message, e.filename, e.lineno))
window.addEventListener('unhandledrejection', (e) => console.error('unhandled rejection:', String(e.reason)))

// The same bundle serves both views: the chrome UI and the transparent
// overlay layer stacked above the page.
const isOverlay = new URLSearchParams(window.location.search).get('overlay') === '1'
if (isOverlay) document.documentElement.style.background = 'transparent'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>{isOverlay ? <OverlayApp /> : <App />}</ErrorBoundary>
  </StrictMode>
)
