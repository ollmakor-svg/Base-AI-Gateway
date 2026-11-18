# Base AI Gateway

A small, self-hostable gateway that accepts Anthropic Messages-style requests and forwards them to configured OpenAI-compatible model providers. It is intended as an AI analysis layer for the read-only Base/Pendle monitor.

## What it does

- `POST /v1/messages`: Anthropic Messages-shaped request and response for text-only chat.
- `POST /v1/chat/completions`: accepts the same message input and currently returns the Anthropic-shaped response.
- `GET /v1/models`: lists configured model identifiers (requires gateway authentication).
- Provider fallback: tries enabled providers in the order in `PROVIDERS_JSON`.
- Bearer-key authentication, per-IP in-memory rate limiting, request-size limit, upstream timeout, and no wildcard CORS.
- `GET /healthz` is public and reveals no provider or secret information.

## Important compatibility limits

This is a lightweight text-chat compatibility layer, not the Claude model and not a complete Anthropic API implementation. Tool use, vision, streaming, prompt caching, and provider-specific features are not implemented. Provider endpoints must expose an OpenAI-compatible `/chat/completions` route. Validate outputs before using them in financial research.

## Run locally (Node.js 20+)

1. Copy `.env.example` to `.env`.
2. Set a long random `GATEWAY_API_KEY`.
3. Replace provider placeholders in `PROVIDERS_JSON` with actual provider keys and model IDs.
4. Run:

```sh
npm start
```

Health check: `GET http://localhost:8787/healthz`.

Example request:

```sh
curl http://localhost:8787/v1/messages \
  -H "Authorization: Bearer YOUR_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"any","max_tokens":300,"messages":[{"role":"user","content":"Summarize this data."}]}'
```

## Deployment configuration

Set environment variables in the hosting provider's secret/environment settings. Do not commit `.env`, provider API keys, or gateway keys. Keep the service private or behind authentication. Use persistent/managed secret storage; do not expose the gateway key in browser-side JavaScript.

Required:
- `GATEWAY_API_KEY`
- `PROVIDERS_JSON`

Optional:
- `PORT` (default 8787)
- `HOST` (default 0.0.0.0)
- `MAX_BODY_BYTES` (default 1048576)
- `RATE_LIMIT_PER_MINUTE` (default 30)
- `REQUEST_TIMEOUT_MS` (default 60000)

`PROVIDERS_JSON` example (replace values; do not use placeholders in production):

```json
[
  {
    "name": "groq",
    "baseUrl": "https://api.groq.com/openai/v1",
    "apiKey": "provider-secret",
    "model": "provider-model-id",
    "enabled": true
  },
  {
    "name": "openrouter",
    "baseUrl": "https://openrouter.ai/api/v1",
    "apiKey": "another-provider-secret",
    "model": "another-model-id",
    "enabled": true
  }
]
```

## Read-only Base monitor integration

Configure the monitor's server-side AI client to use:
- Base URL: your gateway URL
- API key: `GATEWAY_API_KEY`
- Endpoint: `/v1/messages`
- Model: any configured model identifier (the gateway selects providers by configured order)

Keep blockchain RPC/Pendle/Morpho data collection separate from model inference. The model must analyze supplied, timestamped data; it must not invent live prices, liquidity, quotes, or on-chain verification. This gateway has no wallet, signing, trading, or transaction functionality.

## Tests

Run `npm test`. Tests use Node's built-in test runner and require no third-party packages.

## Security notes

- Use HTTPS in production.
- Use a unique, high-entropy gateway key and rotate it if exposed.
- Store provider credentials only as host environment secrets.
- Rate limiting is process-local; use an upstream proxy or shared limiter for multi-instance deployments.
- Do not expose this service publicly without gateway authentication and operational monitoring.
