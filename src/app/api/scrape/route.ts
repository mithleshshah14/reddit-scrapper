import { NextRequest, NextResponse } from "next/server";
import {
  filterAndScorePosts,
  DEFAULT_FILTER_CONFIG,
  type FilterConfig,
} from "@/lib/filters";

interface RedditPost {
  title: string;
  selftext: string;
  author: string;
  subreddit: string;
  score: number;
  num_comments: number;
  created_utc: number;
  permalink: string;
  url: string;
  id: string;
}

interface RedditApiChild {
  kind: string;
  data: RedditPost;
}

interface RedditApiResponse {
  data: {
    children: RedditApiChild[];
    after: string | null;
  };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const subreddits = searchParams.get("subreddits");
    const sort = searchParams.get("sort") || "new";

    // We fetch more than needed (100) so filtering still yields results
    const fetchLimit = 100;

    // Filter config from query params (with defaults)
    const config: FilterConfig = {
      maxAgeHours: parseFloat(searchParams.get("maxAgeHours") || String(DEFAULT_FILTER_CONFIG.maxAgeHours)),
      maxComments: parseInt(searchParams.get("maxComments") || String(DEFAULT_FILTER_CONFIG.maxComments)),
      minUpvotes: parseInt(searchParams.get("minUpvotes") || String(DEFAULT_FILTER_CONFIG.minUpvotes)),
      minComments: parseInt(searchParams.get("minComments") || String(DEFAULT_FILTER_CONFIG.minComments)),
      minIntentScore: parseInt(searchParams.get("minIntentScore") || String(DEFAULT_FILTER_CONFIG.minIntentScore)),
      requireTechRole: searchParams.get("requireTechRole") === "true",
    };

    if (!subreddits) {
      return NextResponse.json(
        { error: "Missing 'subreddits' query parameter. Pass comma-separated subreddit names." },
        { status: 400 }
      );
    }

    const subredditList = subreddits.split(",").map((s) => s.trim().toLowerCase());

    const results = await Promise.all(
      subredditList.map(async (subreddit) => {
        try {
          const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${fetchLimit}`;

          const response = await fetch(url, {
            headers: {
              "User-Agent": "RedditScraper/1.0 (NextJS App)",
            },
          });

          if (!response.ok) {
            return {
              subreddit,
              error: `Failed to fetch: ${response.status} ${response.statusText}`,
              posts: [],
              rawCount: 0,
            };
          }

          const data: RedditApiResponse = await response.json();

          const rawPosts = data.data.children
            .filter((child) => child.kind === "t3")
            .map((child) => ({
              id: child.data.id,
              title: child.data.title,
              body: child.data.selftext || "",
              author: child.data.author,
              subreddit: child.data.subreddit,
              score: child.data.score,
              comments: child.data.num_comments,
              created: new Date(child.data.created_utc * 1000).toISOString(),
              redditUrl: `https://www.reddit.com${child.data.permalink}`,
            }));

          const filteredPosts = filterAndScorePosts(rawPosts, config);

          return {
            subreddit,
            posts: filteredPosts,
            count: filteredPosts.length,
            rawCount: rawPosts.length,
          };
        } catch (err) {
          return {
            subreddit,
            error: err instanceof Error ? err.message : "Unknown error",
            posts: [],
            rawCount: 0,
          };
        }
      })
    );

    const totalFiltered = results.reduce((sum, r) => sum + (r.count || 0), 0);
    const totalRaw = results.reduce((sum, r) => sum + r.rawCount, 0);

    return NextResponse.json({
      totalFiltered,
      totalRaw,
      filters: config,
      subreddits: results,
      scrapedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Reddit scraper error:", error);
    return NextResponse.json(
      { error: "Failed to scrape Reddit" },
      { status: 500 }
    );
  }
}
