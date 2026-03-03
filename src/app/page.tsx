"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface ScoredPost {
  id: string;
  title: string;
  body: string;
  author: string;
  subreddit: string;
  score: number;
  comments: number;
  created: string;
  redditUrl: string;
  intentScore: number;
  matchedSignals: string[];
}

interface SubredditResult {
  subreddit: string;
  posts: ScoredPost[];
  count?: number;
  rawCount?: number;
  error?: string;
}

interface ScrapeResponse {
  totalFiltered: number;
  totalRaw: number;
  filters: Record<string, unknown>;
  subreddits: SubredditResult[];
  scrapedAt: string;
}

const DEFAULT_SUBREDDITS =
  "jobs,cscareerquestions,resumes,jobsearchhacks,careerguidance";

// ── Notification sound (short beep via Web Audio API) ──────────
function playNotificationSound() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = "sine";
    gain.gain.value = 0.15;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // Audio not available — ignore
  }
}

export default function Home() {
  const [subreddits, setSubreddits] = useState<string[]>(DEFAULT_SUBREDDITS.split(","));
  const [subredditInput, setSubredditInput] = useState("");
  const [hydrated, setHydrated] = useState(false);

  // Load subreddits from localStorage after hydration
  useEffect(() => {
    const stored = localStorage.getItem("reddit_scraper_subreddits");
    if (stored) {
      const parsed = stored.split(",").map((s) => s.trim()).filter(Boolean);
      if (parsed.length > 0) setSubreddits(parsed);
    }
    setHydrated(true);
  }, []);
  const [sort, setSort] = useState("new");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedPosts, setExpandedPosts] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);

  // Filter controls
  const [maxAgeHours, setMaxAgeHours] = useState(12);
  const [maxComments, setMaxComments] = useState(15);
  const [minUpvotes, setMinUpvotes] = useState(0);
  const [minComments, setMinComments] = useState(0);
  const [minIntentScore, setMinIntentScore] = useState(2);
  const [requireTechRole, setRequireTechRole] = useState(false);

  // Auto-scan state
  const [autoScanEnabled, setAutoScanEnabled] = useState(false);
  const [scanIntervalMins, setScanIntervalMins] = useState(60);
  const [secondsUntilNext, setSecondsUntilNext] = useState(0);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>("default");
  const [scanLog, setScanLog] = useState<string[]>([]);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const nextScanAtRef = useRef<number>(0); // absolute timestamp for next scan
  const runScanRef = useRef<((isManual?: boolean) => Promise<void>) | undefined>(undefined);

  // Accumulated posts (deduped by id, sorted by intent score)
  const [allPosts, setAllPosts] = useState<ScoredPost[]>([]);
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  const [lastScanTime, setLastScanTime] = useState<string | null>(null);
  const [lastScanStats, setLastScanStats] = useState<{ raw: number; filtered: number } | null>(null);
  const [totalScans, setTotalScans] = useState(0);

  // Persist subreddits to localStorage (only after hydration to avoid overwriting with defaults)
  useEffect(() => {
    if (hydrated) {
      localStorage.setItem("reddit_scraper_subreddits", subreddits.join(","));
    }
  }, [subreddits, hydrated]);

  // Load persisted leads from Redis on mount
  useEffect(() => {
    fetch("/api/leads")
      .then((res) => res.ok ? res.json() : [])
      .then((leads: ScoredPost[]) => {
        if (!Array.isArray(leads) || leads.length === 0) return;
        setAllPosts((prev) => {
          const existingIds = new Set(prev.map((p) => p.id));
          const newLeads = leads.filter((l) => !existingIds.has(l.id));
          if (newLeads.length === 0) return prev;
          const merged = [...prev, ...newLeads];
          return merged.sort((a, b) => b.intentScore - a.intentScore);
        });
        setSeenIds((prev) => {
          const next = new Set(prev);
          for (const l of leads) next.add(l.id);
          return next;
        });
      })
      .catch(() => { /* Redis not configured — ignore */ });
  }, []);

  const addSubreddit = (name: string) => {
    const clean = name.trim().toLowerCase().replace(/^r\//, "");
    if (!clean || subreddits.includes(clean)) return;
    setSubreddits((prev) => [...prev, clean]);
  };

  const removeSubreddit = (name: string) => {
    setSubreddits((prev) => prev.filter((s) => s !== name));
  };

  const handleSubredditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addSubreddit(subredditInput);
      setSubredditInput("");
    }
    if (e.key === "Backspace" && !subredditInput && subreddits.length > 0) {
      setSubreddits((prev) => prev.slice(0, -1));
    }
  };

  // Request notification permission on mount
  useEffect(() => {
    if ("Notification" in window) {
      setNotifPermission(Notification.permission);
    }
  }, []);

  const requestNotifPermission = async () => {
    if ("Notification" in window) {
      const perm = await Notification.requestPermission();
      setNotifPermission(perm);
    }
  };

  const sendNotification = useCallback((newCount: number, topPost: ScoredPost) => {
    if (notifPermission !== "granted") return;
    const notif = new Notification(`${newCount} new high-intent post${newCount > 1 ? "s" : ""} found`, {
      body: `[${topPost.intentScore}] ${topPost.title.slice(0, 80)}`,
      icon: "/favicon.ico",
      tag: "reddit-scraper",
    });
    notif.onclick = () => {
      window.focus();
      notif.close();
    };
    playNotificationSound();
  }, [notifPermission]);

  const addLog = useCallback((msg: string) => {
    const time = new Date().toLocaleTimeString();
    setScanLog((prev) => [`[${time}] ${msg}`, ...prev.slice(0, 49)]);
  }, []);

  const runScan = useCallback(async (isManual = false) => {
    if (subreddits.length === 0) return;

    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        subreddits: subreddits.join(","),
        sort,
        maxAgeHours: maxAgeHours.toString(),
        maxComments: maxComments.toString(),
        minUpvotes: minUpvotes.toString(),
        minComments: minComments.toString(),
        minIntentScore: minIntentScore.toString(),
        requireTechRole: requireTechRole.toString(),
      });

      const res = await fetch(`/api/scrape?${params}`);
      const json: ScrapeResponse = await res.json();

      if (!res.ok) {
        setError(json.toString());
        addLog("Scan failed");
        return;
      }

      setLastScanTime(json.scrapedAt);
      setLastScanStats({ raw: json.totalRaw, filtered: json.totalFiltered });
      setTotalScans((prev) => prev + 1);

      // Collect all posts from all subreddits
      const incoming: ScoredPost[] = [];
      for (const sub of json.subreddits) {
        for (const post of sub.posts) {
          incoming.push(post);
        }
      }

      // Find new posts (not seen before)
      const newPosts = incoming.filter((p) => !seenIds.has(p.id));
      const newIds = new Set(newPosts.map((p) => p.id));

      // Update seen IDs
      setSeenIds((prev) => {
        const next = new Set(prev);
        for (const id of newIds) next.add(id);
        return next;
      });

      // Merge into accumulated feed (deduped, sorted by intent)
      setAllPosts((prev) => {
        const merged = [...newPosts, ...prev];
        // Dedup by id (keep first = newest scan's version)
        const seen = new Set<string>();
        const deduped = merged.filter((p) => {
          if (seen.has(p.id)) return false;
          seen.add(p.id);
          return true;
        });
        return deduped.sort((a, b) => b.intentScore - a.intentScore);
      });

      if (newPosts.length > 0) {
        addLog(`${newPosts.length} new post${newPosts.length > 1 ? "s" : ""} found (${json.totalRaw} scanned)`);
        // Notify only on auto-scans (not the first manual one)
        if (!isManual) {
          const topPost = newPosts.sort((a, b) => b.intentScore - a.intentScore)[0];
          sendNotification(newPosts.length, topPost);
        }
      } else {
        addLog(`No new posts (${json.totalRaw} scanned, ${json.totalFiltered} matched)`);
      }
    } catch {
      setError("Network error. Try again.");
      addLog("Scan failed — network error");
    } finally {
      setLoading(false);
    }
  }, [subreddits, sort, maxAgeHours, maxComments, minUpvotes, minComments, minIntentScore, requireTechRole, seenIds, addLog, sendNotification]);

  // Keep ref in sync with latest runScan (avoids stale closures in setInterval)
  runScanRef.current = runScan;

  // Auto-scan interval — uses absolute timestamp so countdown survives re-renders/hot reloads.
  useEffect(() => {
    if (autoScanEnabled) {
      const intervalMs = scanIntervalMins * 60 * 1000;

      // Only set the target time if it's not already in the future
      // (avoids resetting on effect re-runs from strict mode / hot reload)
      if (nextScanAtRef.current <= Date.now()) {
        nextScanAtRef.current = Date.now() + intervalMs;
      }

      // Countdown — derives remaining time from absolute target
      countdownRef.current = setInterval(() => {
        const remaining = Math.max(0, Math.round((nextScanAtRef.current - Date.now()) / 1000));
        setSecondsUntilNext(remaining);

        // Time to scan
        if (remaining === 0) {
          runScanRef.current?.(false);
          nextScanAtRef.current = Date.now() + intervalMs;
        }
      }, 1000);

      return () => {
        if (countdownRef.current) clearInterval(countdownRef.current);
      };
    } else {
      if (countdownRef.current) clearInterval(countdownRef.current);
      nextScanAtRef.current = 0;
      setSecondsUntilNext(0);
    }
  }, [autoScanEnabled, scanIntervalMins]);

  const toggleAutoScan = () => {
    if (!autoScanEnabled) {
      // Starting auto-scan — run first scan immediately
      if (notifPermission === "default") {
        requestNotifPermission();
      }
      runScan(true);
      addLog(`Auto-scan started (every ${scanIntervalMins} min)`);
    } else {
      addLog("Auto-scan stopped");
    }
    setAutoScanEnabled(!autoScanEnabled);
  };

  const togglePost = (id: string) => {
    setExpandedPosts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const formatCountdown = (totalSeconds: number) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const timeAgo = (isoDate: string) => {
    const seconds = Math.floor(
      (Date.now() - new Date(isoDate).getTime()) / 1000
    );
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const intentColor = (score: number) => {
    if (score >= 7) return "text-red-400 bg-red-900/30 border-red-800";
    if (score >= 5) return "text-orange-400 bg-orange-900/30 border-orange-800";
    if (score >= 3) return "text-yellow-400 bg-yellow-900/30 border-yellow-800";
    return "text-zinc-400 bg-zinc-800 border-zinc-700";
  };

  const intentLabel = (score: number) => {
    if (score >= 7) return "HIGH INTENT";
    if (score >= 5) return "STRONG";
    if (score >= 3) return "MODERATE";
    return "LOW";
  };

  const signalColor = (signal: string) => {
    if (signal.startsWith("pain:")) return "bg-red-900/40 text-red-300 border-red-800/50";
    if (signal.startsWith("volume:")) return "bg-orange-900/40 text-orange-300 border-orange-800/50";
    if (signal.startsWith("help:")) return "bg-emerald-900/40 text-emerald-300 border-emerald-800/50";
    if (signal.startsWith("role:")) return "bg-blue-900/40 text-blue-300 border-blue-800/50";
    return "bg-zinc-800 text-zinc-400 border-zinc-700";
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-1">Reddit Intent Scraper</h1>
          <p className="text-zinc-400">
            Find high-frustration, high-openness posts from job seekers
          </p>
        </div>

        {/* Controls */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-4">
          <div className="flex flex-col gap-4">
            {/* Subreddits */}
            <div>
              <label className="text-sm text-zinc-400 mb-1 block">Subreddits</label>
              <input
                type="text"
                value={subredditInput}
                onChange={(e) => setSubredditInput(e.target.value.replace(",", ""))}
                onKeyDown={handleSubredditKeyDown}
                placeholder="Type subreddit name + Enter"
                disabled={autoScanEnabled}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-orange-500 transition-colors disabled:opacity-50"
              />
              {subreddits.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {subreddits.map((sub) => (
                    <span
                      key={sub}
                      className="flex items-center gap-1 bg-orange-600/20 text-orange-300 border border-orange-700/50 text-xs font-medium px-2.5 py-1 rounded-full"
                    >
                      r/{sub}
                      {!autoScanEnabled && (
                        <button
                          onClick={() => removeSubreddit(sub)}
                          className="text-orange-400 hover:text-orange-200 cursor-pointer ml-0.5"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Sort + Filters toggle */}
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-sm text-zinc-400 mb-1 block">Sort by</label>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  disabled={autoScanEnabled}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-zinc-100 focus:outline-none focus:border-orange-500 transition-colors disabled:opacity-50"
                >
                  <option value="new">New</option>
                  <option value="hot">Hot</option>
                  <option value="top">Top</option>
                  <option value="rising">Rising</option>
                </select>
              </div>
              <div className="flex-1 flex items-end">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="w-full bg-zinc-800 border border-zinc-700 text-zinc-300 hover:border-zinc-600 font-medium py-2.5 px-4 rounded-lg transition-colors cursor-pointer text-sm"
                >
                  {showFilters ? "Hide Filters" : "Filters"}
                </button>
              </div>
            </div>

            {/* Advanced Filters */}
            {showFilters && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 border-t border-zinc-800">
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Max age (hours)</label>
                  <input type="number" value={maxAgeHours} onChange={(e) => setMaxAgeHours(Math.max(1, +e.target.value))} min={1} disabled={autoScanEnabled} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-orange-500 disabled:opacity-50" />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Max comments</label>
                  <input type="number" value={maxComments} onChange={(e) => setMaxComments(Math.max(0, +e.target.value))} min={0} disabled={autoScanEnabled} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-orange-500 disabled:opacity-50" />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Min upvotes</label>
                  <input type="number" value={minUpvotes} onChange={(e) => setMinUpvotes(Math.max(0, +e.target.value))} min={0} disabled={autoScanEnabled} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-orange-500 disabled:opacity-50" />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Min comments</label>
                  <input type="number" value={minComments} onChange={(e) => setMinComments(Math.max(0, +e.target.value))} min={0} disabled={autoScanEnabled} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-orange-500 disabled:opacity-50" />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Min intent score</label>
                  <input type="number" value={minIntentScore} onChange={(e) => setMinIntentScore(Math.max(0, +e.target.value))} min={0} disabled={autoScanEnabled} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-orange-500 disabled:opacity-50" />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={requireTechRole} onChange={(e) => setRequireTechRole(e.target.checked)} disabled={autoScanEnabled} className="accent-orange-500 w-4 h-4" />
                    <span className="text-xs text-zinc-400">Tech roles only</span>
                  </label>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => runScan(true)}
                disabled={loading || autoScanEnabled}
                className="flex-1 bg-orange-600 hover:bg-orange-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium py-2.5 px-6 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                {loading ? "Scanning..." : "Scan Now"}
              </button>
            </div>
          </div>
        </div>

        {/* Auto-scan panel */}
        <div className={`border rounded-xl p-4 mb-6 ${autoScanEnabled ? "bg-emerald-950/30 border-emerald-800/50" : "bg-zinc-900 border-zinc-800"}`}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={toggleAutoScan}
                className={`relative w-12 h-6 rounded-full transition-colors cursor-pointer ${autoScanEnabled ? "bg-emerald-600" : "bg-zinc-700"}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${autoScanEnabled ? "translate-x-6" : ""}`} />
              </button>
              <div>
                <span className="text-sm font-medium">
                  Auto-scan {autoScanEnabled ? "ON" : "OFF"}
                </span>
                {autoScanEnabled && secondsUntilNext > 0 && (
                  <span className="text-emerald-400 text-xs ml-2">
                    Next in {formatCountdown(secondsUntilNext)}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-500">Every</label>
              <select
                value={scanIntervalMins}
                onChange={(e) => setScanIntervalMins(+e.target.value)}
                disabled={autoScanEnabled}
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-sm text-zinc-100 focus:outline-none disabled:opacity-50"
              >
                <option value={5}>5 min</option>
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={60}>1 hr</option>
                <option value={120}>2 hr</option>
              </select>

              {notifPermission !== "granted" && (
                <button
                  onClick={requestNotifPermission}
                  className="text-xs text-orange-400 hover:text-orange-300 underline cursor-pointer ml-1"
                >
                  Enable notifications
                </button>
              )}
            </div>
          </div>

          {/* Scan stats */}
          {lastScanTime && (
            <div className="flex items-center gap-4 mt-3 pt-3 border-t border-zinc-800/50 text-xs text-zinc-500">
              <span>Scans: {totalScans}</span>
              <span>Posts found: {allPosts.length}</span>
              {lastScanStats && (
                <span>Last: {lastScanStats.filtered}/{lastScanStats.raw} matched</span>
              )}
              <span className="ml-auto">
                {new Date(lastScanTime).toLocaleTimeString()}
              </span>
            </div>
          )}

          {/* Scan log (collapsible) */}
          {scanLog.length > 0 && (
            <details className="mt-2">
              <summary className="text-xs text-zinc-600 cursor-pointer hover:text-zinc-400">
                Scan log ({scanLog.length})
              </summary>
              <div className="mt-1 max-h-32 overflow-y-auto text-xs text-zinc-600 font-mono space-y-0.5">
                {scanLog.map((log, i) => (
                  <div key={i}>{log}</div>
                ))}
              </div>
            </details>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-900/30 border border-red-800 text-red-300 rounded-xl px-4 py-3 mb-6">
            {error}
          </div>
        )}

        {/* Accumulated results */}
        {allPosts.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-zinc-200">
                {allPosts.length} high-intent post{allPosts.length !== 1 ? "s" : ""}
              </h2>
              <button
                onClick={() => {
                  setAllPosts([]);
                  setSeenIds(new Set());
                  setTotalScans(0);
                  setScanLog([]);
                  setLastScanTime(null);
                  setLastScanStats(null);
                }}
                className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer"
              >
                Clear all
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {allPosts.map((post) => (
                <div
                  key={post.id}
                  className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden"
                >
                  <button
                    onClick={() => togglePost(post.id)}
                    className="w-full text-left px-4 py-3 hover:bg-zinc-800/50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-start gap-3">
                      {/* Intent score badge */}
                      <span
                        className={`shrink-0 text-xs font-bold px-2 py-1 rounded border mt-0.5 ${intentColor(post.intentScore)}`}
                      >
                        {post.intentScore}
                      </span>

                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-zinc-100 leading-snug">
                          {post.title}
                        </h3>
                        <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs text-zinc-500">
                          <span className={`font-medium ${intentColor(post.intentScore).split(" ")[0]}`}>
                            {intentLabel(post.intentScore)}
                          </span>
                          <span className="text-orange-400/60">r/{post.subreddit}</span>
                          <span>u/{post.author}</span>
                          <span>{post.score} pts</span>
                          <span>{post.comments} comments</span>
                          <span>{timeAgo(post.created)}</span>
                        </div>
                      </div>

                      <span className="text-zinc-500 text-xs shrink-0 mt-0.5">
                        {expandedPosts.has(post.id) ? "▲" : "▼"}
                      </span>
                    </div>
                  </button>

                  {expandedPosts.has(post.id) && (
                    <div className="px-4 pb-4 border-t border-zinc-800">
                      {/* Signal badges */}
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {post.matchedSignals.map((signal, i) => (
                          <span
                            key={i}
                            className={`text-xs px-2 py-0.5 rounded border ${signalColor(signal)}`}
                          >
                            {signal}
                          </span>
                        ))}
                      </div>

                      {/* Post body */}
                      {post.body ? (
                        <pre className="text-sm text-zinc-300 whitespace-pre-wrap mt-3 font-sans leading-relaxed max-h-80 overflow-y-auto">
                          {post.body}
                        </pre>
                      ) : (
                        <p className="text-sm text-zinc-500 italic mt-3">
                          No body text (link post or image)
                        </p>
                      )}

                      <a
                        href={post.redditUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block mt-3 text-xs text-orange-400 hover:text-orange-300 transition-colors"
                      >
                        View on Reddit →
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {allPosts.length === 0 && !loading && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-12 text-center">
            <p className="text-zinc-400 mb-2">No posts yet</p>
            <p className="text-zinc-600 text-sm">
              Hit &quot;Scan Now&quot; or toggle auto-scan to start finding high-intent posts.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
