# Swipely — Backend

API and monitoring services for **Swipely**, a cross-chain bridge and DEX
liquidity monitoring platform for the Stellar network. This service ingests
on-chain and off-chain data, computes bridge-health and liquidity metrics,
exposes a REST + WebSocket API, and dispatches alerts.

## Tech stack

- **Node.js** + **TypeScript**
- **Fastify 5** (REST, WebSockets, Swagger/OpenAPI)
- **PostgreSQL** via **Knex** (migrations + seeds)
- **Redis** + **BullMQ** for queues and background jobs
- **@stellar/stellar-sdk** and **ethers** for chain access
- **Prometheus** (`prom-client`) metrics, **pino** logging
- Alerting via **Discord**, **Telegram**, and email (**nodemailer**)
- **Zod** for validation, **Vitest** for tests

## Getting started

```bash
npm install
cp .env.example .env        # then fill in the values
npm run migrate             # apply database migrations
npm run dev                 # start the API in watch mode
```

## Useful scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the API with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm run migrate` | Apply migrations |
| `npm run seed` | Seed the database |
| `npm run test` | Run the test suite |
| `npm run docs:generate` | Generate the OpenAPI spec |

## Observability

Prometheus scrape config, alert rules, and a Grafana dashboard live alongside the
service (`prometheus.yml`, `prometheus-alerts.yml`, `grafana/`). See
`METRICS_QUICKSTART.md` for a fast local setup.

## Environment variables

