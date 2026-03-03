import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

const LEADS_KEY = "leads"; // sorted set: score = foundAt, member = id
const LEAD_TTL = 60 * 60 * 24 * 7; // 7 days

interface LeadPayload {
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
  foundAt: number; // epoch ms
}

// ── POST — store leads (auth required) ─────────────────────────
export async function POST(req: NextRequest) {
  const token = process.env.LEADS_API_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ error: "Redis not configured" }, { status: 503 });
  }

  let leads: LeadPayload[];
  try {
    leads = await req.json();
    if (!Array.isArray(leads)) throw new Error("Expected array");
  } catch {
    return NextResponse.json({ error: "Invalid body — expected JSON array" }, { status: 400 });
  }

  if (leads.length === 0) {
    return NextResponse.json({ stored: 0 });
  }

  const pipeline = redis.pipeline();

  for (const lead of leads) {
    const key = `lead:${lead.id}`;
    // Add to sorted set (score = foundAt for chronological ordering)
    pipeline.zadd(LEADS_KEY, { score: lead.foundAt, member: lead.id });
    // Store full lead data as a hash
    pipeline.hset(key, {
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
      foundAt: lead.foundAt,
    });
    pipeline.expire(key, LEAD_TTL);
  }

  await pipeline.exec();

  return NextResponse.json({ stored: leads.length });
}

// ── GET — fetch all leads (public) ─────────────────────────────
export async function GET() {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json([]);
  }

  // Get all IDs from sorted set (newest first)
  const ids: string[] = await redis.zrange(LEADS_KEY, 0, -1, { rev: true });

  if (ids.length === 0) {
    return NextResponse.json([]);
  }

  // Fetch all lead hashes in a pipeline
  const pipeline = redis.pipeline();
  for (const id of ids) {
    pipeline.hgetall(`lead:${id}`);
  }
  const results = await pipeline.exec();

  // Filter out expired ghosts (hash expired but sorted set entry remains)
  const ghostIds: string[] = [];
  const leads: LeadPayload[] = [];

  for (let i = 0; i < results.length; i++) {
    const data = results[i] as Record<string, string> | null;
    if (!data || Object.keys(data).length === 0) {
      ghostIds.push(ids[i]);
      continue;
    }
    leads.push({
      id: data.id,
      title: data.title,
      body: data.body,
      author: data.author,
      subreddit: data.subreddit,
      score: Number(data.score),
      comments: Number(data.comments),
      created: data.created,
      redditUrl: data.redditUrl,
      intentScore: Number(data.intentScore),
      matchedSignals: JSON.parse(data.matchedSignals as string),
      foundAt: Number(data.foundAt),
    });
  }

  // Clean up ghost entries from sorted set
  if (ghostIds.length > 0) {
    const cleanPipeline = redis.pipeline();
    for (const id of ghostIds) {
      cleanPipeline.zrem(LEADS_KEY, id);
    }
    await cleanPipeline.exec();
  }

  // Sort by intentScore descending
  leads.sort((a, b) => b.intentScore - a.intentScore);

  return NextResponse.json(leads);
}
