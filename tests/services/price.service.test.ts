import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PriceService, PriceFetchError } from "../../src/services/price.service.js";
import { CircleRateLimitError } from "../../src/services/sources/circle.source.js";
import { CacheService } from "../../src/utils/cache.js";
import {
  getOrderBook,
  getLiquidityPools,
  HorizonTimeoutError,
  HorizonClientError,
} from "../../src/utils/stellar.js";

vi.mock("../../src/utils/cache.js", () => ({
  CacheService: {
    getOrSet: vi.fn(),
    generateKey: vi.fn((ns, key) => `cache:${ns}:${key}`),
  },
  CacheTTL: {
    PRICES: 60,
  },
}));

const circleSupportsMock = vi.hoisted(() => vi.fn());
const circleGetPriceSourceDataMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/services/sources/circle.source.js", () => {
  class CircleRateLimitError extends Error {
    constructor() {
      super("Circle API in-process rate limit reached");
      this.name = "CircleRateLimitError";
    }
  }
  return {
    CircleSource: class {
      static supports = circleSupportsMock;
      getPriceSourceData = circleGetPriceSourceDataMock;
    },
    CircleRateLimitError,
  };
});

// Hoisted mocks for the new per-provider guard dependencies.
const checkLimitMock = vi.hoisted(() => vi.fn());
const isAvailableMock = vi.hoisted(() => vi.fn());
const recordSuccessMock = vi.hoisted(() => vi.fn());
const recordFailureMock = vi.hoisted(() => vi.fn());
const recordUsageMock = vi.hoisted(() => vi.fn());
const redisGetMock = vi.hoisted(() => vi.fn());
const redisSetMock = vi.hoisted(() => vi.fn());
const loggerWarnMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: loggerWarnMock,
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("../../src/services/providerRateLimiter.service.js", () => ({
  providerRateLimiterService: { checkLimit: checkLimitMock },
}));

vi.mock("../../src/services/providerCircuitBreaker.service.js", () => ({
  providerCircuitBreakerService: {
    isAvailable: isAvailableMock,
    recordSuccess: recordSuccessMock,
    recordFailure: recordFailureMock,
  },
}));

vi.mock("../../src/services/externalRateLimitMetrics.service.js", () => ({
  externalRateLimitMetricsService: { recordUsage: recordUsageMock },
}));

vi.mock("../../src/utils/redis.js", () => ({
  redis: { get: redisGetMock, set: redisSetMock },
}));

vi.mock("../../src/utils/stellar.js", () => ({
  getOrderBook: vi.fn(),
  getLiquidityPools: vi.fn(),
  HorizonTimeoutError: class HorizonTimeoutError extends Error {
    constructor(m = "Horizon API request timed out") {
      super(m);
      this.name = "HorizonTimeoutError";
    }
  },
  HorizonClientError: class HorizonClientError extends Error {
    constructor(m: string, public e: any) {
      super(m);
      this.name = "HorizonClientError";
    }
  },
}));

