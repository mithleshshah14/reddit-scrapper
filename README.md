# Reddit Intent Scraper

A Next.js tool that finds high-frustration, high-openness posts from job seekers on Reddit. Instead of scraping entire subreddits, it filters by **pain patterns** and **intent signals** to surface posts from people actively struggling with their job search — the ones most open to solutions.

## How It Works

1. Fetches the latest 100 posts from each configured subreddit via Reddit's public JSON API
2. Scores every post through an intent scoring engine (pain phrases, volume patterns, tech keywords)
3. Filters out noise using engagement, freshness, and score thresholds
4. Displays results sorted by intent score — highest frustration first

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — hit "Scan Now" or toggle auto-scan.

## Project Structure

```
src/
  app/
    page.tsx                  # UI — controls, auto-scan, accumulated post feed
    layout.tsx                # Root layout
    api/
      scrape/
        route.ts              # API route — fetches Reddit, applies scoring + filters
  lib/
    filters.ts                # Intent scoring engine — all signal lists, scoring logic, filters
```

## API Reference

### `GET /api/scrape`

Fetches and scores Reddit posts.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `subreddits` | string | **required** | Comma-separated subreddit names |
| `sort` | string | `new` | Reddit sort: `new`, `hot`, `top`, `rising` |
| `maxAgeHours` | number | `12` | Only include posts from the last N hours |
| `maxComments` | number | `15` | Skip crowded threads (early-bird filter) |
| `minUpvotes` | number | `3` | Minimum upvotes to include |
| `minComments` | number | `1` | Minimum comments to include |
| `minIntentScore` | number | `3` | Minimum intent score threshold |
| `requireTechRole` | boolean | `false` | Only include posts mentioning tech roles |

**Example:**
```
/api/scrape?subreddits=jobs,cscareerquestions,resumes&sort=new&maxAgeHours=24&minIntentScore=3
```

**Response:**
```json
{
  "totalFiltered": 18,
  "totalRaw": 500,
  "filters": { ... },
  "subreddits": [
    {
      "subreddit": "jobs",
      "posts": [
        {
          "id": "abc123",
          "title": "Applied to 500+ jobs, still nothing",
          "body": "...",
          "author": "user123",
          "subreddit": "jobs",
          "score": 45,
          "comments": 12,
          "created": "2026-03-01T10:30:00.000Z",
          "redditUrl": "https://www.reddit.com/r/jobs/comments/abc123/...",
          "intentScore": 9,
          "matchedSignals": ["pain: \"still nothing\"", "volume: \"500+ jobs\""]
        }
      ],
      "count": 5,
      "rawCount": 100
    }
  ],
  "scrapedAt": "2026-03-01T12:00:00.000Z"
}
```

## Intent Scoring System

Each post is scored by combining signals from its title + body text.

### Signal Categories

| Category | Points | Cap | What It Matches |
|----------|--------|-----|-----------------|
| **Pain phrases** | +2 each | +6 (3 max) | "no interview", "ghosted", "getting rejected", "losing hope", etc. |
| **Volume patterns** | +2 each | +4 (2 max) | "200 applications", "500+ apps", "applied to 300", "6 months applying", etc. |
| **Tech keywords** | +1 | +1 (1 max) | "developer", "software", "engineer", "QA", "devops", etc. |
| **Exclude phrases** | -100 | instant | "suicidal", "mental health crisis", "self harm" (sensitive content filtered out) |

**Maximum possible score: 11** (6 pain + 4 volume + 1 tech)

### Score Thresholds

| Score | Label | Meaning |
|-------|-------|---------|
| 7+ | HIGH INTENT | Multiple strong signals — prime target |
| 5-6 | STRONG | Clear frustration with volume evidence |
| 3-4 | MODERATE | Some pain signals detected |
| < 3 | LOW | Filtered out by default |

### High-Intent Bypass

Posts with intent score >= 5 **bypass engagement filters** (min upvotes, min comments, max comments). This ensures high-signal posts from small subreddits with low engagement still surface.

## Filter Details

### Pain Phrases (`PAIN_PHRASES`)

Emotional signals indicating job search frustration. Currently 42 phrases including:

- Direct frustration: "no interview", "no response", "ghosted", "getting rejected"
- Desperation: "what am i doing wrong", "losing hope", "ready to give up"
- Volume indicators: "hundreds of applications", "months of applying"
- Help-seeking: "need a job", "please help", "someone help"

