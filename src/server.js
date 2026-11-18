import http from "node:http";
import { timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_BODY = Number(process.env.MAX_BODY_BYTES || 1_048_576);
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MINUTE || 30);
const TIMEOUT = Number(process.env.REQUEST_TIMEOUT_MS || 60_000);
const API_KEY = process.env.GATEWAY_API_KEY || "";

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function providersFromEnv() {
  try {
    const parsed = JSON.parse(process.env.PROVIDERS_JSON || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(p =>
      p && p.enabled !== false &&
      typeof p.name === "string" &&
      typeof p.baseUrl === "string" &&
      typeof p.apiKey === "string" && p.apiKey.length > 0 &&
      typeof p.model === "string" && p.model.length > 0
    );
  } catch {
    return [];
  }
}

const hits = new Map();
function allowed(ip) {
  const now = Date.now();
  const entry = hits.get(ip) || { start: now, count: 0 };
  if (now - entry.start >= 60_000) {
    entry.start = now;
    entry.count = 0;
  }
  entry.count += 1;
  hits.set(ip, entry);
  return entry.count <= RATE_LIMIT;
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  });
  res.end(body);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("Invalid JSON body"), { status: 400 }); }
}

function anthropicResponse(data, model) {
  const text = (data.choices || []).map(c => c.message?.content ?? "")
    .map(v => Array.isArray(v) ? v.map(x => x.text || "").join("") : String(v))
    .join("");
  return {
    id: "msg_gateway_" + Date.now(),
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text }],
    stop_reason: data.choices?.[0]?.finish_reason === "length" ? "max_tokens" : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0
    }
  };
}

async function callProvider(provider, body) {
  const url = provider.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "authorization": "Bearer " + provider.apiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: provider.model,
        messages: body.messages,
        max_tokens: Math.min(Number(body.max_tokens || 1024), 8192),
        temperature: body.temperature
      })
    });
    const raw = await response.text();
    if (!response.ok) throw new Error("Provider " + provider.name + " returned HTTP " + response.status);
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error("Provider returned invalid JSON"); }
    return anthropicResponse(data, provider.model);
  } finally {
    clearTimeout(timer);
  }
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/healthz") {
      return send(res, 200, { status: "ok", service: "base-ai-gateway" });
    }

    if (!API_KEY) return send(res, 503, { error: { type: "configuration_error", message: "GATEWAY_API_KEY is not configured" } });
    const auth = req.headers.authorization || "";
    const supplied = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!safeEqual(supplied, API_KEY)) {
      return send(res, 401, { error: { type: "authentication_error", message: "Invalid API key" } });
    }

    const ip = req.socket.remoteAddress || "unknown";
    if (!allowed(ip)) return send(res, 429, { error: { type: "rate_limit_error", message: "Rate limit exceeded" } });

    if (req.method === "GET" && url.pathname === "/v1/models") {
      return send(res, 200, { data: providersFromEnv().map(p => ({ id: p.model, object: "model", owned_by: p.name })), object: "list" });
    }

    if (req.method !== "POST" || !["/v1/messages", "/v1/chat/completions"].includes(url.pathname)) {
      return send(res, 404, { error: { type: "not_found_error", message: "Route not found" } });
    }

    let body;
    try { body = await readJson(req); }
    catch (error) { return send(res, error.status || 400, { error: { type: "invalid_request_error", message: error.message } }); }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return send(res, 400, { error: { type: "invalid_request_error", message: "messages must be a non-empty array" } });
    }

    const providers = providersFromEnv();
    if (!providers.length) return send(res, 503, { error: { type: "configuration_error", message: "No enabled providers configured" } });

    const failures = [];
    for (const provider of providers) {
      try {
        const result = await callProvider(provider, body);
        return send(res, 200, result);
      } catch (error) {
        failures.push(provider.name + ": " + error.message);
      }
    }
    return send(res, 502, { error: { type: "upstream_error", message: "All configured providers failed", details: failures } });
  });
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  createServer().listen(PORT, HOST, () => {
    console.log("Base AI Gateway listening on " + HOST + ":" + PORT);
  });
}
