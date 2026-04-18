import { useState, useEffect } from 'react'
import ScreenPage from './pages/ScreenPage'
import HistoryPage from './pages/HistoryPage'
import AlertsPage from './pages/AlertsPage'

type Tab = 'screen' | 'history' | 'alerts'

// ── Setup screen ──────────────────────────────────────────────────────────────

function SetupScreen({ onSave }: { onSave: (token: string) => void }) {
  const [value, setValue] = useState('')

  return (
    <div className="min-h-screen bg-red-700 flex flex-col items-center justify-center p-6 text-white">
      <div className="mb-8 text-center">
        <div className="text-7xl mb-4">🩺</div>
        <h1 className="text-4xl font-bold mb-2">NomaAlert</h1>
        <p className="text-red-200 text-sm max-w-xs">
          AI-powered Noma screening for community health workers in Sub-Saharan Africa
        </p>
      </div>

      <div className="w-full max-w-sm space-y-3">
        <label className="block text-sm font-semibold text-red-100">
          CHW Access Token
        </label>
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && value.trim() && onSave(value.trim())}
          placeholder="Enter your access token"
          className="w-full px-4 py-3 rounded-xl text-gray-900 text-base focus:outline-none focus:ring-2 focus:ring-white"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          disabled={!value.trim()}
          onClick={() => onSave(value.trim())}
          className="w-full py-3 bg-white text-red-700 font-bold rounded-xl disabled:opacity-40 text-base active:scale-95 transition-transform"
        >
          Start Screening →
        </button>
        <div className="flex items-center gap-3 my-2">
          <div className="flex-1 h-px bg-red-500" />
          <span className="text-red-300 text-xs">or</span>
          <div className="flex-1 h-px bg-red-500" />
        </div>
        <button
          onClick={() => onSave('demo')}
          className="w-full py-3 bg-red-800 text-white font-medium rounded-xl text-sm active:scale-95 transition-transform"
        >
          Use Demo Account
        </button>
        <p className="text-red-300 text-xs text-center pt-1">
          Demo token: <code className="font-mono bg-red-800 px-1 rounded">demo</code>
          &nbsp;— no Supabase needed
        </p>
      </div>

      <p className="mt-10 text-red-400 text-xs text-center max-w-xs">
        NomaAlert is a screening assistance tool. It is not a clinical diagnosis.
        Always consult a trained health professional.
      </p>
    </div>
  )
}

// ── Nav bar ───────────────────────────────────────────────────────────────────

interface NavBarProps {
  tab: Tab
  onTab: (t: Tab) => void
  alertCount: number
}

function NavBar({ tab, onTab, alertCount }: NavBarProps) {
  const items: [Tab, string, string][] = [
    ['screen', '📷', 'Screen'],
    ['history', '📋', 'History'],
    ['alerts', '🚨', 'Alerts'],
  ]

  return (
    <nav className="bg-white border-t border-gray-200 flex safe-bottom">
      {items.map(([id, icon, label]) => (
        <button
          key={id}
          onClick={() => onTab(id)}
          className={`flex-1 py-3 flex flex-col items-center gap-0.5 text-xs transition-colors relative
            ${tab === id ? 'text-red-700' : 'text-gray-500'}`}
        >
          <span className="text-xl leading-none">{icon}</span>
          <span className={tab === id ? 'font-semibold' : ''}>{label}</span>
          {id === 'alerts' && alertCount > 0 && (
            <span className="absolute top-2 right-[calc(50%-18px)] bg-red-600 text-white text-xs
              font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
              {alertCount > 9 ? '9+' : alertCount}
            </span>
          )}
        </button>
      ))}
    </nav>
  )
}

// ── Online / offline banner ───────────────────────────────────────────────────

function OfflineBanner({ online }: { online: boolean }) {
  if (online) return null
  return (
    <div className="bg-yellow-500 text-yellow-900 text-xs font-medium px-4 py-1.5 text-center">
      ⚠️ You are offline — results will be saved locally and synced when reconnected
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [token, setToken] = useState<string>(() => localStorage.getItem('chw_token') ?? '')
  const [tab, setTab] = useState<Tab>('screen')
  const [online, setOnline] = useState(navigator.onLine)
  const [unreadAlerts, setUnreadAlerts] = useState(0)

  // Track online / offline
  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // Persist token
  const handleSetToken = (t: string) => {
    localStorage.setItem('chw_token', t)
    setToken(t)
  }

  const handleLogout = () => {
    localStorage.removeItem('chw_token')
    setToken('')
  }

  if (!token) {
    return <SetupScreen onSave={handleSetToken} />
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col max-w-lg mx-auto shadow-xl">
      {/* Header */}
      <header className="bg-red-700 text-white px-4 pt-safe-top">
        <div className="flex items-center gap-3 py-3">
          <span className="text-2xl">🩺</span>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-lg leading-tight">NomaAlert</h1>
            <p className="text-xs text-red-200 truncate">
              Token: <code className="font-mono">{token.slice(0, 12)}{token.length > 12 ? '…' : ''}</code>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${online ? 'bg-green-400' : 'bg-yellow-400'}`} />
            <button
              onClick={handleLogout}
              className="text-xs text-red-300 px-2 py-1 rounded border border-red-500 active:bg-red-600 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <OfflineBanner online={online} />

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {tab === 'screen' && <ScreenPage />}
        {tab === 'history' && <HistoryPage />}
        {tab === 'alerts' && <AlertsPage onAlertsLoaded={setUnreadAlerts} />}
      </main>

      <NavBar tab={tab} onTab={setTab} alertCount={unreadAlerts} />
    </div>
  )
}
