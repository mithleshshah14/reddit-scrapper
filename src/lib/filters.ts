// ── Pain / intent phrases ─────────────────────────────────────
export const PAIN_PHRASES = [
  "applied to",
  "sent out",
  "no interview",
  "no interviews",
  "no response",
  "no responses",
  "getting rejected",
  "got rejected",
  "keep getting rejected",
  "ghosted",
  "what am i doing wrong",
  "not getting callbacks",
  "not getting calls",
  "still nothing",
  "0 interviews",
  "zero interviews",
  "hundreds of applications",
  "nothing back",
  "no luck",
  "no offers",
  "can't find a job",
  "can't get a job",
  "struggling to find",
  "job search is",
  "losing hope",
  "so frustrated",
  "ready to give up",
  "months of applying",
  "not hearing back",
  "never called back",
  "never heard back",
  "never hear back",
  "nobody responds",
  "nobody is hiring",
  "no one is hiring",
  "what else can i do",
  "need a job",
  "i need help",
  "please help",
  "someone help",
  "any luck",
  "having trouble",
  "keep applying",
  "been applying",
  "been searching",
  "been looking",
  "been hunting",
  "mass applying",
  "spray and pray",
  "applying everywhere",
  "applying like crazy",
  "not working",
  "nothing works",
  "what works",
  "no calls",
  "no callbacks",
  "heard nothing",
  "crickets",
  "black hole",
  "into a void",
  "into the void",
  "is it me",
  "is it just me",
  "am i doing something wrong",
  "tough market",
  "brutal market",
  "this market",
  "job market",
  "impossible to find",
  "impossible to get",
  "so hard to find",
  "so hard to get",
  "exhausted",
  "burned out",
  "burnt out",
  "depressing",
  "demoralizing",
  "disheartening",
  "soul crushing",
  "soul-crushing",
];

// ── Volume patterns (regex) ───────────────────────────────────
// Matches frustration-level numbers: "200 applications", "100+", "sent 300", etc.
// Keep patterns tight — only match clear job-search volume signals.
// Common nouns people use when talking about application volume
const VOL_NOUNS = "applications?|apps|resumes?|jobs?|companies|positions?|interviews?|places|roles?|openings?|rejections?";

export const VOLUME_PATTERNS = [
  // "200 applications", "100 resumes", "50 jobs", "500 apps", "300 companies"
  new RegExp(`\\d{2,}\\s*\\+?\\s*(${VOL_NOUNS})`, "i"),
  // "6 months applying", "3 months searching"
  /\d{1,}\s*months?\s*(of\s*)?(applying|searching|looking|hunting|trying)/i,
  // "100+", "200+", "300+" (standalone with plus sign — always intentional)
  /\b\d{2,}\s*\+\b/,
  // "applied to 150", "applied 200"
  /applied\s*(to\s*)?\d{2,}/i,
  // "sent out 80", "sent 300", "submitted 200"
  /(sent|submitted|dropped|fired off)\s*(out\s*)?\d{2,}\b/i,
  // "over/more than/almost N applications/jobs/apps" (require the noun)
  new RegExp(`(over|more than|almost|nearly|close to|at least)\\s+\\d{2,}\\s+(${VOL_NOUNS})`, "i"),
  // "weeks of applying", "years of searching"
  /\d{1,}\s*(weeks?|years?)\s*(of\s*)?(applying|searching|looking|hunting|trying)/i,
];

// ── Tech role keywords ────────────────────────────────────────
export const TECH_KEYWORDS = [
  "developer",
  "software",
  "engineer",
  "engineering",
  "backend",
  "frontend",
  "front-end",
  "back-end",
  "full-stack",
  "fullstack",
  "qa",
  "sdet",
  "devops",
  "data scientist",
  "data engineer",
  "machine learning",
  "cloud",
  "sysadmin",
  "cybersecurity",
  "product manager",
  "ui/ux",
  "ux designer",
  "web developer",
  "mobile developer",
  "sre",
  "platform engineer",
];

// ── Help-seeking phrases (+1 each, capped at +2) ─────────────
// These catch people actively asking for help — prime leads even
// without frustration language.
export const HELP_SEEKING_PHRASES = [
  "review my resume",
  "critique my resume",
  "roast my resume",
  "check my resume",
  "look at my resume",
  "feedback on my resume",
  "help with my resume",
  "fix my resume",
  "improve my resume",
  "rewrite my resume",
  "redo my resume",
  "resume review",
  "resume critique",
  "resume feedback",
  "resume help",
  "resume tips",
  "resume advice",
  "any tips",
  "any advice",
  "any suggestions",
  "what should i do",
  "what can i do",
  "what do i do",
  "how do i get",
  "how do i land",
  "how do i find",
  "how to get more interviews",
  "how to get interviews",
  "how to get a job",
  "how to land a job",
  "how to find a job",
  "how to stand out",
  "how to improve",
  "need advice",
  "need help",
  "need tips",
  "need suggestions",
  "is my resume good",
  "is my resume bad",
  "is my resume ok",
  "what am i missing",
  "where am i going wrong",
  "what tools do you use",
  "what tools should i",
  "best tools for",
  "looking for feedback",
  "open to suggestions",
  "honest feedback",
  "honest opinion",
  "be honest",
  "be brutal",
  "don't hold back",
  "tear it apart",
];

