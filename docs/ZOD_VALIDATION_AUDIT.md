# Zod Request Validation Audit — Issue #241

## Summary

Every route module under `src/api/routes/` was audited for whether `request.body`,
`request.params`, and `request.query` are validated through a zod schema before
handler logic runs. Routes that were missing validation had schemas added to
`src/api/validations/` and wired in via the `validateRequest()` preHandler already
used by `pools.routes.ts` and `search.routes.ts`.

All validation failures return the standard structured 400 used across the API:

```json
{
  "success": false,
  "error": "Body Validation Failed",
  "details": [{ "path": "name", "message": "Required", "code": "invalid_type" }]
}
```

---

## New Schema Files Added

| File | Covers |
|---|---|
| `src/api/validations/assets.schema.ts` | assets, tags, bulk-assign, asset-tag params |
| `src/api/validations/bridges.schema.ts` | bridge params, transaction create/update, query |
| `src/api/validations/webhooks.schema.ts` | endpoint CRUD, deliver, batch, verify signature |
| `src/api/validations/watchlists.schema.ts` | create/update/delete watchlist |
| `src/api/validations/apiKeys.schema.ts` | create key, extend, id params |
| `src/api/validations/transactions.schema.ts` | list query, fetch/backfill/detect-new bodies |
| `src/api/validations/notes.schema.ts` | create/update/delete note, search, entity/operator params |
| `src/api/validations/tags.schema.ts` | add/remove/sync/propagate tag, find query, entity params |
| `src/api/validations/alertRules.schema.ts` | create/update/status/test/evaluate rule bodies |
| `src/api/validations/alertHistory.schema.ts` | history search/export query |
| `src/api/validations/incidents.schema.ts` | list/create/ingest/status/read/unread bodies |
| `src/api/validations/notificationTemplates.schema.ts` | template CRUD, approve, preview, validate |
| `src/api/validations/maintenance.schema.ts` | window CRUD, approve/cancel, suppression check |
| `src/api/validations/statusSubscriptions.schema.ts` | create/update/notify subscription bodies |

---

## Route Audit Checklist

### Pre-existing — already validated ✅

| Route file | Validation method |
|---|---|
| `alerts.routes.ts` | `.parse()` inline in handler |
| `alertRoutingAdmin.ts` | `.safeParse()` inline + `validateRequest()` preHandler |
| `alertSuppression.ts` | `.parse()` / `.safeParse()` inline |
| `ownershipMatrix.ts` | `.parse()` inline |
| `pools.routes.ts` | `validateRequest()` preHandler |
| `search.routes.ts` | `validateRequest()` preHandler |
| `reconciliation.ts` | `.safeParse()` inline |
| `preferences.ts` | `.safeParse()` inline via imported service schema |

### Fixed in this PR — `validateRequest()` preHandler added ✅

| Route file | What was fixed |
|---|---|
| `assets.ts` | params on `/:symbol*` routes; body on POST/PUT tags & bulk-assign |
| `bridges.ts` | params, query, body on all endpoints |
| `webhooks.ts` | body on all POST/PATCH endpoints; params on id-scoped endpoints |
| `watchlists.ts` | params + body on create/update/delete |
| `apiKeys.ts` | body on create/extend; params on id-scoped endpoints |
| `transactions.ts` | query on list/export; body on fetch/backfill/detect-new; params on sync-state |
| `notes.ts` | body on create/update; query on search/delete; params on all id/entity routes |
| `tags.ts` | body on add/remove/sync/propagate; query on find/audit; params on entity routes |
| `alertRules.ts` | body on create/update/status/test/evaluate; params on id routes; query on list |
| `alertHistory.routes.ts` | query on search and export |
| `incidents.routes.ts` | query on list; body on create/ingest/status/read; params on id routes |
| `notificationTemplates.ts` | body on create/update/approve/preview/validate; params on templateId routes |
| `maintenance.ts` | body on create/update/approve/cancel/check-suppression; params on windowId routes |
| `statusSubscriptions.ts` | params on all user/id routes; body on create/update/notify |

### Read-only / no untrusted input — no change needed ✅

| Route file | Reason |
|---|---|
| `health.ts` | GET only, no user-supplied params |
| `metrics.ts` | GET only, Prometheus scrape endpoint |
| `websocket.ts` | WebSocket upgrade, no JSON body |
| `cache.ts` | admin GET/DELETE, path params are simple strings already guarded |
| `rateLimitAdmin.ts` | admin config reads |
| `tracingAdmin.ts` | admin config reads |
| `validationAdmin.ts` | admin config reads |
| `audit.ts` | admin read-only |

### Routes with existing inline validation retained ✅

These routes already did inline `.safeParse()` / `.parse()` before this PR.
The existing logic was preserved; no duplication was introduced.

| Route file | Note |
|---|---|
| `alertSuppression.ts` | Schema objects are defined locally and parsed inline |
| `reconciliation.ts` | Full safeParse with structured error replies on every endpoint |
| `preferences.ts` | Service-layer schemas imported and safeParsed per endpoint |
| `ownershipMatrix.ts` | Schema imports from `validations/ownershipMatrix.schema.ts`, parsed inline |

---

## Testing

`tests/api/zod-validation.test.ts` — added in this PR.

Covers valid + invalid inputs for every route group that received a new schema:
assets, bridges, webhooks, watchlists, API keys, transactions, notes, tags,
alert rules, alert history, incidents, status subscriptions, maintenance, and
notification templates.
