import { useLiveQuery } from 'dexie-react-hooks'
import { db, type LocalCase } from '../lib/db'
import { useState } from 'react'

const TRIAGE_STYLES: Record<string, { bg: string; text: string; label: string; emoji: string }> = {
  urgent:  { bg: 'bg-red-600',    text: 'text-white',      label: 'URGENT',  emoji: '🚨' },
  refer:   { bg: 'bg-orange-500', text: 'text-white',      label: 'REFER',   emoji: '⚠️' },
  monitor: { bg: 'bg-yellow-400', text: 'text-yellow-900', label: 'MONITOR', emoji: '👁️' },
  healthy: { bg: 'bg-green-600',  text: 'text-white',      label: 'HEALTHY', emoji: '✅' },
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function CaseCard({ c }: { c: LocalCase }) {
  const [open, setOpen] = useState(false)
  const t = TRIAGE_STYLES[c.triage] ?? TRIAGE_STYLES.monitor

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header row */}
      <button
        className="w-full text-left px-4 py-3 flex items-center gap-3"
        onClick={() => setOpen(o => !o)}
      >
        {/* Triage badge */}
        <span className={`${t.bg} ${t.text} text-xs font-bold px-2 py-1 rounded-lg shrink-0`}>
          {t.emoji} {t.label}
        </span>

        {/* Middle info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate">
            Stage {c.stage} · {c.child_age_months}mo · {c.child_sex}
          </p>
          <p className="text-xs text-gray-400">{formatDate(c.created_at)}</p>
        </div>

        {/* Risk score pill */}
        <div className="shrink-0 text-right">
          <span className="text-sm font-bold text-gray-700">{c.risk_score}</span>
          <span className="text-xs text-gray-400">/100</span>
        </div>

        {/* Expand chevron */}
        <span className="shrink-0 text-gray-300 text-lg">{open ? '▲' : '▼'}</span>
      </button>

      {/* Sync badge */}
      {!c.synced && (
        <div className="px-4 pb-1">
          <span className="inline-flex items-center gap-1 text-xs bg-yellow-50 text-yellow-700 border border-yellow-200 rounded-full px-2 py-0.5">
            ⏳ Pending sync
          </span>
        </div>
      )}

      {/* Expanded detail */}
      {open && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-3 text-sm">

          {/* Image preview if stored */}
          {c.image_b64 && (
            <img
              src={`data:image/jpeg;base64,${c.image_b64}`}
              alt="Screening photo"
              className="w-full max-h-48 object-cover rounded-xl"
            />
          )}

          {/* Findings */}
          {c.findings.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Findings</p>
              <ul className="space-y-0.5">
                {c.findings.map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-gray-700">
                    <span className="mt-0.5 shrink-0">•</span> {f}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Clinical note */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Clinical Note</p>
            <p className="text-gray-700 leading-relaxed">{c.clinical_note}</p>
          </div>

          {/* Recommendation */}
          <div className="bg-blue-50 rounded-xl px-3 py-2">
            <p className="text-xs font-semibold text-blue-600 mb-0.5">Recommendation</p>
            <p className="text-blue-800 text-sm">{c.recommendation}</p>
          </div>

          {/* Referral note */}
          {c.referral_note && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Referral Note</p>
              <p className="text-gray-700 leading-relaxed">{c.referral_note}</p>
            </div>
          )}

          {/* Clinic */}
          <div className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
            <div>
              <p className="text-xs font-semibold text-gray-500">Referred to</p>
              <p className="font-medium text-gray-800">{c.clinic_name}</p>
              <p className="text-xs text-gray-500">{c.clinic_distance_km} km away</p>
            </div>
            {c.clinic_contact && c.clinic_contact !== 'N/A' && (
              <a
                href={`tel:${c.clinic_contact}`}
                className="bg-green-600 text-white text-xs font-bold px-3 py-2 rounded-xl"
              >
                📞 Call
              </a>
            )}
          </div>

          {/* Risk factors */}
          {c.risk_factors.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Risk Factors</p>
              <div className="flex flex-wrap gap-1.5">
                {c.risk_factors.map((r, i) => (
                  <span key={i} className="bg-red-50 text-red-700 text-xs px-2 py-0.5 rounded-full border border-red-100">
                    {r}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Meta footer */}
          <div className="flex items-center justify-between text-xs text-gray-400 pt-1 border-t border-gray-100">
            <span>{c.mock ? '🧪 Mock result' : '🤖 AI result'}</span>
            <span className="font-mono">{c.id.slice(0, 8)}…</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function HistoryPage() {
  const cases = useLiveQuery(() => db.cases.orderBy('created_at').reverse().toArray(), [])

  if (cases === undefined) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-red-700 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (cases.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center px-8">
        <span className="text-5xl mb-3">📋</span>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">No screenings yet</h2>
        <p className="text-sm text-gray-400">
          Complete a screening and your cases will appear here — even offline.
        </p>
      </div>
    )
  }

  const urgent  = cases.filter(c => c.triage === 'urgent').length
  const pending = cases.filter(c => !c.synced).length

  return (
    <div className="px-4 py-4 space-y-3 pb-24">
      {/* Summary bar */}
      <div className="flex gap-2 text-xs">
        <span className="bg-gray-100 text-gray-600 rounded-full px-3 py-1 font-medium">
          {cases.length} total
        </span>
        {urgent > 0 && (
          <span className="bg-red-100 text-red-700 rounded-full px-3 py-1 font-medium">
            🚨 {urgent} urgent
          </span>
        )}
        {pending > 0 && (
          <span className="bg-yellow-100 text-yellow-700 rounded-full px-3 py-1 font-medium">
            ⏳ {pending} pending
          </span>
        )}
      </div>

      {/* Case list */}
      {cases.map(c => <CaseCard key={c.id} c={c} />)}
    </div>
  )
}