// ── Exclude phrases (sensitive content) ───────────────────────
export const EXCLUDE_PHRASES = [
  "suicidal",
  "suicide",
  "mental health crisis",
  "end my life",
  "end it all",
  "kill myself",
  "abuse",
  "visa denial rant",
  "should i quit life",
  "drop out of college",
  "self harm",
  "self-harm",
];

// ── Scoring ───────────────────────────────────────────────────

export interface ScoredPost {
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

export interface FilterConfig {
  maxAgeHours: number;         // freshness: only posts within N hours (default 12)
  maxComments: number;         // early-bird: skip crowded threads (default 15)
  minUpvotes: number;          // engagement floor (default 3)
  minComments: number;         // engagement floor (default 1)
  minIntentScore: number;      // minimum score to include (default 3)
  requireTechRole: boolean;    // only keep posts with tech keywords (default false)
}

export const DEFAULT_FILTER_CONFIG: FilterConfig = {
  maxAgeHours: 12,
  maxComments: 15,
  minUpvotes: 0,
  minComments: 0,
  minIntentScore: 2,
  requireTechRole: false,
};

export function scorePost(
  title: string,
  body: string
): { intentScore: number; matchedSignals: string[] } {
  const text = `${title} ${body}`.toLowerCase();
  let intentScore = 0;
  const matchedSignals: string[] = [];

  // ── Pain phrases (+2 each, capped at +6) ───────────────────
  let painHits = 0;
  for (const phrase of PAIN_PHRASES) {
    if (text.includes(phrase)) {
      painHits++;
      matchedSignals.push(`pain: "${phrase}"`);
      if (painHits >= 3) break; // cap contribution
    }
  }
  intentScore += painHits * 2;

  // ── Volume patterns (+2 each, capped at +4) ────────────────
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

  // ── Help-seeking phrases (+1 each, capped at +2) ──────────
  let helpHits = 0;
  for (const phrase of HELP_SEEKING_PHRASES) {
    if (text.includes(phrase)) {
      helpHits++;
      matchedSignals.push(`help: "${phrase}"`);
      if (helpHits >= 2) break;
    }
  }
  intentScore += helpHits;

  // ── Tech keywords (+1) ─────────────────────────────────────
  for (const keyword of TECH_KEYWORDS) {
    if (text.includes(keyword)) {
      intentScore += 1;
      matchedSignals.push(`role: "${keyword}"`);
      break; // only count once
    }
  }

  // ── Exclude phrases (-100, effectively filters out) ────────
  for (const phrase of EXCLUDE_PHRASES) {
    if (text.includes(phrase)) {
      intentScore = -100;
      matchedSignals.push(`excluded: "${phrase}"`);
      break;
    }
  }

  return { intentScore, matchedSignals };
}

export function filterAndScorePosts(
  posts: Omit<ScoredPost, "intentScore" | "matchedSignals">[],
  config: FilterConfig
): ScoredPost[] {
  const now = Date.now();
  const maxAgeMs = config.maxAgeHours * 60 * 60 * 1000;

  return posts
    .map((post) => {
      const { intentScore, matchedSignals } = scorePost(post.title, post.body);
      return { ...post, intentScore, matchedSignals };
    })
    .filter((post) => {
      // Freshness (always enforced)
      const postAge = now - new Date(post.created).getTime();
      if (postAge > maxAgeMs) return false;

      // Early-bird: always skip crowded threads — no point reaching out
      // if 30 people already commented
      if (post.comments > config.maxComments) return false;

      // High-intent posts (>=5) bypass engagement floor filters.
      // A post saying "500 apps no callback" is gold even with 0 upvotes.
      const highIntent = post.intentScore >= 5;

      if (!highIntent) {
        // Engagement floor
        if (post.score < config.minUpvotes) return false;
        if (post.comments < config.minComments) return false;
      }

      // Tech role filter
      if (config.requireTechRole) {
        const text = `${post.title} ${post.body}`.toLowerCase();
        const hasTechKeyword = TECH_KEYWORDS.some((kw) => text.includes(kw));
        if (!hasTechKeyword) return false;
      }

      // Intent score threshold
      if (post.intentScore < config.minIntentScore) return false;

      return true;
    })
    .sort((a, b) => b.intentScore - a.intentScore); // highest intent first
}