All variables are validated at startup by a [Zod](https://zod.dev) schema in
`src/config/index.ts`. The process exits immediately with a clear error if any
required variable is missing or malformed. Secret values are **never** included
in error output — only the variable name appears.

Copy `.env.example` to `.env` and fill in the values. The table below lists
every variable the app reads.

> **Legend** — Required ★ means the app will not start without it in production.
> Variables with a default are optional everywhere.

### Application

| Variable | Purpose | Default | Required |
|---|---|---|---|
| `NODE_ENV` | Runtime environment | `development` | — |
| `PORT` | HTTP server port | `3001` | — |
| `WS_PORT` | WebSocket server port | `3002` | — |
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed CORS origins (production) | — | — |

### Security

| Variable | Purpose | Default | Required |
|---|---|---|---|
| `JWT_SECRET` | Signs export download tokens (min 32 chars) | — | ★ production |
| `CONFIG_ENCRYPTION_KEY` | Encrypts sensitive config values at rest (min 32 chars) | — | ★ production |
| `API_KEY_BOOTSTRAP_TOKEN` | Seeds the first admin API key on first run | — | — |

### PostgreSQL / TimescaleDB

| Variable | Purpose | Default | Required |
|---|---|---|---|
| `POSTGRES_HOST` | Database host | `localhost` | — |
| `POSTGRES_PORT` | Database port | `5432` | — |
| `POSTGRES_DB` | Database name | `bridge_watch` | — |
| `POSTGRES_USER` | Database user | `bridge_watch` | — |
| `POSTGRES_PASSWORD` | Database password | `bridge_watch_dev` | ★ production |

### Redis

| Variable | Purpose | Default | Required |
|---|---|---|---|
| `REDIS_HOST` | Redis host | `localhost` | — |
| `REDIS_PORT` | Redis port | `6379` | — |
| `REDIS_PASSWORD` | Redis auth password | `""` | — |
| `REDIS_CLUSTER` | Set `"true"` to enable Cluster mode in production | — | — |

### Stellar

| Variable | Purpose | Default | Required |
|---|---|---|---|
| `STELLAR_NETWORK` | `testnet` or `mainnet` | `testnet` | — |
| `STELLAR_HORIZON_URL` | Horizon endpoint | `https://horizon-testnet.stellar.org` | — |
| `SOROBAN_RPC_URL` | Soroban RPC endpoint | `https://soroban-testnet.stellar.org` | — |
| `SOROBAN_MAINNET_RPC_URL` | Mainnet Soroban RPC endpoint | — | — |
| `CIRCUIT_BREAKER_CONTRACT_ID` | Soroban circuit-breaker contract | — | — |
| `LIQUIDITY_CONTRACT_ADDRESS` | Soroban liquidity contract | — | — |

### Ethereum / EVM

| Variable | Purpose | Default | Required |
|---|---|---|---|
| `ETHEREUM_RPC_URL` | Ethereum JSON-RPC endpoint | — | — |
| `ETHEREUM_RPC_WS_URL` | Ethereum WebSocket RPC endpoint | — | — |
| `ETHEREUM_RPC_FALLBACK_URL` | Fallback Ethereum RPC | — | — |
| `RPC_PROVIDER_TYPE` | `http` or `ws` | `http` | — |
| `USDC_BRIDGE_ADDRESS` | USDC bridge contract address | — | — |
| `EURC_BRIDGE_ADDRESS` | EURC bridge contract address | — | — |
| `USDC_TOKEN_ADDRESS` | USDC ERC-20 token address | — | — |
| `EURC_TOKEN_ADDRESS` | EURC ERC-20 token address | — | — |
| `POLYGON_RPC_URL` | Polygon RPC endpoint | — | — |
| `POLYGON_RPC_FALLBACK_URL` | Fallback Polygon RPC | — | — |
| `BASE_RPC_URL` | Base chain RPC endpoint | — | — |
| `BASE_RPC_FALLBACK_URL` | Fallback Base chain RPC | — | — |

### External APIs

| Variable | Purpose | Default | Required |
|---|---|---|---|
| `CIRCLE_API_KEY` | Circle API key for USDC/EURC data | — | — |
| `CIRCLE_API_URL` | Circle API base URL | `https://api.circle.com` | — |
| `CIRCLE_API_TIMEOUT_MS` | Circle request timeout (ms) | `5000` | — |
| `CIRCLE_CACHE_TTL_SEC` | Redis TTL for Circle responses (s) | `60` | — |
| `CIRCLE_RATE_LIMIT_MAX` | Circle rate-limit max requests per window | `30` | — |
| `CIRCLE_RATE_LIMIT_WINDOW_MS` | Circle rate-limit window (ms) | `60000` | — |
| `COINBASE_API_KEY` | Coinbase Advanced Trade API key | — | — |
| `COINBASE_API_SECRET` | Coinbase Advanced Trade API secret | — | — |
| `ONEINCH_API_KEY` | 1inch EVM DEX aggregator API key | — | — |
| `COINMARKETCAP_API_KEY` | CoinMarketCap API key | — | — |
| `COINGECKO_API_KEY` | CoinGecko demo API key (higher rate limits) | — | — |

### Logging

| Variable | Purpose | Default | Required |
|---|---|---|---|
| `LOG_LEVEL` | Minimum log level (`fatal`…`trace`) | `info` | — |
| `LOG_FILE` | Write logs to file path (production) | — | — |
| `LOG_MAX_FILE_SIZE` | Max log file size in bytes | `104857600` | — |
| `LOG_MAX_FILES` | Max number of rotated log files | `10` | — |
| `LOG_RETENTION_DAYS` | Days to retain log files | `30` | — |
| `LOG_REQUEST_BODY` | Log incoming request bodies | `false` | — |
| `LOG_RESPONSE_BODY` | Log outgoing response bodies | `false` | — |
| `LOG_SENSITIVE_DATA` | Allow sensitive data in logs (must be `false` in prod) | `false` | — |
| `REQUEST_SLOW_THRESHOLD_MS` | Log warning for requests slower than this (ms) | `1000` | — |

### Rate Limiting

| Variable | Purpose | Default | Required |
|---|---|---|---|
| `RATE_LIMIT_MAX` | Global max requests per window | `100` | — |
| `RATE_LIMIT_WINDOW_MS` | Rate-limit window duration (ms) | `60000` | — |
| `RATE_LIMIT_BURST_MULTIPLIER` | Burst allowance fraction of max | `0.1` | — |
| `RATE_LIMIT_WHITELIST_IPS` | Comma-separated IPs that bypass limiting | — | — |
| `RATE_LIMIT_WHITELIST_KEYS` | Comma-separated API keys that bypass limiting | — | — |
| `RATE_LIMIT_ENABLE_DYNAMIC` | Enable dynamic rate limiting | `true` | — |
| `RATE_LIMIT_STATS_RETENTION_HOURS` | How long to retain rate-limit stats | `168` | — |
| `RATE_LIMIT_ENDPOINT_ASSETS` | Per-window limit for `/assets` | `200` | — |
| `RATE_LIMIT_ENDPOINT_BRIDGES` | Per-window limit for `/bridges` | `150` | — |
| `RATE_LIMIT_ENDPOINT_ALERTS` | Per-window limit for `/alerts` | `50` | — |
| `RATE_LIMIT_ENDPOINT_ANALYTICS` | Per-window limit for `/analytics` | `100` | — |
| `RATE_LIMIT_ENDPOINT_CONFIG` | Per-window limit for `/config` | `30` | — |
| `RATE_LIMIT_ENDPOINT_HEALTH` | Per-window limit for `/health` | `1000` | — |

### Price Provider Rate Limiting & Fallback

Per-provider outbound rate limits for the price aggregation pipeline. Each provider
keeps an independent Redis counter, so throttling one source never throttles the
others. Throttled or tripped providers fall back to their last-known-good cached
price (marked stale) instead of fabricating data.

| Variable | Purpose | Default | Required |
|---|---|---|---|
| `SDEX_RATE_LIMIT_MAX` | Stellar DEX (Horizon order book) max requests per window | `30` | — |
| `SDEX_RATE_LIMIT_WINDOW_MS` | Stellar DEX rate-limit window (ms) | `60000` | — |
| `AMM_RATE_LIMIT_MAX` | Stellar AMM (Horizon liquidity pools) max requests per window | `30` | — |
| `AMM_RATE_LIMIT_WINDOW_MS` | Stellar AMM rate-limit window (ms) | `60000` | — |
| `PRICE_PROVIDER_CACHE_TTL_SEC` | TTL (s) for last-known-good per-provider price fallback | `300` | — |

### Email (SMTP)

| Variable | Purpose | Default | Required |
|---|---|---|---|
| `SMTP_HOST` | SMTP server hostname | — | — |
| `SMTP_PORT` | SMTP server port | `587` | — |
| `SMTP_SECURE` | Use TLS (`true`/`false`) | `false` | — |
| `SMTP_USER` | SMTP authentication user | — | — |
| `SMTP_PASSWORD` | SMTP authentication password | — | — |
| `SMTP_FROM_ADDRESS` | Sender email address | `noreply@bridgewatch.io` | — |
| `SMTP_FROM_NAME` | Sender display name | `Bridge Watch` | — |

### Discord Bot

| Variable | Purpose | Default | Required |
|---|---|---|---|
| `DISCORD_BOT_TOKEN` | Discord bot token | — | — |
| `DISCORD_CLIENT_ID` | Discord application client ID | — | — |

### Telegram Bot

| Variable | Purpose | Default | Required |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | — | — |
| `TELEGRAM_WEBHOOK_URL` | Telegram webhook callback URL | — | — |
| `TELEGRAM_WEBHOOK_SECRET` | Shared secret to verify Telegram webhook calls | — | — |
| `TELEGRAM_ADMIN_CHAT_IDS` | Comma-separated admin Telegram chat IDs | — | — |
| `TELEGRAM_BOT_ENABLED` | Enable/disable the Telegram bot | `true` | — |

### Health Check

| Variable | Purpose | Default | Required |
|---|---|---|---|
| `HEALTH_CHECK_TIMEOUT_MS` | Timeout for individual health checks (ms) | `5000` | — |
| `HEALTH_CHECK_INTERVAL_MS` | Health check polling interval (ms) | `30000` | — |
| `HEALTH_CHECK_MEMORY_THRESHOLD` | % heap usage before status → degraded | `90` | — |
| `HEALTH_CHECK_DISK_THRESHOLD` | % disk usage before status → degraded | `80` | — |
| `MAINTENANCE_MODE` | Enable maintenance mode | `false` | — |
| `MAINTENANCE_MESSAGE` | Maintenance status message | `""` | — |
| `MAINTENANCE_SEVERITY` | Maintenance severity level | `info` | — |
| `STATUS_PAGE_URL` | Public status page URL | — | — |

### Export Service

| Variable | Purpose | Default | Required |
|---|---|---|---|
| `EXPORT_STORAGE_PATH` | Directory to store exported files | `./exports` | — |
| `EXPORT_DOWNLOAD_URL_EXPIRY_HOURS` | Hours before download URL expires | `24` | — |
| `EXPORT_COMPRESSION_THRESHOLD_BYTES` | Compress exports larger than this | `1048576` | — |
| `EXPORT_STREAMING_PAGE_SIZE` | Rows per page when streaming exports | `1000` | — |
| `EXPORT_QUEUE_CONCURRENCY` | Concurrent export jobs | `3` | — |
| `EXPORT_MAX_DATE_RANGE_DAYS` | Maximum allowed export date range | `90` | — |

### Compliance Reports

| Variable | Purpose | Default | Required |
|---|---|---|---|
| `REPORT_DIR` | Directory for generated compliance reports | `./reports` | — |
| `ARCHIVE_DIR` | Directory for archived reports | `./archives` | — |
| `REPORT_SIGNING_KEY_PATH` | Path to PEM key used to sign reports | — | — |

### Background Jobs

| Variable | Purpose | Default | Required |
|---|---|---|---|
| `RECONCILIATION_INTERVAL_MS` | Batch reconciliation poll interval | `600000` | — |
| `SOURCE_DECOMMISSION_CHECK_INTERVAL_MS` | Source decommission readiness check interval | `3600000` | — |
| `PROVIDER_BREAKER_PROBE_INTERVAL_MS` | Provider circuit-breaker probe sweep interval | `30000` | — |
| `BRIDGE_VERIFICATION_INTERVAL_MS` | Bridge supply verification interval | `300000` | — |

### BullMQ Queue Rate Limiting

| Variable | Purpose | Default | Required |
|---|---|---|---|
| `QUEUE_RATE_MAX_CRITICAL` | Max jobs per window for `critical` queue | `1000` | — |
| `QUEUE_RATE_DURATION_MS_CRITICAL` | Window duration for `critical` queue (ms) | `1000` | — |
| `QUEUE_RATE_MAX_HIGH` | Max jobs per window for `high` queue | `1000` | — |
| `QUEUE_RATE_DURATION_MS_HIGH` | Window duration for `high` queue (ms) | `1000` | — |
| `QUEUE_RATE_MAX_NORMAL` | Max jobs per window for `normal` queue | `1000` | — |
| `QUEUE_RATE_DURATION_MS_NORMAL` | Window duration for `normal` queue (ms) | `1000` | — |
| `QUEUE_RATE_MAX_LOW` | Max jobs per window for `low` queue | `1000` | — |
| `QUEUE_RATE_DURATION_MS_LOW` | Window duration for `low` queue (ms) | `1000` | — |

### Miscellaneous

| Variable | Purpose | Default | Required |
|---|---|---|---|
| `CORRELATION_THRESHOLD` | Incident correlation similarity score (0–1) | `0.6` | — |
| `WS_AUTH_SECRET` | Secret for private WebSocket channel auth | — | ★ production |
| `RETRY_MAX` | Max retry attempts for external calls | `3` | — |
| `PRICE_DEVIATION_THRESHOLD` | Fraction deviation that triggers a price alert | `0.02` | — |
| `BRIDGE_SUPPLY_MISMATCH_THRESHOLD` | Fraction mismatch that triggers a supply alert | `0.1` | — |

## Related repositories

- [`swipely_frontend`](https://github.com/stellar-kracken/swipely_frontend) — dashboard UI
- [`swipely_contract`](https://github.com/stellar-kracken/swipely_contract) — Soroban smart contracts

## License

MIT — see [`LICENSE`](./LICENSE).
