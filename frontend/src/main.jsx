import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { loadTheme, applyTheme } from './components/CommunicationBoard/boardSettings'

/*
 * Apply the saved theme BEFORE React renders, so a dark-mode user never
 * sees a flash of the light interface on load.
 */
applyTheme(loadTheme())

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
