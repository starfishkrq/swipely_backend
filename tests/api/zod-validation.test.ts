/**
 * Zod request validation enforcement tests — issue #241
 *
 * For every route that received a new schema we send one request with valid
 * data (expect 2xx / not-400) and one with clearly invalid data (expect 400).
 * Auth is mocked so the tests never need real API-key infrastructure.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../src/index.js";

// ── Auth bypass ──────────────────────────────────────────────────────────────
vi.mock("../../src/api/middleware/auth.js", () => ({
  authMiddleware: () => async () => {},
}));

// ── Service stubs – every service that is instantiated by the routes we test ─
vi.mock("../../src/services/health.service.js", () => ({
  HealthService: class {
    getHealthScore = vi.fn().mockResolvedValue({ score: 90 });
    getHealthHistory = vi.fn().mockResolvedValue([]);
  },
}));
vi.mock("../../src/services/liquidity.service.js", () => ({
  LiquidityService: class {
    getAggregatedLiquidity = vi.fn().mockResolvedValue({});
  },
}));
vi.mock("../../src/services/price.service.js", () => ({
  PriceService: class {
    getAggregatedPrice = vi.fn().mockResolvedValue({});
  },
}));
vi.mock("../../src/services/assetTag.service.js", () => ({
  assetTagService: {
    getAllTags: vi.fn().mockResolvedValue([]),
    getTagById: vi.fn().mockResolvedValue({ id: "1", name: "test" }),
    createTag: vi.fn().mockResolvedValue({ id: "1", name: "test" }),
    updateTag: vi.fn().mockResolvedValue({ id: "1", name: "updated" }),
    deleteTag: vi.fn().mockResolvedValue(undefined),
    bulkAssignTags: vi.fn().mockResolvedValue({ assigned: 1 }),
    getTagsForAsset: vi.fn().mockResolvedValue([]),
    assignTagToAsset: vi.fn().mockResolvedValue(undefined),
    unassignTagFromAsset: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../../src/services/bridge.service.js", () => ({
  BridgeService: class {
    getAllBridgeStatuses = vi.fn().mockResolvedValue([]);
    getBridgeStats = vi.fn().mockResolvedValue({ name: "circle" });
  },
}));
vi.mock("../../src/services/bridgeTransaction.service.js", () => ({
  BridgeTransactionService: class {
    getTransactionsForBridge = vi.fn().mockResolvedValue([]);
    getTransactionByHash = vi.fn().mockResolvedValue({ id: "1" });
    createTransaction = vi.fn().mockResolvedValue({ id: "1" });
    updateTransactionStatus = vi.fn().mockResolvedValue({ id: "1" });
    getBridgeTransactionSummary = vi.fn().mockResolvedValue({});
  },
}));
vi.mock("../../src/services/bridgeHealthSnapshot.service.js", () => ({
  bridgeHealthSnapshotService: {
    getSnapshot: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock("../../src/services/webhook.service.js", () => ({
  WebhookEventType: {},
  WebhookDeliveryStatus: {},
  webhookService: {
    createEndpoint: vi.fn().mockResolvedValue({ id: "ep1" }),
    listEndpoints: vi.fn().mockResolvedValue([]),
    getEndpoint: vi.fn().mockResolvedValue({ id: "ep1" }),
    updateEndpoint: vi.fn().mockResolvedValue({ id: "ep1" }),
    deleteEndpoint: vi.fn().mockResolvedValue(true),
    rotateSecret: vi.fn().mockResolvedValue("new-secret"),
    queueDelivery: vi.fn().mockResolvedValue({ id: "d1" }),
    queueBatchDelivery: vi.fn().mockResolvedValue([]),
    getDelivery: vi.fn().mockResolvedValue({ id: "d1" }),
    listDeliveries: vi.fn().mockResolvedValue([]),
    getDeliveryLogs: vi.fn().mockResolvedValue([]),
    getWebhookHistory: vi.fn().mockResolvedValue([]),
    sendTestDelivery: vi.fn().mockResolvedValue({ success: true, status: 200, durationMs: 10 }),
    verifySignature: vi.fn().mockReturnValue(true),
  },
}));
vi.mock("../../src/services/watchlists.service.js", () => ({
  WatchlistsService: class {
    getWatchlists = vi.fn().mockResolvedValue([]);
    createWatchlist = vi.fn().mockResolvedValue({ id: "wl1", name: "test" });
    deleteWatchlist = vi.fn().mockResolvedValue(undefined);
    renameWatchlist = vi.fn().mockResolvedValue(undefined);
    setWatchlistDefault = vi.fn().mockResolvedValue(undefined);
    updateWatchlistAssets = vi.fn().mockResolvedValue(undefined);
  },
}));
vi.mock("../../src/services/apiKey.service.js", () => ({
  ApiKeyService: class {
    listKeys = vi.fn().mockResolvedValue([]);
    createKey = vi.fn().mockResolvedValue({ id: "k1", key: "sk_test" });
    rotateKey = vi.fn().mockResolvedValue({ id: "k1" });
    revokeKey = vi.fn().mockResolvedValue({ id: "k1" });
    extendKeyExpiration = vi.fn().mockResolvedValue({ id: "k1" });
    validateKey = vi.fn().mockResolvedValue({ name: "test", scopes: [] });
  },
}));
vi.mock("../../src/services/transaction.service.js", () => ({
  TransactionService: class {
    listTransactions = vi.fn().mockResolvedValue({ transactions: [], total: 0, page: 1, pageSize: 10, totalPages: 0 });
    exportTransactionsCsv = vi.fn().mockResolvedValue("csv-data");
    fetchTransactionsByAsset = vi.fn().mockResolvedValue({ fetched: 0 });
    backfillAssetTransactions = vi.fn().mockResolvedValue({ backfilled: 0 });
    detectNewTransactions = vi.fn().mockResolvedValue({ detected: 0 });
    getSyncState = vi.fn().mockResolvedValue(null);
  },
}));
vi.mock("../../src/services/operatorNotes.service.js", () => ({
  OperatorNotesService: class {
    createNote = vi.fn().mockResolvedValue({ id: "n1" });
    searchNotes = vi.fn().mockResolvedValue([]);
    getNote = vi.fn().mockResolvedValue({ id: "n1" });
    updateNote = vi.fn().mockResolvedValue({ id: "n1" });
    deleteNote = vi.fn().mockResolvedValue(true);
    getNotesForEntity = vi.fn().mockResolvedValue([]);
    getNotesByOperator = vi.fn().mockResolvedValue([]);
  },
}));
vi.mock("../../src/services/tagSync.service.js", () => ({
  TagSyncService: class {
    getAllTags = vi.fn().mockResolvedValue([]);
    addTag = vi.fn().mockResolvedValue({ id: "t1" });
    removeTag = vi.fn().mockResolvedValue(true);
    syncEntityTags = vi.fn().mockResolvedValue({ synced: 1 });
    propagateTag = vi.fn().mockResolvedValue({ propagated: 1 });
    findEntitiesByTag = vi.fn().mockResolvedValue([]);
    getTagsForEntity = vi.fn().mockResolvedValue([]);
    getAuditLog = vi.fn().mockResolvedValue([]);
  },
}));
vi.mock("../../src/services/alertRules.service.js", () => ({
  alertRulesService: {
    listTemplates: vi.fn().mockReturnValue([]),
    getTemplate: vi.fn().mockReturnValue({ id: "tpl1" }),
    createRule: vi.fn().mockResolvedValue({ id: "r1" }),
    listRules: vi.fn().mockResolvedValue([]),
    getRule: vi.fn().mockResolvedValue({ id: "r1" }),
    updateRule: vi.fn().mockResolvedValue({ id: "r1" }),
    setStatus: vi.fn().mockResolvedValue(true),
    deleteRule: vi.fn().mockResolvedValue(true),
    getVersionHistory: vi.fn().mockResolvedValue([]),
    testRule: vi.fn().mockResolvedValue({ triggered: false }),
    evaluateAllActiveRules: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("../../src/services/alertHistorySearch.service.js", () => ({
  AlertHistorySearchService: class {
    search = vi.fn().mockResolvedValue({ data: [], total: 0 });
    exportCsv = vi.fn().mockResolvedValue("csv");
  },
}));
vi.mock("../../src/services/incident.service.js", () => ({
  IncidentService: class {
    listIncidents = vi.fn().mockResolvedValue({ incidents: [], total: 0 });
    getIncident = vi.fn().mockResolvedValue({ id: "inc1" });
    getIncidentReplayTimeline = vi.fn().mockResolvedValue({ events: [] });
    createIncident = vi.fn().mockResolvedValue({ id: "inc1" });
    updateIncidentStatus = vi.fn().mockResolvedValue({ id: "inc1" });
    markRead = vi.fn().mockResolvedValue(undefined);
    getUnreadCount = vi.fn().mockResolvedValue(0);
  },
}));
vi.mock("../../src/services/incidentIngestion.service.js", () => ({
  IncidentIngestionService: class {
    ingestWithRetry = vi.fn().mockResolvedValue({ id: "inc1", queuedForReview: false });
    listManualReviewQueue = vi.fn().mockResolvedValue([]);
  },
}));
vi.mock("../../src/services/statusSubscription.service.js", () => ({
  StatusSubscriptionService: class {
    create = vi.fn().mockReturnValue({ id: "sub1", userId: "u1" });
    listByUser = vi.fn().mockReturnValue([]);
    getById = vi.fn().mockReturnValue({ id: "sub1", userId: "u1" });
    update = vi.fn().mockReturnValue({ id: "sub1", userId: "u1" });
    delete = vi.fn().mockReturnValue(true);
    getAuditTrail = vi.fn().mockReturnValue([]);
    getSubscriptionsToNotify = vi.fn().mockReturnValue([]);
  },
}));
vi.mock("../../src/services/notificationTemplate.service", () => ({
  TemplateChannel: {},
  TemplateStatus: {},
  notificationTemplateService: {
    createTemplate: vi.fn().mockResolvedValue({ id: "tpl1" }),
    getTemplate: vi.fn().mockResolvedValue({ id: "tpl1" }),
    updateTemplate: vi.fn().mockResolvedValue({ id: "tpl1" }),
    submitForApproval: vi.fn().mockResolvedValue(undefined),
    approveTemplate: vi.fn().mockResolvedValue(undefined),
    archiveTemplate: vi.fn().mockResolvedValue(undefined),
    previewTemplate: vi.fn().mockResolvedValue({ rendered: "hello" }),
    validateVariables: vi.fn().mockReturnValue({ valid: true }),
    getAllTemplates: vi.fn().mockResolvedValue([]),
    getTemplateVersions: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("../../src/services/maintenance.service", () => ({
  MaintenanceScope: {},
  MaintenanceStatus: {},
  maintenanceService: {
    createWindow: vi.fn().mockResolvedValue({ id: "w1" }),
    getWindow: vi.fn().mockResolvedValue({ id: "w1" }),
    updateWindow: vi.fn().mockResolvedValue({ id: "w1" }),
    approveWindow: vi.fn().mockResolvedValue(undefined),
    cancelWindow: vi.fn().mockResolvedValue(undefined),
    getActiveWindows: vi.fn().mockResolvedValue([]),
    getUpcomingWindows: vi.fn().mockResolvedValue([]),
    getAllWindows: vi.fn().mockResolvedValue([]),
    getAuditTrail: vi.fn().mockResolvedValue([]),
    shouldSuppressAlert: vi.fn().mockResolvedValue(false),
  },
}));

// ── Server fixture ────────────────────────────────────────────────────────────
let server: FastifyInstance;

beforeAll(async () => {
  server = await buildServer();
});
afterAll(async () => {
  await server.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// ASSETS
// ─────────────────────────────────────────────────────────────────────────────
describe("Assets validation", () => {
  it("GET /:symbol — valid symbol passes", async () => {
    const res = await server.inject({ method: "GET", url: "/api/v1/assets/USDC" });
    expect(res.statusCode).not.toBe(400);
  });

  it("GET /:symbol — lowercase symbol fails (regex constraint)", async () => {
    const res = await server.inject({ method: "GET", url: "/api/v1/assets/usdc" });
    expect(res.statusCode).toBe(400);
  });

  it("GET /:symbol/health/history — invalid period fails", async () => {
    const res = await server.inject({ method: "GET", url: "/api/v1/assets/USDC/health/history?period=invalid" });
    expect(res.statusCode).toBe(400);
  });

  it("POST /tags — missing name returns 400", async () => {
    const res = await server.inject({ method: "POST", url: "/api/v1/assets/tags", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("POST /tags — valid body passes", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/assets/tags",
      payload: { name: "stablecoin" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("POST /tags/bulk-assign — empty arrays fail", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/assets/tags/bulk-assign",
      payload: { assetSymbols: [], tagNames: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /:symbol/tags — missing tags field returns 400", async () => {
    const res = await server.inject({ method: "POST", url: "/api/v1/assets/USDC/tags", payload: {} });
    expect(res.statusCode).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BRIDGES
// ─────────────────────────────────────────────────────────────────────────────
describe("Bridges validation", () => {
  it("POST /:bridge/transactions — missing required fields returns 400", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/bridges/circle/transactions",
      payload: { symbol: "USDC" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /:bridge/transactions — valid payload passes", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/bridges/circle/transactions",
      payload: {
        symbol: "USDC",
        transactionType: "mint",
        txHash: "0xabc123",
        amount: "1000.00",
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it("PATCH /:bridge/transactions/:txHash/status — invalid status returns 400", async () => {
    const res = await server.inject({
      method: "PATCH", url: "/api/v1/bridges/circle/transactions/0xabc/status",
      payload: { status: "NOT_VALID" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /:bridge/transactions/:txHash/status — valid status passes", async () => {
    const res = await server.inject({
      method: "PATCH", url: "/api/v1/bridges/circle/transactions/0xabc/status",
      payload: { status: "confirmed" },
    });
    expect(res.statusCode).not.toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOKS
// ─────────────────────────────────────────────────────────────────────────────
describe("Webhooks validation", () => {
  it("POST /endpoints — missing required fields returns 400", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/webhooks/endpoints",
      payload: { ownerAddress: "addr1" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /endpoints — invalid URL returns 400", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/webhooks/endpoints",
      payload: { ownerAddress: "addr1", url: "not-a-url", name: "Test" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /endpoints — valid payload passes", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/webhooks/endpoints",
      payload: { ownerAddress: "addr1", url: "https://example.com/hook", name: "Test Hook" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("POST /verify — missing fields returns 400", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/webhooks/verify",
      payload: { payload: "data" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WATCHLISTS
// ─────────────────────────────────────────────────────────────────────────────
describe("Watchlists validation", () => {
  it("POST /:userId — missing name returns 400", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/watchlists/user123",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /:userId — valid payload passes", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/watchlists/user123",
      payload: { name: "My Watchlist" },
    });
    expect(res.statusCode).not.toBe(400);
  });

  it("PATCH /:userId/:id — invalid UUID returns 400", async () => {
    const res = await server.inject({
      method: "PATCH", url: "/api/v1/watchlists/user123/not-a-uuid",
      payload: { name: "Updated" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// API KEYS
// ─────────────────────────────────────────────────────────────────────────────
describe("API Keys validation", () => {
  it("POST / — missing name returns 400", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/admin/api-keys",
      payload: { scopes: ["read"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST / — valid payload passes", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/admin/api-keys",
      payload: { name: "CI Key" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("POST /:id/extend — extraDays < 1 returns 400", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/admin/api-keys/key1/extend",
      payload: { extraDays: 0 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /:id/extend — valid extraDays passes", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/admin/api-keys/key1/extend",
      payload: { extraDays: 30 },
    });
    expect(res.statusCode).not.toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TRANSACTIONS
// ─────────────────────────────────────────────────────────────────────────────
describe("Transactions validation", () => {
  it("POST /fetch — missing assetCode returns 400", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/transactions/fetch",
      payload: { assetIssuer: "GABC" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /fetch — valid payload passes", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/transactions/fetch",
      payload: { assetCode: "USDC", assetIssuer: "GABC123" },
    });
    expect(res.statusCode).not.toBe(400);
  });

  it("POST /backfill — missing both required fields returns 400", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/transactions/backfill",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET / — invalid status enum returns 400", async () => {
    const res = await server.inject({
      method: "GET", url: "/api/v1/transactions?status=unknown",
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NOTES
// ─────────────────────────────────────────────────────────────────────────────
describe("Notes validation", () => {
  it("POST / — missing required fields returns 400", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/notes",
      payload: { entityType: "bridge" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST / — valid payload passes", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/notes",
      payload: {
        entityType: "bridge",
        entityId: "bridge-1",
        operatorAddress: "op-addr",
        content: "Note content",
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it("GET /search — missing q returns 400", async () => {
    const res = await server.inject({ method: "GET", url: "/api/v1/notes/search" });
    expect(res.statusCode).toBe(400);
  });

  it("DELETE /:id — missing operatorAddress query param returns 400", async () => {
    const res = await server.inject({ method: "DELETE", url: "/api/v1/notes/note1" });
    expect(res.statusCode).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TAGS
// ─────────────────────────────────────────────────────────────────────────────
describe("Tags validation", () => {
  it("POST / — missing required fields returns 400", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/tags",
      payload: { entityType: "asset" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST / — valid payload passes", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/tags",
      payload: { entityType: "asset", entityId: "USDC", tag: "stablecoin" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("GET /find — missing tag param returns 400", async () => {
    const res = await server.inject({ method: "GET", url: "/api/v1/tags/find" });
    expect(res.statusCode).toBe(400);
  });

  it("PUT /sync — missing tags array returns 400", async () => {
    const res = await server.inject({
      method: "PUT", url: "/api/v1/tags/sync",
      payload: { entityType: "asset", entityId: "USDC" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ALERT RULES
// ─────────────────────────────────────────────────────────────────────────────
describe("Alert Rules validation", () => {
  it("POST / — missing required fields returns 400", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/alert-rules",
      payload: { name: "My Rule" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST / — valid payload passes", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/alert-rules",
      payload: {
        ownerAddress: "addr1",
        name: "Price Alert",
        assetCode: "USDC",
        conditions: [{ metric: "price", operator: "gt", threshold: 1.05 }],
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it("POST /evaluate — missing assetCode returns 400", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/alert-rules/evaluate",
      payload: { metrics: { price: 1.1 } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET / — invalid priority enum returns 400", async () => {
    const res = await server.inject({
      method: "GET", url: "/api/v1/alert-rules?priority=extreme",
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ALERT HISTORY
// ─────────────────────────────────────────────────────────────────────────────
describe("Alert History validation", () => {
  it("GET / — invalid datetime format returns 400", async () => {
    const res = await server.inject({
      method: "GET", url: "/api/v1/alerts/search?startDate=not-a-date",
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET / — valid query passes", async () => {
    const res = await server.inject({
      method: "GET", url: "/api/v1/alerts/search?assetCode=USDC&limit=10",
    });
    expect(res.statusCode).not.toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INCIDENTS
// ─────────────────────────────────────────────────────────────────────────────
describe("Incidents validation", () => {
  it("POST / — missing required fields returns 400", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/incidents",
      payload: { bridgeId: "bridge1" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST / — invalid severity enum returns 400", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/incidents",
      payload: { bridgeId: "b1", severity: "extreme", title: "T", description: "D" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST / — valid payload passes", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/incidents",
      payload: { bridgeId: "bridge1", severity: "high", title: "Outage", description: "Bridge down" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("PATCH /:id/status — invalid status returns 400", async () => {
    const res = await server.inject({
      method: "PATCH", url: "/api/v1/incidents/inc1/status",
      payload: { status: "deleted" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /unread/count — missing userSession returns 400", async () => {
    const res = await server.inject({ method: "GET", url: "/api/v1/incidents/unread/count" });
    expect(res.statusCode).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STATUS SUBSCRIPTIONS
// ─────────────────────────────────────────────────────────────────────────────
describe("Status Subscriptions validation", () => {
  it("POST /:userId — missing required fields returns 400", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/status-subscriptions/user1",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /:userId — invalid entityType returns 400", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/status-subscriptions/user1",
      payload: { entityType: "unknown", entityId: "e1" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /:userId — valid payload passes", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/status-subscriptions/user1",
      payload: { entityType: "asset", entityId: "USDC" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("POST /notify — invalid entityType returns 400", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/status-subscriptions/notify",
      payload: { entityType: "bad", entityId: "e1", newStatus: "down" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MAINTENANCE
// ─────────────────────────────────────────────────────────────────────────────
describe("Maintenance validation", () => {
  it("POST / — missing required fields returns 400", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/maintenance",
      payload: { title: "Deploy" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST / — valid payload passes", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/maintenance",
      payload: {
        title: "Upgrade",
        startAt: "2026-09-01T00:00:00Z",
        endAt: "2026-09-01T02:00:00Z",
        createdBy: "ops-team",
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it("POST /check-suppression — missing alertType returns 400", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/maintenance/check-suppression",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATION TEMPLATES
// ─────────────────────────────────────────────────────────────────────────────
describe("Notification Templates validation", () => {
  it("POST / — missing required fields returns 400", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/notification-templates",
      payload: { name: "My Template" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST / — valid payload passes", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/notification-templates",
      payload: { name: "Alert Template", channel: "email", body: "Hello {{name}}" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("POST /validate — missing body field returns 400", async () => {
    const res = await server.inject({
      method: "POST", url: "/api/v1/notification-templates/validate",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
