# Future Ideas & Enhancements

## High Priority

### Reddit Search Mode
Instead of scanning specific subreddits, search across ALL of Reddit using pain keywords.
- Use `https://www.reddit.com/search.json?q=KEYWORD&sort=new`
- Catches posts from niche subs we haven't added (e.g., r/ResumeExperts)
- Could run as a separate mode alongside subreddit scanning

### Persistent Storage
Currently all data (seen IDs, accumulated posts, scan log) resets on page refresh.
- Option 1: localStorage — simple, client-only
- Option 2: SQLite/JSON file — server-side, survives restarts
- Option 3: Firestore/Supabase — if deploying to cloud

### Export Results
- CSV export of all accumulated posts (title, URL, intent score, signals)
- One-click "Copy Reddit URL" for quick commenting
- Bulk export for analysis

## Medium Priority

### Comment Draft Generator
Given a high-intent post, generate a helpful comment draft that:
- Acknowledges their pain (empathy first)
- Offers a specific, actionable tip
- Soft-mentions HuntWise AI as a tool that could help
- Uses OpenAI API to tailor the response to the specific post

### Subreddit Discovery
Auto-discover new relevant subreddits by:
- Checking where post authors also post
- Reddit's related subreddit suggestions
- Tracking which subs produce the highest intent scores

### Historical Tracking
- Track intent scores over time per subreddit
- Identify trending pain points (e.g., "ghosted" spiking)
- Best times to scan (when frustration posts peak)

### Email/Discord Notifications
Instead of browser notifications (requires tab open):
- Discord webhook — send high-intent posts to a channel
- Email digest — daily/hourly summary of top posts
- Telegram bot — real-time alerts

## Low Priority / Nice to Have

### Multi-platform
Extend beyond Reddit:
- Hacker News (`/ask` posts about job hunting)
- Twitter/X (search for job frustration tweets)
- LinkedIn (harder — requires auth)
- Blind (anonymous tech worker posts)

### Dashboard Analytics
- Posts found per day/week
- Average intent score trends
- Top subreddits by high-intent post volume
- Response rate tracking (if you comment, did they engage?)

### Comment Tracking
- Log which posts you've commented on
- Track upvotes/replies on your comments
- A/B test different comment styles

### Sentiment Analysis
Replace keyword matching with LLM-based sentiment analysis:
- More accurate than keyword matching
- Can catch frustration expressed in novel ways
- Slower and costs money (API calls per post)

## Architecture Notes for Scaling

### If deploying to Vercel:
- Add Vercel Cron Jobs for server-side auto-scanning
- Use Vercel KV or Upstash Redis for seen-post deduplication
- Add rate limiting to the API route

### If adding a database:
- Posts table: id, title, body, author, subreddit, score, comments, intentScore, signals, createdAt, scannedAt
- Scans table: id, timestamp, subreddits, rawCount, filteredCount, config
- Comments table: id, postId, commentText, postedAt, upvotes

### Reddit API limits:
- Public JSON API: ~60 requests/minute (no auth)
- With OAuth: 100 requests/minute
- If hitting limits, add delays between subreddit fetches or use OAuth
