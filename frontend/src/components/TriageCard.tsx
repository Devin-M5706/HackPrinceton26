import type { ScreenResult, TriageLevel } from '../lib/api'

// ── Triage colour config ──────────────────────────────────────────────────────

const TRIAGE_CONFIG: Record<
  TriageLevel,
  { bg: string; border: string; text: string; label: string; icon: string; description: string }
> = {
  urgent: {
    bg: 'bg-red-600',
    border: 'border-red-600',
    text: 'text-red-700',
    label: 'URGENT',
    icon: '🚨',
    description: 'Emergency hospital referral required NOW',
  },
  refer: {
    bg: 'bg-orange-500',
    border: 'border-orange-500',
    text: 'text-orange-600',
    label: 'REFER',
    icon: '⚠️',
    description: 'Refer to clinic within 48 hours',
  },
  monitor: {
    bg: 'bg-yellow-500',
    border: 'border-yellow-500',
    text: 'text-yellow-700',
    label: 'MONITOR',
    icon: '👁️',
    description: 'Monitor closely — follow up in 7 days',
  },
  healthy: {
    bg: 'bg-green-600',
    border: 'border-green-600',
    text: 'text-green-700',
    label: 'HEALTHY',
    icon: '✅',
    description: 'No signs of Noma detected',
  },
}

// ── Risk score bar ────────────────────────────────────────────────────────────

function RiskBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score))
  const color =
    pct >= 75 ? 'bg-red-600' : pct >= 50 ? 'bg-orange-500' : pct >= 25 ? 'bg-yellow-500' : 'bg-green-600'

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-500">
        <span>Risk score</span>
        <span className="font-bold text-gray-800">{score} / 100</span>
      </div>
      <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ── Collapsible section ───────────────────────────────────────────────────────

import { useState } from 'react'

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 text-left"
        onClick={() => setOpen(o => !o)}
      >
        <span className="font-semibold text-gray-800 text-sm flex items-center gap-2">
          <span>{icon}</span> {title}
        </span>
        <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="px-4 py-3 text-sm text-gray-700 leading-relaxed">{children}</div>}
    </div>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  result: ScreenResult
  imageUrl?: string
  onNewScreening?: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TriageCard({ result, imageUrl, onNewScreening }: Props) {
  const cfg = TRIAGE_CONFIG[result.triage]

  return (
    <div className="flex flex-col gap-4 pb-6">

      {/* ── Verdict banner ── */}
      <div className={`${cfg.bg} text-white px-5 py-5 rounded-2xl shadow-lg`}>
        <div className="flex items-center gap-3 mb-2">
          <span className="text-4xl">{cfg.icon}</span>
          <div>
            <p className="text-xs font-medium uppercase tracking-widest opacity-80">Triage verdict</p>
            <h2 className="text-3xl font-black tracking-tight">{cfg.label}</h2>
          </div>
        </div>
        <p className="text-sm opacity-90">{cfg.description}</p>

        {/* Stage + confidence row */}
        <div className="mt-4 flex gap-3">
          <div className="bg-white/20 rounded-xl px-3 py-2 flex-1 text-center">
            <p className="text-xs opacity-80">WHO Stage</p>
            <p className="text-2xl font-black">{result.stage}</p>
            <p className="text-xs opacity-70">of 5</p>
          </div>
          <div className="bg-white/20 rounded-xl px-3 py-2 flex-1 text-center">
            <p className="text-xs opacity-80">Risk score</p>
            <p className="text-2xl font-black">{result.risk_score}</p>
            <p className="text-xs opacity-70">of 100</p>
          </div>
          <div className="bg-white/20 rounded-xl px-3 py-2 flex-1 text-center">
            <p className="text-xs opacity-80">Confidence</p>
            <p className="text-2xl font-black">{Math.round(result.confidence * 100)}%</p>
            <p className="text-xs opacity-70">AI model</p>
          </div>
        </div>

        {result.mock && (
          <div className="mt-3 bg-white/20 rounded-lg px-3 py-1.5 text-xs text-center">
            ⚠️ Demo mode — not a real clinical result
          </div>
        )}
      </div>

      {/* ── Risk bar ── */}
      <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
        <RiskBar score={result.risk_score} />
      </div>

      {/* ── Captured image (if available) ── */}
      {imageUrl && (
        <div className="rounded-xl overflow-hidden border border-gray-200 aspect-video">
          <img src={imageUrl} alt="Captured screening" className="w-full h-full object-cover" />
        </div>
      )}

      {/* ── Visual findings ── */}
      {result.findings.length > 0 && (
        <Section title="Visual findings" icon="🔍">
          <ul className="space-y-1.5">
            {result.findings.map((f, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-0.5 text-gray-400 shrink-0">•</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* ── Risk factors ── */}
      {result.risk_factors.length > 0 && (
        <Section title="Risk factors" icon="⚡">
          <div className="flex flex-wrap gap-2">
            {result.risk_factors.map((rf, i) => (
              <span
                key={i}
                className="bg-red-50 text-red-700 border border-red-200 rounded-full px-3 py-1 text-xs font-medium"
              >
                {rf}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* ── Clinical note ── */}
      <Section title="Clinical reasoning" icon="🩺">
        <p className="leading-relaxed">{result.clinical_note}</p>
        {result.recommendation && (
          <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            <p className="text-xs font-semibold text-blue-700 mb-1">Recommended action</p>
            <p className="text-blue-800">{result.recommendation}</p>
          </div>
        )}
      </Section>

      {/* ── Referral ── */}
      <Section title="Referral note" icon="📄">
        <p className="leading-relaxed whitespace-pre-wrap">{result.referral_note}</p>
      </Section>

      {/* ── Clinic info ── */}
      <Section title="Nearest Noma-capable clinic" icon="🏥">
        <div className="space-y-2">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-semibold text-gray-900">{result.clinic.name}</p>
              <p className="text-gray-500 text-xs mt-0.5">{result.clinic.distance_km} km away</p>
            </div>
          </div>
          {result.clinic.contact && result.clinic.contact !== 'N/A' && (
            <a
              href={`tel:${result.clinic.contact}`}
              className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 rounded-lg px-3 py-2 text-sm font-medium w-full"
            >
              <span>📞</span>
              <span>{result.clinic.contact}</span>
            </a>
          )}
        </div>
      </Section>

      {/* ── New screening button ── */}
      {onNewScreening && (
        <button
          onClick={onNewScreening}
          className="w-full py-4 bg-gray-800 text-white font-bold rounded-2xl text-base active:scale-95 transition-transform"
        >
          + New Screening
        </button>
      )}

      {/* ── Ethics disclaimer ── */}
      <p className="text-center text-xs text-gray-400 px-4">
        This is AI-assisted triage, not a clinical diagnosis.
        Always defer to a trained health professional.
      </p>
    </div>
  )
}
