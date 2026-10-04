"use client";

/**
 * components/SecurityLog.tsx
 *
 * Renders the user's security event history from audit_log.
 * Features:
 *   - Paginated event list with event-type icons and anomaly highlighting
 *   - Filter by event type (login, download, upload, anomaly…)
 *   - Alert email configuration (saved to users.email via PATCH /api/security)
 *   - Real-time refresh button
 */

import { useEffect, useState, useCallback } from "react";

interface AuditEvent {
  id: string;
  event_type: string;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const PAGE_SIZE = 20;

const EVENT_ICONS: Record<string, string> = {
  login: "🔑",
  failed_login: "❌",
  anomaly: "⚠️",
  upload: "↑",
  download: "↓",
  delete: "🗑",
  grant: "🔗",
  revoke: "🚫",
  rate_limit_block: "🛑",
};

const EVENT_COLORS: Record<string, string> = {
  anomaly: "border-amber-800 bg-amber-950/40",
  failed_login: "border-red-900 bg-red-950/30",
  rate_limit_block: "border-red-900 bg-red-950/30",
  login: "border-gray-800 bg-gray-900/40",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function shortUA(ua: string | null) {
  if (!ua) return "—";
  // Extract browser name
  const match = ua.match(/(Chrome|Firefox|Safari|Edge|Opera)\/[\d.]+/);
  return match ? match[0] : ua.slice(0, 40) + "…";
}

export function SecurityLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [savedEmail, setSavedEmail] = useState<string | null>(null);
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailMsg, setEmailMsg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const loadEvents = useCallback(async (off: number, filter: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(off),
        ...(filter ? { type: filter } : {}),
      });
      const res = await fetch(`/api/security?${params}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Failed to load security log (${res.status}).`);
      }
      const data = await res.json();
      setEvents(data.events);
      setTotal(data.total);
      setSavedEmail(data.email);
      if (!email && data.email) setEmail(data.email);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error.");
    } finally {
      setLoading(false);
    }
  }, [email]);

  useEffect(() => {
    loadEvents(0, "");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleFilterChange(f: string) {
    setTypeFilter(f);
    setOffset(0);
    loadEvents(0, f);
  }

  function handlePage(newOffset: number) {
    setOffset(newOffset);
    loadEvents(newOffset, typeFilter);
  }

  async function saveEmail() {
    setSavingEmail(true);
    setEmailMsg("");
    try {
      const res = await fetch("/api/security", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error("Failed to save.");
      setSavedEmail(email || null);
      setEmailMsg(email ? "✓ Alert email saved." : "✓ Alert email removed.");
    } catch {
      setEmailMsg("⚠️ Failed to save email.");
    } finally {
      setSavingEmail(false);
    }
  }

  const anomalyCount = events.filter((e) => e.event_type === "anomaly").length;

  return (
    <div className="flex flex-col gap-6">

      {/* ── Alert email config ──────────────────────────────────────────── */}
      <div className="vault-card flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-200">Alert email</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Receive an email when a new IP or device signs into your vault.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="flex-1 min-w-0 px-3 py-2 rounded-lg text-sm
                       bg-gray-950 border border-gray-700 text-gray-100
                       placeholder:text-gray-600
                       focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={saveEmail}
            disabled={savingEmail}
            className="px-4 py-2 rounded-lg text-sm font-medium
                       bg-indigo-600 hover:bg-indigo-500 text-white
                       transition-all disabled:opacity-50"
          >
            {savingEmail ? "Saving…" : "Save"}
          </button>
        </div>
        {savedEmail && (
          <p className="text-xs text-gray-500">
            Currently alerting: <span className="text-gray-300">{savedEmail}</span>
          </p>
        )}
        {emailMsg && (
          <p className={`text-xs ${emailMsg.startsWith("✓") ? "text-emerald-400" : "text-red-400"}`}>
            {emailMsg}
          </p>
        )}
      </div>

      {/* ── Summary strip ──────────────────────────────────────────────── */}
      {anomalyCount > 0 && (
        <div className="px-4 py-3 rounded-xl bg-amber-950 border border-amber-800
                        text-amber-200 text-sm flex items-center gap-2">
          ⚠️ <strong>{anomalyCount} anomaly event{anomalyCount !== 1 ? "s" : ""}</strong> detected
          on this page. Review the highlighted rows.
        </div>
      )}

      {/* ── Filter + refresh ────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {["", "login", "anomaly", "upload", "download", "failed_login"].map((t) => (
            <button
              key={t}
              onClick={() => handleFilterChange(t)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all
                ${typeFilter === t
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-900 border border-gray-700 text-gray-400 hover:border-gray-500"
                }`}
            >
              {t === "" ? "All events" : t}
            </button>
          ))}
        </div>
        <button
          onClick={() => loadEvents(offset, typeFilter)}
          className="ml-auto text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          ↻ Refresh
        </button>
        <span className="text-xs text-gray-600">{total} total</span>
      </div>

      {/* ── Event list ─────────────────────────────────────────────────── */}
      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-950 border border-red-800 text-red-200 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-gray-900 animate-pulse" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-sm">
          No events found{typeFilter ? ` for filter "${typeFilter}"` : ""}.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {events.map((ev) => (
            <div
              key={ev.id}
              className={`px-4 py-3 rounded-xl border flex items-start gap-3 text-sm
                ${EVENT_COLORS[ev.event_type] ?? "border-gray-800 bg-gray-900/40"}`}
            >
              {/* Icon */}
              <span className="text-base flex-shrink-0 mt-0.5">
                {EVENT_ICONS[ev.event_type] ?? "📋"}
              </span>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`font-semibold capitalize
                    ${ev.event_type === "anomaly" ? "text-amber-300"
                      : ev.event_type === "failed_login" || ev.event_type === "rate_limit_block" ? "text-red-300"
                      : "text-gray-200"}`}>
                    {ev.event_type.replace(/_/g, " ")}
                  </span>
                  {ev.event_type === "anomaly" && ev.metadata?.reason != null && (
                    <span className="badge-warning text-[10px]">
                      {String(ev.metadata.reason).replace(/_/g, " ")}
                    </span>
                  )}
                </div>
                <div className="flex gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                  <span className="font-mono">{ev.ip_address ?? "—"}</span>
                  <span>·</span>
                  <span>{shortUA(ev.user_agent)}</span>
                </div>
                {ev.event_type === "anomaly" && ev.metadata?.prevIp != null && (
                  <p className="text-[11px] text-amber-500 mt-0.5">
                    Previous IP: {String(ev.metadata.prevIp)}
                    {" → "}
                    New IP: {String(ev.metadata.newIp ?? "?")}
                  </p>
                )}
              </div>

              {/* Timestamp */}
              <span className="text-xs text-gray-600 flex-shrink-0">
                {formatDate(ev.created_at)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Pagination ──────────────────────────────────────────────────── */}
      {total > PAGE_SIZE && (
        <div className="flex justify-between items-center text-xs text-gray-500">
          <button
            onClick={() => handlePage(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
            className="px-3 py-1.5 rounded-lg border border-gray-700
                       hover:border-gray-500 disabled:opacity-40 transition-all"
          >
            ← Prev
          </button>
          <span>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <button
            onClick={() => handlePage(offset + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total}
            className="px-3 py-1.5 rounded-lg border border-gray-700
                       hover:border-gray-500 disabled:opacity-40 transition-all"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
