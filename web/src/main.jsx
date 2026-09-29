import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource/manrope/latin-400.css'
import '@fontsource/manrope/latin-500.css'
import '@fontsource/manrope/latin-600.css'
import '@fontsource/manrope/latin-700.css'
import '@fontsource/manrope/latin-800.css'
import '@fontsource/vazirmatn/arabic-400.css'
import '@fontsource/vazirmatn/arabic-500.css'
import '@fontsource/vazirmatn/arabic-600.css'
import '@fontsource/vazirmatn/arabic-700.css'
import '@fontsource/vazirmatn/arabic-800.css'
import './styles/theme.css'
import './styles/app.css'
import App from './App.jsx'
import { AuthProvider } from './lib/auth.jsx'
import { PrefsProvider } from './lib/prefs.jsx'
import { registerServiceWorker, startInstallCapture } from './lib/install.js'
import { installErrorReporter } from './lib/report.js'

installErrorReporter()
startInstallCapture()
registerServiceWorker()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PrefsProvider>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </PrefsProvider>
  </StrictMode>
)
