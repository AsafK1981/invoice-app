"use strict";

/**
 * Israeli-egress reverse proxy for the Israel Tax Authority ("חשבונית ישראל")
 * API. gov.il geo-blocks non-Israeli source IPs, and Vercel has no Israel
 * region — so the SaaS (running in Vercel/fra1) cannot reach the token /
 * allocation endpoints directly. This service runs on Cloud Run me-west1
 * (Tel Aviv); its Google-Israel egress IP is accepted by gov.il.
 *
 * It is NOT an open relay:
 *   - only the two known gov hosts are reachable, selected by path prefix;
 *   - every request must carry x-proxy-key === PROXY_KEY (shared secret).
 *
 * Path mapping (everything after the prefix is preserved verbatim):
 *   /openapi/<rest>  ->  https://openapi.taxes.gov.il/<rest>
 *   /ita/<rest>      ->  https://ita-api.taxes.gov.il/<rest>
 *   /health          ->  200 (no auth; for Cloud Run health checks)
 */

const http = require("node:http");

const PORT = process.env.PORT || 8080;
const PROXY_KEY = process.env.PROXY_KEY || "";

const UPSTREAMS = {
  openapi: "https://openapi.taxes.gov.il",
  ita: "https://ita-api.taxes.gov.il",
};

// Hop-by-hop / connection-specific headers we must not forward upstream.
const STRIP_REQ_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "x-proxy-key",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "forwarded",
]);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const segments = url.pathname.split("/").filter(Boolean);

    if (segments[0] === "health") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }

    if (!PROXY_KEY || req.headers["x-proxy-key"] !== PROXY_KEY) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "forbidden" }));
      return;
    }

    const target = UPSTREAMS[segments[0]];
    if (!target) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unknown_upstream" }));
      return;
    }

    const rest = segments.slice(1).join("/");
    const upstreamUrl = `${target}/${rest}${url.search}`;

    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!STRIP_REQ_HEADERS.has(k.toLowerCase()) && v !== undefined) {
        headers[k] = Array.isArray(v) ? v.join(", ") : v;
      }
    }

    const method = req.method || "GET";
    const hasBody = method !== "GET" && method !== "HEAD";
    const body = hasBody ? await readBody(req) : undefined;

    const upstreamRes = await fetch(upstreamUrl, {
      method,
      headers,
      body: body && body.length ? body : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(25_000),
    });

    const buf = Buffer.from(await upstreamRes.arrayBuffer());
    const outHeaders = {};
    upstreamRes.headers.forEach((value, key) => {
      const lk = key.toLowerCase();
      if (lk === "transfer-encoding" || lk === "connection" || lk === "content-encoding") return;
      outHeaders[key] = value;
    });
    res.writeHead(upstreamRes.status, outHeaders);
    res.end(buf);
  } catch (err) {
    const cause = err && err.cause ? err.cause : {};
    res.writeHead(502, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: "upstream_fetch_failed",
        message: err && err.message,
        causeCode: cause.code,
        causeMessage: cause.message,
      }),
    );
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`il-tax-proxy listening on :${PORT}`);
});