vi.mock("../../src/config/index.js", () => ({
  config: {
    REDIS_CACHE_TTL_SEC: 30,
    REDIS_PRICE_CACHE_PREFIX: "price:aggregated",
    PRICE_DEVIATION_THRESHOLD: 0.02,
    LOG_LEVEL: "info",
    PRICE_PROVIDER_CACHE_TTL_SEC: 300,
    SDEX_RATE_LIMIT_MAX: 10,
    SDEX_RATE_LIMIT_WINDOW_MS: 60_000,
    AMM_RATE_LIMIT_MAX: 20,
    AMM_RATE_LIMIT_WINDOW_MS: 60_000,
    CIRCLE_RATE_LIMIT_MAX: 30,
    CIRCLE_RATE_LIMIT_WINDOW_MS: 60_000,
  },
  SUPPORTED_ASSETS: [
    { code: "USDC", issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" },
    { code: "PYUSD", issuer: "GBHZAE5IQTOPQZ66TFWZYIYCHQ6T3GMWHDKFEXAKYWJ2BHLZQ227KRYE" },
    { code: "EURC", issuer: "GDQOE23CFSUMSVZZ4YRVXGW7PCFNIAHLMRAHDE4Z32DIBQGH4KZZK2KZ" },
    { code: "XLM", issuer: "native" },
    { code: "FOBXX", issuer: "GBX7VUT2UTUKO2H76J26D7QYWNFW6C2NYN6K74Y3K43HGBXYZ" },
  ],
}));

describe("PriceService", () => {
  let priceService: PriceService;

  beforeEach(() => {
    priceService = new PriceService();
    vi.resetAllMocks();

    vi.mocked(CacheService.generateKey).mockImplementation(
      (ns, key) => `cache:${ns}:${key}`
    );
    vi.mocked(CacheService.getOrSet).mockImplementation(async (_key, fetcher) => {
      return fetcher();
    });

    // Per-provider guard defaults: everything healthy and unthrottled.
    checkLimitMock.mockResolvedValue({
      allowed: true,
      current: 1,
      limit: 10,
      remaining: 9,
      resetMs: Date.now() + 60_000,
      retryAfterMs: 0,
    });
    isAvailableMock.mockResolvedValue(true);
    recordSuccessMock.mockResolvedValue(undefined);
    recordFailureMock.mockResolvedValue(undefined);
    recordUsageMock.mockResolvedValue(undefined);
    redisGetMock.mockResolvedValue(null);
    redisSetMock.mockResolvedValue("OK");

    circleSupportsMock.mockImplementation(
      (symbol: string) => symbol === "USDC" || symbol === "EURC"
    );
    circleGetPriceSourceDataMock.mockImplementation(async (symbol: string) => {
      if (symbol === "USDC") return { price: 1.0, volume: 1000000, name: "Circle" };
      if (symbol === "EURC") return { price: 1.05, volume: 500000, name: "Circle" };
      throw new Error("Unsupported symbol in mocked Circle API");
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("fetchSDEXPrice", () => {
    it("returns mock price 1 for USDC", async () => {
      const result = await priceService.fetchSDEXPrice("USDC");
      expect(result).toEqual({ price: 1, volume: 1000000 });
      expect(getOrderBook).not.toHaveBeenCalled();
    });

    it("calculates VWAP from orderbook for other assets", async () => {
      vi.mocked(getOrderBook).mockResolvedValue({
        bids: [
          { price: "0.1", amount: "100" },
          { price: "0.09", amount: "200" },
        ],
        asks: [
          { price: "0.11", amount: "150" },
          { price: "0.12", amount: "50" },
        ],
        base: {} as any,
        counter: {} as any,
      } as any);

      const result = await priceService.fetchSDEXPrice("XLM");

      expect(result.price).toBeCloseTo(0.101);
      expect(result.volume).toBe(500);
      expect(getOrderBook).toHaveBeenCalledWith(
        "XLM",
        "native",
        "USDC",
        "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
      );
    });

    it("handles timeout correctly by rethrowing HorizonTimeoutError", async () => {
      vi.mocked(getOrderBook).mockRejectedValue(new HorizonTimeoutError());
      await expect(priceService.fetchSDEXPrice("XLM")).rejects.toThrow(
        HorizonTimeoutError
      );
    });

    it("throws PriceFetchError for unsupported assets", async () => {
      await expect(priceService.fetchSDEXPrice("INVALID")).rejects.toThrow(
        PriceFetchError
      );
    });

    it("throws PriceFetchError when orderbook is empty", async () => {
      vi.mocked(getOrderBook).mockResolvedValue({
        bids: [],
        asks: [],
        base: {} as any,
        counter: {} as any,
      } as any);
      await expect(priceService.fetchSDEXPrice("XLM")).rejects.toThrow(
        PriceFetchError
      );
    });

    it("handles generic errors by wrapping in PriceFetchError", async () => {
      vi.mocked(getOrderBook).mockRejectedValue(new Error("Network failed"));
      await expect(priceService.fetchSDEXPrice("XLM")).rejects.toThrow(
        PriceFetchError
      );
    });
  });

  describe("fetchAMMPrice", () => {
    it("returns pure 1 for USDC", async () => {
      const result = await priceService.fetchAMMPrice("USDC");
      expect(result).toEqual({ price: 1, volume: 1000000 });
    });

    it("calculates price from AMM reserves", async () => {
      vi.mocked(getLiquidityPools).mockResolvedValue({
        records: [
          {
            reserves: [
              { asset: "native", amount: "1000" },
              {
                asset: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
                amount: "100",
              },
            ],
          },
        ],
      } as any);

      const result = await priceService.fetchAMMPrice("XLM");
      expect(result.price).toBeCloseTo(0.1);
      expect(result.volume).toBe(200);
    });

    it("throws PriceFetchError for unsupported assets", async () => {
      await expect(priceService.fetchAMMPrice("INVALID")).rejects.toThrow(
        PriceFetchError
      );
    });

    it("rethrows HorizonClientError", async () => {
      vi.mocked(getLiquidityPools).mockRejectedValue(
        new HorizonClientError("horizon down", new Error("horizon down"))
      );
      await expect(priceService.fetchAMMPrice("XLM")).rejects.toThrow(
        HorizonClientError
      );
    });

    it("throws PriceFetchError when pools are missing", async () => {
      vi.mocked(getLiquidityPools).mockResolvedValue({ records: [] } as any);
      await expect(priceService.fetchAMMPrice("XLM")).rejects.toThrow(
        PriceFetchError
      );
    });
  });

  describe("calculateVWAP", () => {
    it("computes VWAP from multiple sources", () => {
      const sources = [
        { price: 0.1, volume: 100, name: "SDEX" },
        { price: 0.12, volume: 200, name: "AMM" },
      ];
      const result = priceService.calculateVWAP(sources);
      expect(result.vwap).toBeCloseTo(0.113333);
      expect(result.validSources).toHaveLength(2);
    });

    it("computes VWAP from a single source if one is missing volume", () => {
      const sources = [
        { price: 0.1, volume: 100, name: "SDEX" },
        { price: 0.12, volume: 0, name: "AMM" },
      ];
      const result = priceService.calculateVWAP(sources);
      expect(result.vwap).toBeCloseTo(0.1);
      expect(result.validSources).toHaveLength(1);
    });

    it("throws if all sources lack volume", () => {
      const sources = [
        { price: 0.1, volume: 0, name: "SDEX" },
        { price: NaN, volume: 100, name: "AMM" },
      ];
      expect(() => priceService.calculateVWAP(sources)).toThrow(
        "No valid sources"
      );
    });
  });

  describe("getAggregatedPrice", () => {
    beforeEach(() => {
      vi.spyOn(priceService, "fetchSDEXPrice").mockResolvedValue({
        price: 0.1,
        volume: 100,
      });
      vi.spyOn(priceService, "fetchAMMPrice").mockResolvedValue({
        price: 0.12,
        volume: 200,
      });
    });

    it("returns cached result when CacheService returns stored aggregate", async () => {
      vi.mocked(CacheService.getOrSet).mockResolvedValue({
        symbol: "XLM",
        vwap: 999,
        sources: [],
        deviation: 0,
        lastUpdated: new Date().toISOString(),
      });
      const result = await priceService.getAggregatedPrice("XLM");
      expect(result?.vwap).toBe(999);
      expect(priceService.fetchSDEXPrice).not.toHaveBeenCalled();
    });

    it("fetches from SDEX and AMM on cache miss and uses configured TTL", async () => {
      const result = await priceService.getAggregatedPrice("XLM");
      expect(result?.vwap).toBeCloseTo(0.113333);
      expect(result?.deviation).toBeGreaterThan(0);
      expect(priceService.fetchSDEXPrice).toHaveBeenCalledWith("XLM");
      expect(priceService.fetchAMMPrice).toHaveBeenCalledWith("XLM");
      expect(CacheService.getOrSet).toHaveBeenCalledWith(
        "cache:price:aggregated:XLM",
        expect.any(Function),
        expect.objectContaining({ ttl: 30, tags: ["price"] })
      );
    });

    it("gracefully calculates from SDEX if AMM fails", async () => {
      vi.spyOn(priceService, "fetchAMMPrice").mockRejectedValue(
        new Error("AMM Down")
      );
      const result = await priceService.getAggregatedPrice("XLM");
      expect(result?.vwap).toBeCloseTo(0.1);
      expect(result?.sources).toHaveLength(1);
    });

    it("gracefully calculates from AMM if SDEX fails", async () => {
      vi.spyOn(priceService, "fetchSDEXPrice").mockRejectedValue(
        new Error("SDEX Down")
      );
      const result = await priceService.getAggregatedPrice("XLM");
      expect(result?.vwap).toBeCloseTo(0.12);
      expect(result?.sources).toHaveLength(1);
    });

    it("throws if both Stellar sources fail", async () => {
      vi.spyOn(priceService, "fetchSDEXPrice").mockRejectedValue(
        new HorizonTimeoutError("First error")
      );
      vi.spyOn(priceService, "fetchAMMPrice").mockRejectedValue(
        new Error("Second error")
      );
      await expect(priceService.getAggregatedPrice("XLM")).rejects.toThrow(
        "First error"
      );
    });

    it("works for each of the 5 assets", async () => {
      const assets = ["USDC", "PYUSD", "EURC", "XLM", "FOBXX"];
      for (const asset of assets) {
        const result = await priceService.getAggregatedPrice(asset);
        expect(result?.symbol).toBe(asset);
      }
    });

    it("normalizes symbol casing", async () => {
      const result = await priceService.getAggregatedPrice("xlm");
      expect(result?.symbol).toBe("XLM");
      expect(priceService.fetchSDEXPrice).toHaveBeenCalledWith("XLM");
    });
  });

  describe("getPriceFromSource", () => {
    it("returns SDEX source price", async () => {
      vi.spyOn(priceService, "fetchSDEXPrice").mockResolvedValue({
        price: 0.1,
        volume: 100,
      });
      const source = await priceService.getPriceFromSource("XLM", "sdex");
      expect(source?.source).toBe("SDEX");
      expect(source?.price).toBe(0.1);
    });

    it("returns AMM source price", async () => {
      vi.spyOn(priceService, "fetchAMMPrice").mockResolvedValue({
        price: 0.12,
        volume: 200,
      });
      const source = await priceService.getPriceFromSource("XLM", "amm");
      expect(source?.source).toBe("AMM");
      expect(source?.price).toBe(0.12);
    });

    it("returns Circle source price for USDC", async () => {
      const source = await priceService.getPriceFromSource("USDC", "circle");
      expect(source?.source).toBe("Circle");
      expect(source?.price).toBe(1.0);
    });

    it("returns null for unknown source", async () => {
      const source = await priceService.getPriceFromSource("XLM", "coinbase");
      expect(source).toBeNull();
    });
  });

  describe("per-provider rate limiting and circuit breaking", () => {
    beforeEach(() => {
      vi.spyOn(priceService, "fetchSDEXPrice").mockResolvedValue({
        price: 0.1,
        volume: 100,
      });
      vi.spyOn(priceService, "fetchAMMPrice").mockResolvedValue({
        price: 0.12,
        volume: 200,
      });
    });

    it("passes each provider's configured limit to the shared rate limiter", async () => {
      await priceService.getAggregatedPrice("XLM");

      expect(checkLimitMock).toHaveBeenCalledWith({
        providerKey: "sdex",
        maxRequests: 10,
        windowMs: 60_000,
      });
      expect(checkLimitMock).toHaveBeenCalledWith({
        providerKey: "amm",
        maxRequests: 20,
        windowMs: 60_000,
      });
    });

    it("throttles SDEX while leaving AMM usable (independent limits)", async () => {
      checkLimitMock.mockImplementation(({ providerKey }: { providerKey: string }) =>
        Promise.resolve(
          providerKey === "sdex"
            ? {
                allowed: false,
                current: 10,
                limit: 10,
                remaining: 0,
                resetMs: Date.now() + 60_000,
                retryAfterMs: 60_000,
              }
            : {
                allowed: true,
                current: 1,
                limit: 20,
                remaining: 19,
                resetMs: Date.now() + 60_000,
                retryAfterMs: 0,
              }
        )
      );

      const result = await priceService.getAggregatedPrice("XLM");

      expect(priceService.fetchSDEXPrice).not.toHaveBeenCalled();
      expect(priceService.fetchAMMPrice).toHaveBeenCalledWith("XLM");
      expect(result?.sources.map((s) => s.source)).toEqual(["Stellar AMM"]);
      expect(result?.vwap).toBeCloseTo(0.12);
    });

    it("serves a stale-marked cached value when a provider is throttled", async () => {
      checkLimitMock.mockResolvedValue({
        allowed: false,
        current: 10,
        limit: 10,
        remaining: 0,
        resetMs: Date.now() + 60_000,
        retryAfterMs: 60_000,
      });
      redisGetMock.mockImplementation((key: string) =>
        Promise.resolve(
          key.startsWith("price:provider:")
            ? JSON.stringify({ price: 0.11, volume: 150 })
            : null
        )
      );

      const result = await priceService.getAggregatedPrice("XLM");

      expect(priceService.fetchSDEXPrice).not.toHaveBeenCalled();
      expect(priceService.fetchAMMPrice).not.toHaveBeenCalled();
      const sources = result?.sources ?? [];
      expect(sources).toHaveLength(2);
      expect(sources.every((s) => s.stale === true)).toBe(true);
      expect(sources.every((s) => s.price === 0.11)).toBe(true);
    });

    it("records a throttle metric when a provider is rate-limited", async () => {
      checkLimitMock.mockImplementation(({ providerKey }: { providerKey: string }) =>
        Promise.resolve(
          providerKey === "sdex"
            ? {
                allowed: false,
                current: 10,
                limit: 10,
                remaining: 0,
                resetMs: Date.now() + 60_000,
                retryAfterMs: 60_000,
              }
            : {
                allowed: true,
                current: 1,
                limit: 20,
                remaining: 19,
                resetMs: Date.now() + 60_000,
                retryAfterMs: 0,
              }
        )
      );

      await priceService.getAggregatedPrice("XLM");

      expect(recordUsageMock).toHaveBeenCalledWith(
        expect.objectContaining({ providerKey: "sdex", throttled: true })
      );
      expect(loggerWarnMock).toHaveBeenCalledWith(
        expect.objectContaining({ providerKey: "sdex" }),
        expect.stringContaining("rate-limited")
      );
    });

    it("does not fetch a provider whose circuit is open and falls back to cache", async () => {
      isAvailableMock.mockImplementation((providerKey: string) =>
        Promise.resolve(providerKey !== "sdex")
      );
      redisGetMock.mockImplementation((key: string) =>
        Promise.resolve(
          key.startsWith("price:provider:sdex")
            ? JSON.stringify({ price: 0.1, volume: 100 })
            : null
        )
      );

      const result = await priceService.getAggregatedPrice("XLM");

      expect(priceService.fetchSDEXPrice).not.toHaveBeenCalled();
      expect(priceService.fetchAMMPrice).toHaveBeenCalledWith("XLM");
      const sdex = result?.sources.find((s) => s.source === "Stellar DEX");
      expect(sdex?.stale).toBe(true);
      expect(sdex?.price).toBeCloseTo(0.1);
      expect(loggerWarnMock).toHaveBeenCalledWith(
        expect.objectContaining({ providerKey: "sdex" }),
        expect.stringContaining("circuit open")
      );
    });

    it("fails gracefully (excludes provider) when circuit is open and no cache exists", async () => {
      isAvailableMock.mockImplementation((providerKey: string) =>
        Promise.resolve(providerKey !== "sdex")
      );

      const result = await priceService.getAggregatedPrice("XLM");

      expect(priceService.fetchSDEXPrice).not.toHaveBeenCalled();
      expect(result?.sources.map((s) => s.source)).toEqual(["Stellar AMM"]);
    });

    it("records a breaker failure and falls back to cache when a request fails", async () => {
      vi.spyOn(priceService, "fetchAMMPrice").mockRejectedValue(new Error("AMM down"));
      redisGetMock.mockImplementation((key: string) =>
        Promise.resolve(
          key.startsWith("price:provider:amm")
            ? JSON.stringify({ price: 0.12, volume: 200 })
            : null
        )
      );

      const result = await priceService.getAggregatedPrice("XLM");

      expect(recordFailureMock).toHaveBeenCalledWith("amm", "AMM down");
      const amm = result?.sources.find((s) => s.source === "Stellar AMM");
      expect(amm?.stale).toBe(true);
      expect(amm?.price).toBeCloseTo(0.12);
    });

    it("continues aggregation with healthy providers when another provider fails with no cache", async () => {
      vi.spyOn(priceService, "fetchSDEXPrice").mockRejectedValue(new Error("SDEX down"));

      const result = await priceService.getAggregatedPrice("XLM");

      expect(result?.sources.map((s) => s.source)).toEqual(["Stellar AMM"]);
      expect(result?.vwap).toBeCloseTo(0.12);
    });

    it("treats Circle rate-limit errors as backpressure, not a breaker failure", async () => {
      circleGetPriceSourceDataMock.mockRejectedValue(new CircleRateLimitError());

      const result = await priceService.getAggregatedPrice("USDC");

      expect(recordFailureMock).not.toHaveBeenCalled();
      expect(recordUsageMock).toHaveBeenCalledWith(
        expect.objectContaining({ providerKey: "circle", throttled: true })
      );
      expect(result?.sources.some((s) => s.source === "Stellar DEX")).toBe(true);
      expect(result?.sources.some((s) => s.source === "Stellar AMM")).toBe(true);
    });

    it("does not trip the breaker on a successful provider fetch", async () => {
      await priceService.getAggregatedPrice("XLM");

      expect(recordSuccessMock).toHaveBeenCalledWith("sdex");
      expect(recordSuccessMock).toHaveBeenCalledWith("amm");
      expect(recordFailureMock).not.toHaveBeenCalled();
    });
  });

  describe("checkDeviation", () => {
    it("returns deviated=true when threshold is exceeded", async () => {
      vi.spyOn(priceService, "getAggregatedPrice").mockResolvedValue({
        symbol: "XLM",
        vwap: 1,
        sources: [
          { source: "SDEX", price: 1, timestamp: new Date().toISOString() },
          { source: "AMM", price: 1.1, timestamp: new Date().toISOString() },
        ],
        deviation: 0.1,
        lastUpdated: new Date().toISOString(),
      });
      const result = await priceService.checkDeviation("XLM");
      expect(result).toEqual({ deviated: true, percentage: 0.1 });
    });

    it("returns deviated=false for null aggregated price", async () => {
      vi.spyOn(priceService, "getAggregatedPrice").mockResolvedValue(null);
      const result = await priceService.checkDeviation("XLM");
      expect(result).toEqual({ deviated: false, percentage: 0 });
    });
  });
});
