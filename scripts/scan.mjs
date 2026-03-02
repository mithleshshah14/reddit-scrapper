#!/usr/bin/env node

/**
 * Standalone Reddit scanner — runs without Next.js.
 * Reuses the same scoring/filtering logic from src/lib/filters.ts (inlined).
 * Sends Discord webhook notifications for high-intent posts.
 *
 * Usage:
 *   DISCORD_SCRAPER_WEBHOOK_URL=https://discord.com/api/webhooks/... node scripts/scan.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SEEN_PATH = join(ROOT, "data", "seen.json");

// ─── Config ──────────────────────────────────────────────────────

const SUBREDDITS = [
  "jobs",
  "cscareerquestions",
  "resumes",
  "jobsearchhacks",
  "careerguidance",
  "careeradvice",
  "recruitinghell",
  "askrecruiters",
  "jobsearch",
  "unemployment",
  "workreform",
  "experienceddevs",
  "ITCareerQuestions",
  "webdev",
  "startups",
  "freelance",
];

const FILTER_CONFIG = {
  maxAgeHours: 2,
  maxComments: 15,
  minUpvotes: 1,
  minComments: 0,
  minIntentScore: 3,
  requireTechRole: false,
};

const DISCORD_WEBHOOK = process.env.DISCORD_SCRAPER_WEBHOOK_URL;
const SEEN_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours
const FETCH_LIMIT = 100;
const RATE_LIMIT_MS = 1200; // ~1.2s between Reddit requests to avoid 429

// ─── Scoring logic (mirrored from src/lib/filters.ts) ────────────

const PAIN_PHRASES = [
  "applied to", "sent out", "no interview", "no interviews", "no response",
  "no responses", "getting rejected", "got rejected", "keep getting rejected",
  "ghosted", "what am i doing wrong", "not getting callbacks", "not getting calls",
  "still nothing", "0 interviews", "zero interviews", "hundreds of applications",
  "nothing back", "no luck", "no offers", "can't find a job", "can't get a job",
  "struggling to find", "job search is", "losing hope", "so frustrated",
  "ready to give up", "months of applying", "not hearing back", "never called back",
  "never heard back", "never hear back", "nobody responds", "nobody is hiring",
  "no one is hiring", "what else can i do", "need a job", "i need help",
  "please help", "someone help",
];

const VOL_NOUNS = "applications?|apps|resumes?|jobs?|companies|positions?|interviews?|places|roles?|openings?|rejections?";

const VOLUME_PATTERNS = [
  new RegExp(`\\d{2,}\\s*\\+?\\s*(${VOL_NOUNS})`, "i"),
  /\d{1,}\s*months?\s*(of\s*)?(applying|searching|looking|hunting|trying)/i,
  /\b\d{2,}\s*\+\b/,
  /applied\s*(to\s*)?\d{2,}/i,
  /(sent|submitted|dropped|fired off)\s*(out\s*)?\d{2,}\b/i,
  new RegExp(`(over|more than|almost|nearly|close to|at least)\\s+\\d{2,}\\s+(${VOL_NOUNS})`, "i"),
  /\d{1,}\s*(weeks?|years?)\s*(of\s*)?(applying|searching|looking|hunting|trying)/i,
];

const TECH_KEYWORDS = [
  "developer", "software", "engineer", "engineering", "backend", "frontend",
  "front-end", "back-end", "full-stack", "fullstack", "qa", "sdet", "devops",
  "data scientist", "data engineer", "machine learning", "cloud", "sysadmin",
  "cybersecurity", "product manager", "ui/ux", "ux designer", "web developer",
  "mobile developer", "sre", "platform engineer",
];

const EXCLUDE_PHRASES = [
  "suicidal", "suicide", "mental health crisis", "end my life", "end it all",
  "kill myself", "abuse", "visa denial rant", "should i quit life",
  "drop out of college", "self harm", "self-harm",
];

function scorePost(title, body) {
  const text = `${title} ${body}`.toLowerCase();
  let intentScore = 0;
  const matchedSignals = [];

  let painHits = 0;
  for (const phrase of PAIN_PHRASES) {
    if (text.includes(phrase)) {
      painHits++;
      matchedSignals.push(`pain: "${phrase}"`);
      if (painHits >= 3) break;
    }
  }
  intentScore += painHits * 2;

  let volumeHits = 0;
  for (const pattern of VOLUME_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      volumeHits++;
      matchedSignals.push(`volume: "${match[0].trim()}"`);
      if (volumeHits >= 2) break;
    }
  }
  intentScore += volumeHits * 2;

  for (const keyword of TECH_KEYWORDS) {
    if (text.includes(keyword)) {
      intentScore += 1;
      matchedSignals.push(`role: "${keyword}"`);
      break;
    }
  }

  for (const phrase of EXCLUDE_PHRASES) {
    if (text.includes(phrase)) {
      intentScore = -100;
      matchedSignals.push(`excluded: "${phrase}"`);
      break;
    }
  }

  return { intentScore, matchedSignals };
}

function filterAndScorePosts(posts, config) {
  const now = Date.now();
  const maxAgeMs = config.maxAgeHours * 60 * 60 * 1000;

  return posts
    .map((post) => {
      const { intentScore, matchedSignals } = scorePost(post.title, post.body);
      return { ...post, intentScore, matchedSignals };
    })
    .filter((post) => {
      const postAge = now - new Date(post.created).getTime();
      if (postAge > maxAgeMs) return false;
      if (post.comments > config.maxComments) return false;

      const highIntent = post.intentScore >= 5;
      if (!highIntent) {
        if (post.score < config.minUpvotes) return false;
        if (post.comments < config.minComments) return false;
      }

      if (config.requireTechRole) {
        const text = `${post.title} ${post.body}`.toLowerCase();
        if (!TECH_KEYWORDS.some((kw) => text.includes(kw))) return false;
      }

      if (post.intentScore < config.minIntentScore) return false;
      return true;
    })
    .sort((a, b) => b.intentScore - a.intentScore);
}

// ─── Deduplication ───────────────────────────────────────────────

function loadSeen() {
  try {
    const raw = readFileSync(SEEN_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { ids: {} };
  }
}

function saveSeen(seen) {
  mkdirSync(dirname(SEEN_PATH), { recursive: true });
  writeFileSync(SEEN_PATH, JSON.stringify(seen, null, 2) + "\n");
}

function pruneSeen(seen) {
  const cutoff = Date.now() - SEEN_TTL_MS;
  for (const [id, ts] of Object.entries(seen.ids)) {
    if (ts < cutoff) delete seen.ids[id];
  }
}

// ─── Reddit fetch ────────────────────────────────────────────────

async function fetchSubreddit(subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=${FETCH_LIMIT}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "HuntWiseRedditScanner/1.0" },
  });

  if (!res.ok) {
    console.error(`  [${subreddit}] HTTP ${res.status} ${res.statusText}`);
    return [];
  }

  const data = await res.json();
  return data.data.children
    .filter((c) => c.kind === "t3")
    .map((c) => ({
      id: c.data.id,
      title: c.data.title,
      body: c.data.selftext || "",
      author: c.data.author,
      subreddit: c.data.subreddit,
      score: c.data.score,
      comments: c.data.num_comments,
      created: new Date(c.data.created_utc * 1000).toISOString(),
      redditUrl: `https://www.reddit.com${c.data.permalink}`,
    }));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Discord webhook ─────────────────────────────────────────────

async function sendDiscordNotification(posts) {
  if (!DISCORD_WEBHOOK) {
    console.log("  No DISCORD_SCRAPER_WEBHOOK_URL set — skipping notification.");
    return;
  }

  const maxIntent = Math.max(...posts.map((p) => p.intentScore));
  const color = maxIntent >= 5 ? 0xff4444 : 0xff8c00; // red for high, orange for moderate

  const top5 = posts.slice(0, 5);
  const lines = top5.map(
    (p, i) =>
      `**${i + 1}.** [${p.intentScore}] r/${p.subreddit} — [${truncate(p.title, 80)}](${p.redditUrl})`
  );

  if (posts.length > 5) {
    lines.push(`\n*...and ${posts.length - 5} more*`);
  }

  const embed = {
    title: `🎯 ${posts.length} high-intent post${posts.length === 1 ? "" : "s"} found`,
    description: lines.join("\n"),
    color,
    footer: { text: `Max intent: ${maxIntent} | ${new Date().toUTCString()}` },
  };

  const res = await fetch(DISCORD_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  });

  if (!res.ok) {
    console.error(`  Discord webhook failed: ${res.status} ${res.statusText}`);
  } else {
    console.log(`  Discord notification sent (${posts.length} posts).`);
  }
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max - 1) + "\u2026" : str;
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  console.log(`Reddit scan started at ${new Date().toISOString()}`);
  console.log(`Subreddits: ${SUBREDDITS.length} | Max age: ${FILTER_CONFIG.maxAgeHours}h | Min intent: ${FILTER_CONFIG.minIntentScore}`);

  const seen = loadSeen();
  pruneSeen(seen);

  let allPosts = [];

  for (const sub of SUBREDDITS) {
    const posts = await fetchSubreddit(sub);
    console.log(`  r/${sub}: ${posts.length} raw posts`);
    allPosts.push(...posts);
    await sleep(RATE_LIMIT_MS);
  }

  // Filter & score
  const scored = filterAndScorePosts(allPosts, FILTER_CONFIG);

  // Deduplicate against seen IDs
  const newPosts = scored.filter((p) => !seen.ids[p.id]);

  console.log(`\nResults: ${allPosts.length} raw → ${scored.length} scored → ${newPosts.length} new`);

  // Mark new posts as seen
  const now = Date.now();
  for (const p of newPosts) {
    seen.ids[p.id] = now;
  }
  saveSeen(seen);
  console.log(`Seen database: ${Object.keys(seen.ids).length} IDs tracked`);

  if (newPosts.length > 0) {
    console.log("\nTop posts:");
    for (const p of newPosts.slice(0, 10)) {
      console.log(`  [${p.intentScore}] r/${p.subreddit} — ${truncate(p.title, 70)}`);
      console.log(`       Signals: ${p.matchedSignals.join(", ")}`);
    }

    await sendDiscordNotification(newPosts);
  } else {
    console.log("\nNo new high-intent posts this run.");
  }

  console.log(`\nDone at ${new Date().toISOString()}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
