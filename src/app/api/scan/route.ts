import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

export const maxDuration = 60; // Vercel Hobby allows up to 60s

// ─── Config ──────────────────────────────────────────────────────

const SUBREDDITS = [
  "jobs", "cscareerquestions", "resumes", "jobsearchhacks", "careerguidance",
  "careeradvice", "recruitinghell", "askrecruiters", "jobsearch", "unemployment",
  "workreform", "experienceddevs", "ITCareerQuestions", "webdev", "startups",
  "freelance", "careeradvice101", "developersIndia", "jobhunting", "resumeexperts",
  "interviews", "Resume", "GetEmployed", "findapath", "LifeAfterSchool",
  "gradadmissions", "EngineeringResumes", "layoffs",
];

const FILTER_CONFIG = {
  maxAgeHours: 4,
  maxComments: 15,
  minUpvotes: 0,
  minComments: 0,
  minIntentScore: 2,
  requireTechRole: false,
};

const FETCH_LIMIT = 100;
const RATE_LIMIT_MS = 200; // PullPush allows 1000 req/hour
const SEEN_TTL = 48 * 60 * 60; // 48h in seconds
const LEAD_TTL = 60 * 60 * 24 * 7; // 7 days in seconds

// ─── Scoring (mirrored from src/lib/filters.ts) ─────────────────

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
  "please help", "someone help", "any luck", "having trouble", "keep applying",
  "been applying", "been searching", "been looking", "been hunting", "mass applying",
  "spray and pray", "applying everywhere", "applying like crazy",
  "not working", "nothing works", "what works", "no calls", "no callbacks",
  "heard nothing", "crickets", "black hole", "into a void", "into the void",
  "is it me", "is it just me", "am i doing something wrong",
  "tough market", "brutal market", "this market", "job market",
  "impossible to find", "impossible to get", "so hard to find", "so hard to get",
  "exhausted", "burned out", "burnt out", "depressing", "demoralizing",
  "disheartening", "soul crushing", "soul-crushing",
];

const HELP_SEEKING_PHRASES = [
  "review my resume", "critique my resume", "roast my resume",
  "check my resume", "look at my resume", "feedback on my resume",
  "help with my resume", "fix my resume", "improve my resume",
  "rewrite my resume", "redo my resume",
  "resume review", "resume critique", "resume feedback",
  "resume help", "resume tips", "resume advice",
  "any tips", "any advice", "any suggestions",
  "what should i do", "what can i do", "what do i do",
  "how do i get", "how do i land", "how do i find",
  "how to get more interviews", "how to get interviews",
  "how to get a job", "how to land a job", "how to find a job",
  "how to stand out", "how to improve",
  "need advice", "need help", "need tips", "need suggestions",
  "is my resume good", "is my resume bad", "is my resume ok",
  "what am i missing", "where am i going wrong",
  "what tools do you use", "what tools should i", "best tools for",
  "looking for feedback", "open to suggestions",
  "honest feedback", "honest opinion", "be honest", "be brutal",
  "don't hold back", "tear it apart",
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

interface RawPost {
  id: string;
  title: string;
  body: string;
  author: string;
  subreddit: string;
  score: number;
  comments: number;
  created: string;
  redditUrl: string;
}

interface ScoredPost extends RawPost {
  intentScore: number;
  matchedSignals: string[];
}

function scorePost(title: string, body: string) {
  const text = `${title} ${body}`.toLowerCase();
  let intentScore = 0;
  const matchedSignals: string[] = [];

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

  let helpHits = 0;
  for (const phrase of HELP_SEEKING_PHRASES) {
    if (text.includes(phrase)) {
      helpHits++;
      matchedSignals.push(`help: "${phrase}"`);
      if (helpHits >= 2) break;
    }
  }
  intentScore += helpHits;

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

function filterAndScore(posts: RawPost[]): ScoredPost[] {
  const now = Date.now();
  const maxAgeMs = FILTER_CONFIG.maxAgeHours * 60 * 60 * 1000;

  return posts
    .map((post) => {
      const { intentScore, matchedSignals } = scorePost(post.title, post.body);
      return { ...post, intentScore, matchedSignals };
    })
    .filter((post) => {
      const postAge = now - new Date(post.created).getTime();
      if (postAge > maxAgeMs) return false;
      if (post.comments > FILTER_CONFIG.maxComments) return false;
      const highIntent = post.intentScore >= 5;
      if (!highIntent) {
        if (post.score < FILTER_CONFIG.minUpvotes) return false;
        if (post.comments < FILTER_CONFIG.minComments) return false;
      }
      if (FILTER_CONFIG.requireTechRole) {
        const text = `${post.title} ${post.body}`.toLowerCase();
        if (!TECH_KEYWORDS.some((kw) => text.includes(kw))) return false;
      }
      if (post.intentScore < FILTER_CONFIG.minIntentScore) return false;
      return true;
    })
    .sort((a, b) => b.intentScore - a.intentScore);
}

// ─── Reddit fetch via Arctic Shift API (real-time Reddit mirror) ──

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchSubreddit(subreddit: string): Promise<RawPost[]> {
  const afterEpoch = Math.floor(Date.now() / 1000) - FILTER_CONFIG.maxAgeHours * 3600;
  const url = `https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=${subreddit}&after=${afterEpoch}&limit=${FETCH_LIMIT}&sort=desc`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "HuntWiseScanner/1.0" },
    });

    if (!res.ok) {
      console.log(`[${subreddit}] arctic-shift → ${res.status}`);
      return [];
    }

    const json = await res.json();
    const posts = json?.data;
    if (!Array.isArray(posts)) {
      console.log(`[${subreddit}] arctic-shift → unexpected response`);
      return [];
    }

    console.log(`[${subreddit}] arctic-shift → ${posts.length} posts`);
    return posts.map((p: Record<string, unknown>) => ({
      id: p.id as string,
      title: p.title as string,
      body: (p.selftext as string) || "",
      author: p.author as string,
      subreddit: p.subreddit as string,
      score: (p.score as number) || 0,
      comments: (p.num_comments as number) || 0,
      created: new Date((p.created_utc as number) * 1000).toISOString(),
      redditUrl: `https://www.reddit.com${p.permalink}`,
    }));
  } catch (err) {
    console.log(`[${subreddit}] arctic-shift → error: ${err}`);
    return [];
  }
}

