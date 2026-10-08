import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@fontsource/rajdhani/400.css'
import '@fontsource/rajdhani/500.css'
import '@fontsource/rajdhani/600.css'
import '@fontsource/rajdhani/700.css'
import '@/index.css'
import 'katex/dist/katex.min.css'
import '@/components/logic/logic-renderer.css'
import { installAppTypography } from '@/styles/typography'

installAppTypography()

// "ResizeObserver loop completed with undelivered notifications" (and the older
// "ResizeObserver loop limit exceeded") are benign by spec: the browser simply
// defers the remaining notifications to the next frame. They are dispatched as a
// window `error` event with a NULL error object, which dev error overlays then
// surface as an uncaught crash ("an exception occurred but the error was not an
// error object"). Swallow ONLY these specific, harmless notifications — matched
// by exact message AND a null error object so a real, thrown error that happens
// to mention ResizeObserver still propagates untouched.
const BENIGN_RESIZE_OBSERVER_MESSAGES = new Set([
  'ResizeObserver loop completed with undelivered notifications.',
  'ResizeObserver loop limit exceeded',
])

window.addEventListener(
  'error',
  (e) => {
    if (e?.error == null && BENIGN_RESIZE_OBSERVER_MESSAGES.has(e?.message)) {
      e.stopImmediatePropagation()
      e.preventDefault()
    }
  },
  true,
)

// TEMPORARY harness switch — remove with SyncHarness.jsx.
const HARNESS = window.location.search.includes('syncharness')
const Harness = React.lazy(() => import('@/pages/SyncHarness.jsx'))


ReactDOM.createRoot(document.getElementById('root')).render(
  HARNESS ? (
    <React.Suspense fallback={null}>
      <Harness />
    </React.Suspense>
  ) : (
    <App />
  )
)
