# Base AI Gateway

A small, authenticated adapter between the read-only Base/Pendle monitor and **OmniRoute**. OmniRoute is the primary model-routing engine; this repository does not replace it or contain model weights.

## Architecture

1. Base RPC and Pendle/Morpho data sources provide timestamped market and on-chain facts.
2. The monitor validates prices, liquidity, quotes, fees, maturity and redemption details.
3. This gateway accepts the monitor's Anthropic Messages-style request and forwards it to OmniRoute's OpenAI-compatible `/v1/chat/completions` endpoint.
4. OmniRoute selects the configured model/provider and returns the analysis. The gateway converts the response to an Anthropic Messages-style response.

**The AI model is not a source of live market data.** It must analyze only the supplied facts and clearly identify missing or stale fields. No wallet, signing, trading or transaction functionality is included.

## Endpoints

- `POST /v1/messages`: Anthropic Messages-shaped request/response for text-only chat.
- `GET /v1/models`: lists configured upstream model identifiers (requires gateway authentication).
- `GET /healthz`: minimal public health status.

The legacy `POST /v1/chat/completions` path is not an OpenAI-compatible response endpoint; use `/v1/messages` from the monitor.

## Configure OmniRoute as the upstream

Run OmniRoute separately using its official deployment instructions:
https://github.com/cheaper-inference/OmniRoute

In OmniRoute:
1. Configure at least one model provider in its dashboard.
2. Enable API-key protection before exposing the API outside localhost.
3. Create/use an API key for server-to-server requests.
4. Keep its persistent data directory mounted (official Docker setup uses `/app/data`).

Then set this gateway's `PROVIDERS_JSON` to a **single OmniRoute entry**. The `baseUrl` must be the OmniRoute API base URL ending in `/v1`; the gateway appends `/chat/completions`.

Example for services on the same Docker network:

```json
[
  {
    "name": "omniroute",
    "baseUrl": "http://omniroute:20128/v1",
    "apiKey": "OMNIROUTE_SERVER_API_KEY",
    "model": "auto",
    "enabled": true
  }
]
```

If OmniRoute is hosted elsewhere, replace the base URL with its HTTPS origin plus `/v1`. Use a model ID supported by your OmniRoute configuration; `auto` is only valid if enabled/supported by that OmniRoute setup.

## Run this adapter locally

1. Copy `.env.example` to `.env`.
2. Set a long random `GATEWAY_API_KEY`.
3. Set `PROVIDERS_JSON` to the OmniRoute configuration above, using your actual server-side API key.
4. Run:

```sh
npm start
npm test
```

Health check: `GET http://localhost:8787/healthz`.

Example request:

```sh
curl http://localhost:8787/v1/messages \
  -H "Authorization: Bearer YOUR_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","max_tokens":300,"messages":[{"role":"user","content":"Analyze only the supplied timestamped data."}]}'
```

## Environment

Required:
- `GATEWAY_API_KEY`: secret key used by the monitor to call this adapter.
- `PROVIDERS_JSON`: JSON array containing the OmniRoute upstream URL, API key and model.

Optional:
- `PORT` (default 8787)
- `HOST` (default 0.0.0.0)
- `MAX_BODY_BYTES` (default 1048576)
- `RATE_LIMIT_PER_MINUTE` (default 30)
- `REQUEST_TIMEOUT_MS` (default 60000)

Never commit `.env`, real provider keys, OmniRoute keys, or the gateway key. Store them only in deployment secret/environment settings. Do not expose the gateway key in browser-side JavaScript.

## Security and operating limits

- Use HTTPS in production and keep both services behind authentication.
- Keep OmniRoute's database/data volume persistent; ephemeral storage can lose provider connections and configuration.
- Rate limiting in this adapter is process-local.
- The adapter currently supports text chat only; tool use, vision and streaming are not implemented.
- Validate all model output against independently fetched chain/API data before showing a candidate.
- This repository does not deploy or host OmniRoute. A live endpoint exists only after both services are deployed and tested.

## Tests

Run `npm test`. Tests use Node's built-in test runner and require no third-party packages.