// ─── Discord ─────────────────────────────────────────────────────

function truncate(str: string, max: number) {
  return str.length > max ? str.slice(0, max - 1) + "\u2026" : str;
}

async function sendDiscord(posts: ScoredPost[], stats: { raw: number; scored: number }) {
  const webhook = process.env.DISCORD_SCRAPER_WEBHOOK_URL;
  if (!webhook) return;

  let embed;
  if (posts.length === 0) {
    embed = {
      title: "\ud83d\udced No new high-intent posts this run",
      description: `Scanned **${stats.raw}** posts across **${SUBREDDITS.length}** subreddits.\n${stats.scored} matched filters, but all were previously seen.`,
      color: 0x666666,
      footer: { text: new Date().toUTCString() },
    };
  } else {
    const maxIntent = Math.max(...posts.map((p) => p.intentScore));
    const color = maxIntent >= 5 ? 0xff4444 : 0xff8c00;
    const top5 = posts.slice(0, 5);
    const lines = top5.map(
      (p, i) => `**${i + 1}.** [${p.intentScore}] r/${p.subreddit} — [${truncate(p.title, 80)}](${p.redditUrl})`
    );
    if (posts.length > 5) lines.push(`\n*...and ${posts.length - 5} more*`);
    embed = {
      title: `\ud83c\udfaf ${posts.length} high-intent post${posts.length === 1 ? "" : "s"} found`,
      description: lines.join("\n"),
      color,
      footer: { text: `Max intent: ${maxIntent} | Scanned ${stats.raw} posts | ${new Date().toUTCString()}` },
    };
  }

  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  });
}

// ─── POST handler ────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Auth
  const token = process.env.LEADS_API_TOKEN;
  if (!token) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${token}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "Redis not configured" }, { status: 503 });

  // Fetch all subreddits
  console.log(`Scan started: ${SUBREDDITS.length} subreddits`);
  const allPosts: RawPost[] = [];
  for (const sub of SUBREDDITS) {
    const posts = await fetchSubreddit(sub);
    allPosts.push(...posts);
    await sleep(RATE_LIMIT_MS);
  }
  console.log(`Fetch complete: ${allPosts.length} raw posts`);

  // Score & filter
  const scored = filterAndScore(allPosts);

  // Dedup against Redis seen set
  const seenKey = "seen_ids";
  const existingIds: string[] = await redis.zrange(seenKey, 0, -1);
  const seenSet = new Set(existingIds);
  const newPosts = scored.filter((p) => !seenSet.has(p.id));

  // Mark new posts as seen in Redis
  if (newPosts.length > 0) {
    const now = Date.now();
    const seenPipeline = redis.pipeline();
    for (const p of newPosts) {
      seenPipeline.zadd(seenKey, { score: now, member: p.id });
    }
    await seenPipeline.exec();
  }

  // Prune seen IDs older than 48h
  const cutoff = Date.now() - SEEN_TTL * 1000;
  await redis.zremrangebyscore(seenKey, 0, cutoff);

  // Persist new leads
  if (newPosts.length > 0) {
    const now = Date.now();
    const leadsPipeline = redis.pipeline();
    for (const lead of newPosts) {
      const key = `lead:${lead.id}`;
      leadsPipeline.zadd("leads", { score: now, member: lead.id });
      leadsPipeline.hset(key, {
        id: lead.id,
        title: lead.title,
        body: lead.body,
        author: lead.author,
        subreddit: lead.subreddit,
        score: lead.score,
        comments: lead.comments,
        created: lead.created,
        redditUrl: lead.redditUrl,
        intentScore: lead.intentScore,
        matchedSignals: JSON.stringify(lead.matchedSignals),
        foundAt: now,
      });
      leadsPipeline.expire(key, LEAD_TTL);
    }
    await leadsPipeline.exec();
  }

  // Discord notification
  const stats = { raw: allPosts.length, scored: scored.length };
  await sendDiscord(newPosts, stats);

  return NextResponse.json({
    raw: allPosts.length,
    scored: scored.length,
    new: newPosts.length,
    persisted: newPosts.length,
  });
}
