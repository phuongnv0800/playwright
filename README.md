# Browser Automation Platform

Generic single-tenant browser automation platform built around `Playwright self-host + PostgreSQL + pluggable AI/source/sink adapters`.

## What is implemented

- `control-api` with the internal endpoints from the plan:
  - `POST /sites`
  - `POST /sites/:id/discover`
  - `POST /sites/:id/recipes/:version/publish`
  - `POST /jobs/run`
  - `GET /jobs/:id`
  - `POST /reviews/:id/approve`
  - `POST /connectors/sinks/test`
  - `POST /sessions/:id/reauth`
  - `POST /crawl-from-url`
  - `GET /crawl-runs/:id`
  - `POST /crawl-runs/:id/approve`
  - `POST /crawl-runs/:id/retry-auth`
  - `GET /crawl-runs/:id/export`
- PostgreSQL schema for sites, accounts, recipes, sessions, jobs, artifacts, entities, sinks, templates, deliveries, and logs.
- `pg-boss` queue on PostgreSQL.
- Playwright session manager with storage-state persistence.
- Generic `SourceConnector` based on AI-drafted recipes.
- URL-only crawl runtime with heuristic/AI discovery, recipe freeze, page-level crawl tracking, exports, and sink delivery.
- Auth orchestrator with form login, generic OAuth browser flow, TOTP, IMAP/webhook OTP, and 2captcha-compatible CAPTCHA hooks.
- `echo` and `webhook` sink connectors.
- AI abstraction with `stub`, `openai-compatible`, and optional `codex-auth` providers.

## Run locally

1. Copy `.env.example` to `.env`.
2. Start PostgreSQL:

```bash
docker compose up -d postgres
```

3. Run migrations:

```bash
npm run db:migrate
```

4. Start the API and worker in separate terminals:

```bash
npm run dev:api
npm run dev:worker
```

## Docker Compose

To run the whole stack with containers:

```bash
docker compose up --build postgres migrate api worker
```

## URL-only crawl API

Create a crawl run from a single URL:

```bash
curl -X POST http://localhost:3000/crawl-from-url \
  -H 'content-type: application/json' \
  -d '{
    "url": "https://example.com/list",
    "auth": {
      "mode": "auto"
    },
    "sink": {
      "enabled": true,
      "sinkType": "webhook",
      "config": {
        "endpoint": "http://localhost:4000/webhook",
        "method": "POST"
      },
      "template": {
        "externalId": "{{entity.externalId}}",
        "title": "{{entity.data.title}}",
        "sourceUrl": "{{entity.data.sourceUrl}}"
      }
    },
    "crawl": {
      "maxDepth": 2,
      "maxPages": 200,
      "maxRecords": 100,
      "sameOriginOnly": true
    }
  }'
```

Then poll the crawl run:

```bash
curl http://localhost:3000/crawl-runs/<crawlRunId>
```

If the run stops at `needs_review`, approve it to publish the latest draft recipe and resume:

```bash
curl -X POST http://localhost:3000/crawl-runs/<crawlRunId>/approve
```

Get export file paths:

```bash
curl http://localhost:3000/crawl-runs/<crawlRunId>/export
```

### Auth config examples

- Form login with TOTP:

```json
{
  "auth": {
    "mode": "form",
    "credentials": {
      "username": "demo",
      "password": "secret"
    },
    "otp": {
      "mode": "totp",
      "config": {
        "secret": "BASE32SECRET"
      }
    }
  }
}
```

- OAuth with webhook inbox OTP and 2captcha-compatible solver:

```json
{
  "auth": {
    "mode": "oauth",
    "credentials": {
      "oauthUsername": "user@example.com",
      "oauthPassword": "secret"
    },
    "otp": {
      "mode": "webhook-inbox",
      "config": {
        "url": "http://localhost:4500/latest-otp",
        "codePath": "code"
      }
    },
    "captcha": {
      "mode": "2captcha-compatible",
      "config": {
        "baseUrl": "https://2captcha.com",
        "apiKey": "CAPTCHA_API_KEY"
      }
    }
  }
}
```

### AI providers

- `AI_PROVIDER=stub`: deterministic heuristic fallback
- `AI_PROVIDER=openai-compatible`: uses `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`
- `AI_PROVIDER=codex-auth`: uses `CODEX_AUTH_BASE_URL`, `CODEX_AUTH_TOKEN`, `CODEX_AUTH_MODEL`

## Example site creation

```bash
curl -X POST http://localhost:3000/sites \
  -H 'content-type: application/json' \
  -d '{
    "slug": "fixture",
    "name": "Fixture Site",
    "baseUrl": "http://localhost:4000",
    "objective": "Extract records from a controlled website",
    "entityType": "Document",
    "fieldList": ["id", "title", "status"],
    "account": {
      "authMode": "basic",
      "credentials": {
        "username": "demo",
        "password": "secret"
      }
    },
    "sink": {
      "sinkType": "echo",
      "config": {},
      "template": {
        "site": "{{site.slug}}",
        "externalId": "{{entity.externalId}}",
        "title": "{{entity.data.title}}"
      }
    }
  }'
```

Then:

1. `POST /sites/:id/discover`
2. Review the draft recipe in PostgreSQL or API output
3. `POST /sites/:id/recipes/:version/publish`
4. `POST /jobs/run`
5. `GET /jobs/:id`

## Notes

- The `stub` AI provider intentionally generates a conservative draft recipe that works best on sites exposing stable `data-field` / `data-record` markers.
- OTP/CAPTCHA is intentionally hybrid in v1. If the login recipe has an OTP selector but no `otpCode` in account credentials, the session is marked `challenge_required`.
- Full UI, multi-tenant isolation, and automated challenge solvers remain phase-2 work.
- `POST /crawl-from-url` is the preferred v1 entrypoint for URL-only discovery and mini-site crawl. The older `/sites` flow remains available for manually curated recipes.

## Site-specific crawler example

- `npm run crawl:dautoeic:reading` crawls [https://dautoeic.com/reading](https://dautoeic.com/reading) into `output/dautoeic-reading`.
- Full usage notes are in `/Users/phuongnv/Downloads/project/playwright/README-dautoeic-reading.md`.
