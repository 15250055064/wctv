import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initServerSync } from './canvas/persistence'

initServerSync()

// Inside the Mac app the window has no system title bar; the CSS makes room for the traffic lights.
if (/Electron/.test(navigator.userAgent) && /Mac/.test(navigator.platform)) document.documentElement.classList.add('mac-app')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Dev-only handle for debugging the stores from the browser console.
if (import.meta.env.DEV) {
  Promise.all([import('./canvas/store'), import('./canvas/library'), import('./canvas/provider')]).then(([store, library, provider]) => {
    Object.assign(window, { __lc: { ...store, ...library, ...provider } });
  });
}
