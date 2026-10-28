import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhTW from 'antd/locale/zh_TW'
import App from './App'
import { AuthProvider } from './auth/AuthContext'

async function boot() {
  // VITE_USE_MOCK=false 時不啟動假後端，請求直接打真實 API
  if (import.meta.env.VITE_USE_MOCK !== 'false') {
    const { worker } = await import('./mock/browser')
    await worker.start({
      serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
      onUnhandledRequest: 'bypass',
      quiet: true,
    })
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ConfigProvider locale={zhTW} theme={{ token: { colorPrimary: '#1d6fb8', borderRadius: 6 } }}>
        {/* HashRouter：純靜態託管不需要伺服器改寫規則 */}
        <HashRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </HashRouter>
      </ConfigProvider>
    </React.StrictMode>,
  )
}
void boot()
