/**
 * Lightweight per-IP / per-user rate limiter for Next.js API routes.
 *
 * In-memory token bucket. Each Vercel function instance has its own
 * map, which means an attacker spread across many cold starts could
 * still exceed the per-instance budget — but for the realistic abuse
 * cases (a single bad actor hammering one endpoint from one machine),
 * this is plenty as a first defense.
 *
 * For stricter limits we'd plug Upstash Redis or Vercel KV. Not yet.
 *
 * Usage:
 *   const rl = checkRate({ key: ip, max: 30, windowMs: 60_000 });
 *   if (!rl.ok) return NextResponse.json({...}, { status: 429 });
 */

interface Bucket {
  count: number;
  resetAt: number; // epoch ms
}

const buckets = new Map<string, Bucket>();

// Periodic cleanup so the map doesn't grow unbounded under attack.
// Runs at most once per minute per process.
let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

export interface RateCheck {
  key: string;
  max: number;
  windowMs: number;
}

export interface RateResult {
  ok: boolean;
  remaining: number;
  resetIn: number; // ms until the window resets
}

export function checkRate({ key, max, windowMs }: RateCheck): RateResult {
  const now = Date.now();
  sweep(now);

  const cur = buckets.get(key);
  if (!cur || cur.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: max - 1, resetIn: windowMs };
  }

  if (cur.count >= max) {
    return { ok: false, remaining: 0, resetIn: cur.resetAt - now };
  }

  cur.count++;
  return { ok: true, remaining: max - cur.count, resetIn: cur.resetAt - now };
}

/**
 * Best-effort client-IP extraction from Vercel headers. x-forwarded-for
 * is set by Vercel's edge; the first IP is the original client.
 * Falls back to "unknown" so we don't crash on local dev.
 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}
