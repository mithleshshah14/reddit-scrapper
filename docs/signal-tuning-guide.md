# Signal Tuning Guide

How to tune the intent scoring system for better results.

## Common Issues & Fixes

### "I see a relevant post on Reddit but it's not showing up"

Debug checklist:
1. **Is the subreddit in the list?** Check if you've added it to the subreddits input.
2. **Freshness filter?** Default is 12 hours. Increase `maxAgeHours` if the post is older.
3. **Engagement filter?** Default requires 3+ upvotes and 1+ comments. Small subreddits often have posts with 0-1 upvotes.
   - Posts with intent score >= 5 bypass engagement filters automatically.
   - If the post scores < 5, lower `minUpvotes` or add more matching signals.
4. **Missing keyword?** Run this to check the score:
   ```bash
   cd reddit-scraper
   npx tsx -e "
   import { scorePost } from './src/lib/filters.ts';
   const result = scorePost('POST TITLE HERE', 'POST BODY HERE');
   console.log('Score:', result.intentScore);
   console.log('Signals:', result.matchedSignals);
   "
   ```
5. **Missing noun?** If they use a word like "apps" instead of "applications", add it to `VOL_NOUNS` in `filters.ts`.

### "Too many irrelevant posts"

- Increase `minIntentScore` (default 3 → try 5)
- Enable "Tech roles only" to filter for tech keywords
- Lower `maxAgeHours` for fresher posts only
- Lower `maxComments` to target early/uncrowded threads

### "Not enough posts"

- Add more subreddits (see recommended list in README)
- Increase `maxAgeHours` (12 → 24 or 48)
- Lower `minIntentScore` (3 → 2)
- Lower `minUpvotes` (3 → 0)
- Lower `minComments` (1 → 0)

## How Scoring Works — Deep Dive

### Pain Phrases

All matching is **case-insensitive** and done on `(title + " " + body).toLowerCase()`.

The system checks for **substring inclusion**, not word boundaries. So:
- "applied to" matches "I applied to 50 jobs" ✓
- "applied to" matches "she reapplied to the position" ✓ (be aware of partial matches)
- "ghosted" matches "I got ghosted again" ✓

**Contribution:** +2 per matched phrase, capped at 3 matches (+6 max).

### Volume Patterns

These use **regex** matching, which is more precise than substring matching.

Key patterns and what they catch:

| Pattern | Examples |
|---------|----------|
| `\d{2,}\s*\+?\s*(applications?\|apps\|jobs?\|...)` | "200 applications", "500 apps", "100+ jobs" |
| `\b\d{2,}\s*\+\b` | "100+", "200+", "50+" |
| `applied\s*(to\s*)?\d{2,}` | "applied to 300", "applied 200" |
| `(sent\|submitted)\s*(out\s*)?\d{2,}` | "sent out 80", "submitted 150" |
| `(over\|more than\|...)\s+\d{2,}\s+(noun)` | "over 500 applications", "more than 200 apps" |
| `\d{1,}\s*months?\s*(of\s*)?(applying\|...)` | "6 months applying", "3 months searching" |
| `\d{1,}\s*(weeks?\|years?)\s*(of\s*)?(applying\|...)` | "2 years looking", "3 weeks trying" |

**`\d{2,}` = 2+ digits.** This means numbers like "5" or "8" won't match (too common, too noisy). Only 10+ matches.

**Contribution:** +2 per matched pattern, capped at 2 matches (+4 max).

### Tech Keywords

Simple substring check. Only the first match counts (+1).

### Exclude Phrases

If ANY exclude phrase matches, score is set to -100 (effectively filtered out). These are sensitive content phrases where the person needs human support, not product marketing.

## Testing a Scoring Change

After modifying `filters.ts`, test with:

```bash
# Test a specific post
npx tsx -e "
import { scorePost } from './src/lib/filters.ts';
console.log(scorePost('YOUR TITLE', 'YOUR BODY'));
"

# Test against live Reddit data
curl -s 'http://localhost:3000/api/scrape?subreddits=jobs&maxAgeHours=72&minUpvotes=0&minComments=0&minIntentScore=0' | python -c "
import sys,json; sys.stdout.reconfigure(encoding='utf-8')
d=json.load(sys.stdin)
for s in d['subreddits']:
  for p in s['posts']:
    print(f'[{p[\"intentScore\"]}] {p[\"title\"][:70]}')
    print(f'    {p[\"matchedSignals\"]}')
"
```

## Scoring Examples

| Post | Score | Why |
|------|-------|-----|
| "Applied to 500+ jobs, no interviews, what am I doing wrong" | 9 | pain: "no interviews" (+2), pain: "what am i doing wrong" (+2), volume: "500+ jobs" (+2), volume: "applied to 500" (+2), tech: none. Capped at pain=3 hits=6, vol=2 hits=4 → but only 2 pain matched in title so 4+4=8... depends on body |
| "HELPPP OVER 500 apps and one call that never called back" | 6 | pain: "never called back" (+2), volume: "500 apps" (+2), volume: "over 500 apps" (+2) |
| "Software engineer, 200 applications, getting ghosted" | 7 | pain: "ghosted" (+2), volume: "200 applications" (+2), role: "software" (+1), volume: "200 applications" counted once → 2+2+2+1=7 |
| "Should I quit my retail job?" | 0 | No pain phrases, no volume, no tech keywords |
