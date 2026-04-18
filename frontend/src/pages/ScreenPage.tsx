import { useState, useRef, useCallback } from 'react'
import { screen as apiScreen, type ScreenResult, type ChildMeta, type Sex } from '../lib/api'
import { saveCase } from '../lib/db'
import TriageCard from '../components/TriageCard'

type Step = 'capture' | 'form' | 'loading' | 'result' | 'error'

const TRIAGE_CONFIG = {
  urgent:  { bg: 'bg-red-600',    border: 'border-red-600',    text: 'URGENT',  sub: 'Emergency hospital referral NOW' },
  refer:   { bg: 'bg-orange-500', border: 'border-orange-500', text: 'REFER',   sub: 'Refer to clinic within 48 hours' },
  monitor: { bg: 'bg-yellow-500', border: 'border-yellow-500', text: 'MONITOR', sub: 'Monitor closely, re-screen in 3 days' },
  healthy: { bg: 'bg-green-600',  border: 'border-green-600',  text: 'HEALTHY', sub: 'No immediate action required' },
} as const

export default function ScreenPage() {
  const [step, setStep]       = useState<Step>('capture')
  const [imageB64, setImageB64] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [meta, setMeta]       = useState<ChildMeta>({ age_months: 12, sex: 'unknown' })
  const [result, setResult]   = useState<ScreenResult | null>(null)
  const [error, setError]     = useState('')
  const [geo, setGeo]         = useState<{ lat: number; lng: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // ── Camera capture ──────────────────────────────────────────────────────────

  const handleCapture = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Revoke old object URL to avoid memory leaks
    if (imageUrl) URL.revokeObjectURL(imageUrl)

    const url = URL.createObjectURL(file)
    setImageUrl(url)

    const reader = new FileReader()
    reader.onload = () => {
      // Strip "data:image/jpeg;base64," prefix — backend expects raw b64
      const b64 = (reader.result as string).split(',')[1]
      setImageB64(b64)
      setStep('form')
    }
    reader.readAsDataURL(file)
  }, [imageUrl])

  // ── Geolocation ─────────────────────────────────────────────────────────────

  const getLocation = () => {
    navigator.geolocation?.getCurrentPosition(
      pos => setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { /* silently fail — location is optional */ },
      { timeout: 5000, enableHighAccuracy: false },
    )
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!imageB64) return
    setStep('loading')
    try {
      const chwId = localStorage.getItem('chw_id') ?? '11111111-0000-0000-0000-000000000001'
      const res = await apiScreen({
        image_b64: imageB64,
        child_meta: meta,
        chw_id: chwId,
        ...(geo ?? {}),
      })
      await saveCase(res, meta, imageB64)
      setResult(res)
      setStep('result')
    } catch (err) {
      setError((err as Error).message)
      setStep('error')
    }
  }

  // ── Reset ───────────────────────────────────────────────────────────────────

  const reset = () => {
    setStep('capture')
    setImageB64('')
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    setImageUrl('')
    setMeta({ age_months: 12, sex: 'unknown' })
    setResult(null)
    setError('')
    setGeo(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (step === 'result' && result) {
    return (
      <div className="flex flex-col h-full">
        {result.mock && (
          <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2 text-xs text-yellow-800 flex items-center gap-2">
            ⚠️ <span>Demo mode — result is simulated, not a clinical analysis</span>
          </div>
        )}
        <div className="flex-1 overflow-auto">
          <TriageCard result={result} imageUrl={imageUrl} />
        </div>
        <div className="p-4 border-t bg-white safe-bottom">
          <button
            onClick={reset}
            className="w-full py-3 bg-red-700 text-white font-bold rounded-xl text-base active:bg-red-800"
          >
            📷 New Screening
          </button>
        </div>
      </div>
    )
  }

  if (step === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
        <div className="w-20 h-20 border-4 border-red-700 border-t-transparent rounded-full animate-spin" />
        <div className="text-center">
          <p className="font-semibold text-gray-800 text-lg">Analyzing image…</p>
          <p className="text-sm text-gray-500 mt-1">Running 3-stage AI pipeline</p>
          <div className="mt-4 space-y-1 text-left w-48">
            {[
              ['🔬', 'VM 1: Visual staging'],
              ['🧠', 'VM 2: Clinical reasoning'],
              ['🏥', 'VM 3: Referral routing'],
            ].map(([icon, label]) => (
              <div key={label} className="flex items-center gap-2 text-xs text-gray-500">
                <span>{icon}</span><span>{label}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-gray-400">Usually takes 8–15 seconds</p>
      </div>
    )
  }

  if (step === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 p-8 text-center">
        <span className="text-6xl">⚠️</span>
        <div>
          <p className="font-bold text-gray-800 text-lg">Analysis failed</p>
          <p className="text-sm text-gray-500 mt-2 break-words">{error}</p>
        </div>
        <button
          onClick={reset}
          className="w-full max-w-xs py-3 bg-red-700 text-white font-bold rounded-xl"
        >
          Try Again
        </button>
        <p className="text-xs text-gray-400">Check your connection and token</p>
      </div>
    )
  }

  if (step === 'form') {
    return (
      <div className="flex flex-col h-full overflow-auto">
        {/* Image preview */}
        <div className="relative bg-black">
          <img
            src={imageUrl}
            alt="Captured"
            className="w-full max-h-52 object-contain"
          />
          <button
            onClick={() => { setStep('capture'); if (fileRef.current) fileRef.current.value = '' }}
            className="absolute top-2 right-2 bg-black/60 text-white rounded-full w-8 h-8 flex items-center justify-center text-lg"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 p-4 space-y-5 overflow-auto pb-28">
          <h2 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Child Information</h2>

          {/* Age */}
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              Age <span className="text-red-600">*</span>
            </label>
            <div className="flex gap-2 items-center">
              <input
                type="number"
                min={0}
                max={216}
                value={meta.age_months}
                onChange={e => setMeta(m => ({ ...m, age_months: Number(e.target.value) }))}
                className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-base text-center"
              />
              <span className="text-sm text-gray-500">months
                {meta.age_months >= 12 && (
                  <span className="text-gray-400"> ({Math.floor(meta.age_months / 12)}y {meta.age_months % 12}m)</span>
                )}
              </span>
            </div>
          </div>

          {/* Sex */}
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Sex</label>
            <div className="flex gap-2">
              {(['male', 'female', 'unknown'] as Sex[]).map(s => (
                <button
                  key={s}
                  onClick={() => setMeta(m => ({ ...m, sex: s }))}
                  className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors capitalize ${
                    meta.sex === s
                      ? 'bg-red-700 border-red-700 text-white'
                      : 'bg-white border-gray-300 text-gray-600'
                  }`}
                >
                  {s === 'male' ? '👦' : s === 'female' ? '👧' : '❓'} {s}
                </button>
              ))}
            </div>
          </div>

          {/* Symptoms */}
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              Presenting symptoms <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              rows={2}
              value={meta.symptoms ?? ''}
              onChange={e => setMeta(m => ({ ...m, symptoms: e.target.value }))}
              placeholder="e.g. gum sore for 3 days, swollen cheek, fever…"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
            />
          </div>

          {/* Nutrition status */}
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              Nutritional status <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <select
              value={meta.nutrition_status ?? ''}
              onChange={e => setMeta(m => ({ ...m, nutrition_status: e.target.value || undefined }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
            >
              <option value="">Unknown / not assessed</option>
              <option value="normal">Normal</option>
              <option value="moderate malnutrition">Moderate malnutrition (MAM)</option>
              <option value="severe malnutrition">Severe malnutrition (SAM)</option>
            </select>
          </div>

          {/* Location */}
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              Location <span className="text-gray-400 font-normal">(for referral routing)</span>
            </label>
            {geo ? (
              <p className="text-sm text-green-700 flex items-center gap-1">
                ✅ {geo.lat.toFixed(4)}°N, {geo.lng.toFixed(4)}°E
                <button onClick={() => setGeo(null)} className="text-gray-400 ml-1 text-xs underline">clear</button>
              </p>
            ) : (
              <button
                onClick={getLocation}
                className="w-full py-2 border border-gray-300 rounded-lg text-sm text-gray-600 bg-white flex items-center justify-center gap-2"
              >
                📍 Get my location
              </button>
            )}
          </div>
        </div>

        {/* Submit */}
        <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto p-4 bg-white border-t safe-bottom">
          <button
            onClick={handleSubmit}
            disabled={!meta.age_months}
            className="w-full py-4 bg-red-700 text-white font-bold rounded-xl text-lg disabled:opacity-40 active:bg-red-800"
          >
            🔬 Analyze for Noma
          </button>
          <p className="text-center text-xs text-gray-400 mt-1">Takes 8–15 seconds • Results are AI assistance, not diagnosis</p>
        </div>
      </div>
    )
  }

  // ── step === 'capture' ──────────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 gap-6">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-bold text-gray-800">Noma Screening</h2>
        <p className="text-sm text-gray-500 max-w-xs">
          Photograph the child's mouth, gums, and cheek area clearly in good light.
        </p>
      </div>

      {/* Hidden file input — opened by the buttons below */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleCapture}
        className="hidden"
        id="camera-input"
      />

      {/* Camera button */}
      <label
        htmlFor="camera-input"
        className="flex flex-col items-center justify-center w-full max-w-xs aspect-square rounded-2xl border-4 border-dashed border-red-300 bg-red-50 cursor-pointer active:bg-red-100 transition-colors gap-3"
      >
        <span className="text-7xl">📷</span>
        <span className="font-bold text-red-700 text-lg">Take Photo</span>
        <span className="text-xs text-red-400">Tap to open camera</span>
      </label>

      {/* Or choose from gallery */}
      <div className="w-full max-w-xs">
        <input
          type="file"
          accept="image/*"
          onChange={handleCapture}
          className="hidden"
          id="gallery-input"
        />
        <label
          htmlFor="gallery-input"
          className="block w-full text-center py-3 border border-gray-300 rounded-xl text-sm text-gray-600 bg-white cursor-pointer active:bg-gray-50"
        >
          🖼️ Choose from gallery
        </label>
      </div>

      {/* Photo guidance */}
      <div className="w-full max-w-xs bg-amber-50 border border-amber-200 rounded-xl p-3">
        <p className="text-xs font-semibold text-amber-800 mb-1">📸 For best results:</p>
        <ul className="text-xs text-amber-700 space-y-0.5 list-disc list-inside">
          <li>Good natural light or bright torch</li>
          <li>Show gums, inner cheeks, face</li>
          <li>Keep child still, focus clearly</li>
          <li>Get within 20–30 cm of face</li>
        </ul>
      </div>
    </div>
  )
}
