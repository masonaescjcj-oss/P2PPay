import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource/vazirmatn/400.css'
import '@fontsource/vazirmatn/600.css'
import '@fontsource/vazirmatn/700.css'
import '@fontsource/vazirmatn/800.css'
import '@fontsource/noto-kufi-arabic/800.css'
import './styles/theme.css'
import './styles/app.css'
import App from './App.jsx'
import { AuthProvider } from './lib/auth.jsx'
import { PrefsProvider } from './lib/prefs.jsx'

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