### Volume Patterns (`VOLUME_PATTERNS`)

Regex patterns matching numerical frustration signals. 7 patterns covering:

- **N + noun**: "200 applications", "500 apps", "100 jobs", "50 companies", "30 rejections"
- **N+**: "100+", "200+", "300+" (standalone plus sign)
- **Verb + N**: "applied to 150", "sent out 80", "submitted 200"
- **Qualifier + N + noun**: "over 200 applications", "more than 100 jobs", "almost 500 apps"
- **Time + activity**: "6 months applying", "2 years searching", "3 weeks trying"

**Volume nouns recognized:** applications, apps, resumes, jobs, companies, positions, interviews, places, roles, openings, rejections

### Tech Keywords (`TECH_KEYWORDS`)

25 role keywords to narrow results to tech ICP: developer, software, engineer, backend, frontend, QA, SDET, devops, data scientist, data engineer, machine learning, cloud, sysadmin, cybersecurity, product manager, UI/UX, SRE, platform engineer, etc.

### Exclude Phrases (`EXCLUDE_PHRASES`)

12 phrases for sensitive content that should not be treated as distribution leads: suicidal, suicide, mental health crisis, self harm, abuse, etc. These posts score -100 and are always filtered out.

## Auto-Scan Feature

Toggle auto-scan in the UI to run periodic scans without manual intervention.

- **Intervals:** 5 min, 15 min, 30 min, 1 hr, 2 hr
- **Deduplication:** Tracks seen post IDs — only notifies on genuinely new posts
- **Desktop notifications:** Browser Notification API — works even with tab minimized
- **Sound alert:** Short 880Hz beep via Web Audio API
- **Countdown timer:** Shows time until next scan
- **Scan log:** Expandable log with timestamps for every scan result
- **Accumulated feed:** All found posts merge into one feed sorted by intent score

### How It Works Internally

- Uses `setInterval` for the scan timer and a separate 1-second countdown
- `runScan` is stored in a ref (`runScanRef`) to prevent the interval from resetting when state changes
- The effect only re-runs when `autoScanEnabled` or `scanIntervalMins` change — not on every render

## Default Subreddits

```
jobs, cscareerquestions, resumes, jobsearchhacks, careerguidance
```

### Other Recommended Subreddits

```
ResumeExperts, recruitinghell, layoffs, ITCareerQuestions, ExperiencedDevs,
cscareerquestionsEU, jobsearch, WorkOnline, remotework, findapath
```

## Adding New Signals

### Adding a Pain Phrase

Edit `src/lib/filters.ts` — add to the `PAIN_PHRASES` array:

```ts
export const PAIN_PHRASES = [
  // ... existing phrases
  "your new phrase here",  // lowercase, will be matched case-insensitively
];
```

### Adding a Volume Pattern

Add a new regex to `VOLUME_PATTERNS`:

```ts
export const VOLUME_PATTERNS = [
  // ... existing patterns
  /your-regex-here/i,
];
```

If you need to add new nouns (like "apps" was added for "applications"), update the `VOL_NOUNS` constant:

```ts
const VOL_NOUNS = "applications?|apps|resumes?|jobs?|companies|...your-new-noun...";
```

### Adding a Tech Keyword

Add to `TECH_KEYWORDS`:

```ts
export const TECH_KEYWORDS = [
  // ... existing keywords
  "your keyword",
];
```

### Adjusting Scoring Weights

In `scorePost()` function:

- Pain phrases: Change `painHits * 2` (currently +2 per hit)
- Volume patterns: Change `volumeHits * 2` (currently +2 per hit)
- Pain cap: Change `if (painHits >= 3) break` (currently max 3 hits)
- Volume cap: Change `if (volumeHits >= 2) break` (currently max 2 hits)
- Tech bonus: Change `intentScore += 1` (currently +1)
- High-intent bypass threshold: Change `post.intentScore >= 5` in `filterAndScorePosts()`

## Tech Stack

- **Next.js 16** with App Router
- **TypeScript**
- **Tailwind CSS**
- **Reddit JSON API** (no auth required, public data only)
- **Web Audio API** (notification sounds)
- **Notification API** (desktop notifications)

## Limitations

- Reddit's public JSON API returns max 100 posts per subreddit per request
- No auth/rate limiting on the API route (add if deploying publicly)
- Post deduplication is in-memory (resets on page refresh)
- Reddit may rate-limit requests if scanning many subreddits frequently (add delay between requests if hitting 429s)
