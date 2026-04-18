import { useState, useEffect } from "react";
import { getAlerts, type Alert } from "../lib/api";

const DAYS_OPTIONS = [7, 14, 30, 90];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AlertCard({ alert }: { alert: Alert }) {
  const severity =
    alert.case_count >= 5 ? "high" : alert.case_count >= 3 ? "medium" : "low";

  const severityStyles = {
    high: "border-red-500 bg-red-50",
    medium: "border-orange-400 bg-orange-50",
    low: "border-yellow-400 bg-yellow-50",
  };

  const badgeStyles = {
    high: "bg-red-600 text-white",
    medium: "bg-orange-500 text-white",
    low: "bg-yellow-500 text-white",
  };

  const severityLabel = {
    high: "CRITICAL",
    medium: "WARNING",
    low: "WATCH",
  };

  return (
    <div className={`rounded-xl border-2 p-4 ${severityStyles[severity]}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded-full ${badgeStyles[severity]}`}
            >
              {severityLabel[severity]}
            </span>
            <span className="text-xs text-gray-500">
              {formatDate(alert.fired_at)}
            </span>
            {alert.notified && (
              <span className="text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                ✓ Notified
              </span>
            )}
          </div>
          <h3 className="font-bold text-gray-900 mt-1 capitalize">
            {alert.region} Region
          </h3>
        </div>
        <div className="text-center bg-white rounded-xl px-3 py-2 shadow-sm border border-gray-200 min-w-[56px]">
          <div className="text-2xl font-black text-red-700">
            {alert.case_count}
          </div>
          <div className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">
            cases
          </div>
        </div>
      </div>

      <div className="space-y-1.5 text-sm text-gray-700">
        <div className="flex items-center gap-2">
          <span>📍</span>
          <span>
            {alert.center_lat.toFixed(4)}°N, {alert.center_lng.toFixed(4)}°E
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span>📐</span>
          <span>
            {alert.case_count} confirmed cases within {alert.radius_km}km radius
          </span>
        </div>
      </div>

      <a
        href={`https://www.openstreetmap.org/?mlat=${alert.center_lat}&mlon=${alert.center_lng}&zoom=11`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 flex items-center gap-1.5 text-sm text-blue-700 font-medium hover:underline"
      >
        <span>🗺️</span>
        View on map →
      </a>
    </div>
  );
}

interface AlertsPageProps {
  onAlertsLoaded?: (count: number) => void;
}

export default function AlertsPage({ onAlertsLoaded }: AlertsPageProps) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const { data } = await getAlerts(days);
      setAlerts(data);
      setLastRefresh(new Date());
      // Bubble up the count of critical/warning alerts so App can show a nav badge
      onAlertsLoaded?.(data.filter((a) => a.case_count >= 3).length);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // Auto-refresh every 5 minutes (matches VM 4 poll interval)
    const interval = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const urgentCount = alerts.filter((a) => a.case_count >= 5).length;
  const warnCount = alerts.filter(
    (a) => a.case_count >= 3 && a.case_count < 5,
  ).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header strip */}
      <div className="bg-red-700 text-white px-4 pt-3 pb-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs text-red-300 uppercase tracking-wide font-medium">
              VM 4 Surveillance
            </p>
            <h2 className="text-lg font-bold">Outbreak Alerts</h2>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="text-red-200 hover:text-white transition-colors p-1 disabled:opacity-40"
            aria-label="Refresh alerts"
          >
            <span
              className={`text-xl inline-block ${loading ? "animate-spin" : ""}`}
            >
              🔄
            </span>
          </button>
        </div>

        {/* Summary chips */}
        {!loading && alerts.length > 0 && (
          <div className="flex gap-2">
            {urgentCount > 0 && (
              <span className="bg-red-900 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                🔴 {urgentCount} Critical
              </span>
            )}
            {warnCount > 0 && (
              <span className="bg-orange-600 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                🟠 {warnCount} Warning
              </span>
            )}
            {urgentCount === 0 && warnCount === 0 && (
              <span className="bg-green-700 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                ✅ No critical alerts
              </span>
            )}
          </div>
        )}
      </div>

      {/* Day filter */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-2">
        <span className="text-xs text-gray-500 font-medium shrink-0">
          Show last:
        </span>
        <div className="flex gap-1.5">
          {DAYS_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                days === d
                  ? "bg-red-700 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
        {lastRefresh && (
          <span className="text-xs text-gray-400 ml-auto shrink-0">
            {lastRefresh.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-4 py-4 space-y-3">
        {loading && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <div className="text-4xl animate-pulse mb-3">📡</div>
            <p className="text-sm">Querying surveillance data…</p>
          </div>
        )}

        {!loading && error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
            <p className="text-red-700 font-medium text-sm">⚠️ {error}</p>
            <button
              onClick={load}
              className="mt-2 text-red-600 text-sm underline"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && alerts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <div className="text-5xl mb-4">✅</div>
            <p className="font-semibold text-gray-600 text-base">
              No alerts in the last {days} days
            </p>
            <p className="text-sm mt-1 text-center">
              VM 4 is monitoring cases every 5 minutes.
              <br />
              An alert fires when 3+ cases appear within 10km.
            </p>
          </div>
        )}

        {!loading &&
          !error &&
          alerts.map((alert) => <AlertCard key={alert.id} alert={alert} />)}
      </div>

      {/* VM 4 status footnote */}
      <div className="bg-gray-100 border-t border-gray-200 px-4 py-2 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" />
        <p className="text-xs text-gray-500">
          VM 4 surveillance agent active · polls every 5 min · threshold: 3
          cases / 10km / 7 days
        </p>
      </div>
    </div>
  );
}
