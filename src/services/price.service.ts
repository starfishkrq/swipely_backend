import { logger } from "../utils/logger.js";
import { redis } from "../utils/redis.js";
import { CacheService } from "../utils/cache.js";
import { config, SUPPORTED_ASSETS } from "../config/index.js";
import { providerRateLimiterService, type ProviderRateLimitResult } from "./providerRateLimiter.service.js";
import { providerCircuitBreakerService } from "./providerCircuitBreaker.service.js";
import { externalRateLimitMetricsService } from "./externalRateLimitMetrics.service.js";
import {
  getOrderBook,
  getLiquidityPools,
  HorizonTimeoutError,
  HorizonClientError,
} from "../utils/stellar.js";
import * as StellarSdk from "@stellar/stellar-sdk";
import { CircleSource, CircleRateLimitError } from "./sources/circle.source.js";
import { PriceModel } from "../database/models/price.model.js";

// ---------------------------------------------------------------------------
// Provider keys used for rate limiting, circuit breaking, and cached fallback.
// ---------------------------------------------------------------------------

const PROVIDER_SDEX = "sdex";
const PROVIDER_AMM = "amm";
const PROVIDER_CIRCLE = "circle";

const PROVIDER_NAMES: Record<string, string> = {
  [PROVIDER_SDEX]: "Stellar DEX",
  [PROVIDER_AMM]: "Stellar AMM",
  [PROVIDER_CIRCLE]: "Circle",
};

export class PriceFetchError extends Error {
  constructor(
    message: string,
    public readonly source: string,
    public readonly asset: string,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = "PriceFetchError";
  }
}

export interface PriceSource {
  source: string;
  price: number;
  timestamp: string;
  /**
   * True when this price came from last-known-good cache rather than a fresh
   * provider call (provider was throttled or its circuit was open).
   */
  stale?: boolean;
}

export interface AggregatedPrice {
  symbol: string;
  vwap: number;
  sources: PriceSource[];
  deviation: number;
  lastUpdated: string;
}

export class PriceService {
  private readonly circleSource = new CircleSource();

  private getAssetConfig(symbol: string) {
    const asset = SUPPORTED_ASSETS.find((a) => a.code === symbol);
    if (!asset) {
      throw new PriceFetchError(
        `Asset ${symbol} not supported`,
        "CONFIG",
        symbol
      );
    }
    return asset;
  }

  private getUsdcConfig() {
    const usdc = SUPPORTED_ASSETS.find((a) => a.code === "USDC");
    if (!usdc) {
      throw new PriceFetchError("USDC config missing", "CONFIG", "USDC");
    }
    return usdc;
  }

  private normalizePoolAsset(asset: string): string {
    if (asset === "native") return "XLM:native";
    if (asset.includes(":")) return asset;
    return `${asset}:`;
  }

  private calculateDeviation(validSources: PriceSource[], vwap: number): number {
    if (validSources.length < 2 || vwap <= 0) return 0;

    const maxDeviation = validSources.reduce((max, source) => {
      const deviation = Math.abs(source.price - vwap) / vwap;
      return Math.max(max, deviation);
    }, 0);

    return Number(maxDeviation.toFixed(6));
  }

  /**
   * Fetches the best available price from the Stellar Classic SDEX orderbook.
   * Calculates a volume-weighted price from the top of the orderbook (depth up to 5).
   */
  async fetchSDEXPrice(symbol: string): Promise<{ price: number; volume: number }> {
    const sym = symbol.toUpperCase();
    try {
      const assetConfig = this.getAssetConfig(sym);
      const usdcConfig = this.getUsdcConfig();

      if (sym === "USDC") return { price: 1, volume: 1000000 };

      const orderbook = await getOrderBook(
        sym,
        assetConfig.issuer,
        "USDC",
        usdcConfig.issuer
      );

      let totalVolume = 0;
      let weightedPriceSum = 0;

      const depth = Math.min(5, orderbook.bids.length, orderbook.asks.length);
      if (depth === 0) throw new Error("Empty orderbook");

      for (let i = 0; i < depth; i++) {
        const bidPrice = parseFloat(orderbook.bids[i].price);
        const bidVol = parseFloat(orderbook.bids[i].amount);
        const askPrice = parseFloat(orderbook.asks[i].price);
        const askVol = parseFloat(orderbook.asks[i].amount);

        totalVolume += bidVol + askVol;
        weightedPriceSum += bidPrice * bidVol + askPrice * askVol;
      }

      return {
        price: weightedPriceSum / totalVolume,
        volume: totalVolume,
      };
    } catch (error) {
      if (error instanceof HorizonTimeoutError || error instanceof HorizonClientError)
        throw error;
      throw new PriceFetchError(
        `Failed to fetch SDEX price for ${sym}`,
        "SDEX",
        sym,
        error
      );
    }
  }

  /**
   * Fetches the asset price from Stellar AMM liquidity pools.
   */
  async fetchAMMPrice(symbol: string): Promise<{ price: number; volume: number }> {
    const sym = symbol.toUpperCase();
    try {
      const assetConfig = this.getAssetConfig(sym);
      const usdcConfig = this.getUsdcConfig();

      if (sym === "USDC") return { price: 1, volume: 1000000 };

      const assetA =
        assetConfig.code === "XLM"
          ? StellarSdk.Asset.native()
          : new StellarSdk.Asset(assetConfig.code, assetConfig.issuer);
      const assetB = new StellarSdk.Asset("USDC", usdcConfig.issuer);

      const pools = await getLiquidityPools(assetA, assetB);
      if (pools.records.length === 0) throw new Error("No liquidity pools found");

      const pool = pools.records.reduce((prev: any, current: any) => {
        const prevReserves =
          parseFloat(prev.reserves[0].amount) + parseFloat(prev.reserves[1].amount);
        const currentReserves =
          parseFloat(current.reserves[0].amount) +
          parseFloat(current.reserves[1].amount);
        return currentReserves > prevReserves ? current : prev;
      });

      const assetADescriptor =
        sym === "XLM" ? "XLM:native" : `${assetConfig.code}:${assetConfig.issuer}`;
      const assetBDescriptor = `USDC:${usdcConfig.issuer}`;
      const reserveA = pool.reserves.find(
        (r: any) => this.normalizePoolAsset(r.asset) === assetADescriptor
      );
      const reserveB = pool.reserves.find(
        (r: any) => this.normalizePoolAsset(r.asset) === assetBDescriptor
      );

      if (!reserveA || !reserveB) throw new Error("Pool missing required reserves");

      const amountA = parseFloat(reserveA.amount);
      const amountB = parseFloat(reserveB.amount);
      if (amountA === 0) throw new Error("Empty reserves");

      return { price: amountB / amountA, volume: amountB * 2 };
    } catch (error) {
      logger.warn({ error, symbol: sym }, "AMM fetch failed");
      if (error instanceof HorizonTimeoutError || error instanceof HorizonClientError)
        throw error;
      throw new PriceFetchError(
        `Failed to fetch AMM price for ${sym}`,
        "AMM",
        sym,
        error
      );
    }
  }

  /**
   * Volume-weighted average price across sources with non-zero volume.
   */
  calculateVWAP(
    sources: { price: number; volume: number; name: string; stale?: boolean }[]
  ): {
    vwap: number;
    validSources: PriceSource[];
  } {
    let totalVolume = 0;
    let sumPriceVolume = 0;
    const validSources: PriceSource[] = [];
    const now = new Date().toISOString();

    for (const s of sources) {
      if (!isNaN(s.price) && !isNaN(s.volume) && s.volume > 0) {
        totalVolume += s.volume;
        sumPriceVolume += s.price * s.volume;
        validSources.push({
          source: s.name,
          price: s.price,
          timestamp: now,
          ...(s.stale ? { stale: true } : {}),
        });
      }
    }

    if (totalVolume === 0)
      throw new Error("No valid sources with volume to calculate VWAP");

    return { vwap: sumPriceVolume / totalVolume, validSources };
  }

  /**
   * Aggregated VWAP from Stellar DEX, AMM, and Circle (when supported), with Redis caching.
   *
   * Each provider is fetched through a shared guard that applies, in order:
   *   1. circuit-breaker availability (no request while the circuit is open);
   *   2. per-provider rate limiting (independent Redis counter per provider);
   *   3. cached last-known-good fallback when the provider is throttled,
   *      its circuit is open, or the request fails.
   * A single failing provider never blocks aggregation from healthy ones.
   */
  async getAggregatedPrice(
    symbol: string,
    bypassCache: boolean = false
  ): Promise<AggregatedPrice | null> {
    const normalizedSymbol = symbol.toUpperCase();
    this.getAssetConfig(normalizedSymbol);

    const cacheKey = CacheService.generateKey(
      "price",
      `aggregated:${normalizedSymbol}`
    );

    return CacheService.getOrSet(
      cacheKey,
      async () => {
        logger.info(
          { symbol: normalizedSymbol },
          "Fetching aggregated price from sources"
        );

        const fetches: Promise<{
          price: number;
          volume: number;
          name: string;
          stale?: boolean;
        }>[] = [
          this.fetchProviderPrice(PROVIDER_SDEX, normalizedSymbol, () =>
            this.fetchSDEXPrice(normalizedSymbol)
          ),
          this.fetchProviderPrice(PROVIDER_AMM, normalizedSymbol, () =>
            this.fetchAMMPrice(normalizedSymbol)
          ),
        ];

        if (CircleSource.supports(normalizedSymbol)) {
          fetches.push(
            this.fetchProviderPrice(PROVIDER_CIRCLE, normalizedSymbol, () =>
              this.circleSource
                .getPriceSourceData(normalizedSymbol)
                .then(({ price, volume }) => ({ price, volume }))
            )
          );
        }

        const results = await Promise.allSettled(fetches);

        const sourceData: {
          price: number;
          volume: number;
          name: string;
          stale?: boolean;
        }[] = [];
        for (const result of results) {
          if (result.status === "fulfilled") {
            sourceData.push(result.value);
          } else {
            logger.warn(
              { error: result.reason, symbol: normalizedSymbol },
              "Price source fetch failed"
            );
          }
        }

        if (sourceData.length === 0) {
          const rejected = results.find(
            (r): r is PromiseRejectedResult => r.status === "rejected"
          );
          throw rejected?.reason ?? new Error("All price sources failed");
        }

        const { vwap, validSources } = this.calculateVWAP(sourceData);

        const staleSources = validSources.filter((s) => s.stale);
        if (staleSources.length > 0) {
          logger.warn(
            {
              symbol: normalizedSymbol,
              staleCount: staleSources.length,
              sources: validSources.map((s) => ({ source: s.source, stale: Boolean(s.stale) })),
            },
            "Aggregated price includes cached/last-known-good provider values"
          );
        }

        return {
          symbol: normalizedSymbol,
          vwap,
          sources: validSources,
          deviation: this.calculateDeviation(validSources, vwap),
          lastUpdated: new Date().toISOString(),
        };
      },
      {
        bypassCache,
        tags: ["price"],
        ttl: config.REDIS_CACHE_TTL_SEC,
      }
    );
  }

  // -------------------------------------------------------------------------
  // Provider guard: circuit breaker + rate limit + cached fallback
  // -------------------------------------------------------------------------

  /**
   * Fetches a single provider's price through the circuit breaker and
   * per-provider rate limiter, falling back to the last-known-good cached
   * value when the provider is throttled, its circuit is open, or the request
   * fails. Throws (rather than fabricating data) when no cached value exists.
   */
  private async fetchProviderPrice(
    providerKey: string,
    symbol: string,
    fetchFn: () => Promise<{ price: number; volume: number }>
  ): Promise<{ price: number; volume: number; name: string; stale?: boolean }> {
    const displayName = this.providerName(providerKey);

    // 1. Circuit breaker: never send a request while the circuit is open.
    //    Fails open if the breaker store is unreachable so price collection
    //    can still degrade gracefully rather than crash.
    const available = await this.isProviderAvailable(providerKey);
    if (!available) {
      const cached = await this.getCachedProviderValue(providerKey, symbol);
      if (cached) {
        logger.warn(
          { providerKey, symbol },
          "Provider circuit open — using cached price fallback"
        );
        return { ...cached, name: displayName, stale: true };
      }
      logger.warn(
        { providerKey, symbol },
        "Provider circuit open and no cached price available"
      );
      throw new PriceFetchError(
        `Provider "${providerKey}" circuit is open`,
        displayName,
        symbol
      );
    }

    // 2. Per-provider rate limit (independent Redis counter per provider).
    const rateLimit = await providerRateLimiterService.checkLimit(
      this.getProviderRateLimit(providerKey)
    );
    if (!rateLimit.allowed) {
      await this.recordThrottle(providerKey, rateLimit);
      const cached = await this.getCachedProviderValue(providerKey, symbol);
      if (cached) {
        logger.warn(
          { providerKey, symbol, retryAfterMs: rateLimit.retryAfterMs },
          "Provider rate-limited — using cached price fallback"
        );
        return { ...cached, name: displayName, stale: true };
      }
      logger.warn(
        { providerKey, symbol },
        "Provider rate-limited and no cached price available"
      );
      throw new PriceFetchError(
        `Provider "${providerKey}" rate-limited`,
        displayName,
        symbol
      );
    }

    // 3. Attempt the fetch and drive the breaker's success/failure tracking.
    try {
      const value = await fetchFn();
      await this.recordProviderSuccess(providerKey);
      await this.cacheProviderValue(providerKey, symbol, value);
      return { ...value, name: displayName };
    } catch (err) {
      // The Circle source self-limits internally and surfaces throttling as a
      // dedicated error; treat it as backpressure rather than a provider
      // failure so it doesn't count toward tripping the circuit.
      if (err instanceof CircleRateLimitError) {
        await this.recordThrottle(providerKey);
        const cached = await this.getCachedProviderValue(providerKey, symbol);
        if (cached) {
          logger.warn(
            { providerKey, symbol },
            "Provider rate-limited — using cached price fallback"
          );
          return { ...cached, name: displayName, stale: true };
        }
        logger.warn(
          { providerKey, symbol },
          "Provider rate-limited and no cached price available"
        );
        throw new PriceFetchError(
          `Provider "${providerKey}" rate-limited`,
          displayName,
          symbol
        );
      }

      await this.recordProviderFailure(
        providerKey,
        err instanceof Error ? err.message : String(err)
      );
      logger.warn(
        { providerKey, symbol, error: err },
        "Provider request failed"
      );

      const cached = await this.getCachedProviderValue(providerKey, symbol);
      if (cached) {
        logger.warn(
          { providerKey, symbol },
          "Provider request failed — using cached price fallback"
        );
        return { ...cached, name: displayName, stale: true };
      }

      throw err;
    }
  }

  private providerName(providerKey: string): string {
    return PROVIDER_NAMES[providerKey] ?? providerKey;
  }

  /**
   * Circuit-breaker helpers fail open when the breaker store is unreachable,
   * so a Postgres outage never blocks price collection entirely.
   */
  private async isProviderAvailable(providerKey: string): Promise<boolean> {
    try {
      return await providerCircuitBreakerService.isAvailable(providerKey);
    } catch (err) {
      logger.warn(
        { providerKey, err },
        "Circuit breaker check failed — proceeding without breaker protection"
      );
      return true;
    }
  }

  private async recordProviderSuccess(providerKey: string): Promise<void> {
    try {
      await providerCircuitBreakerService.recordSuccess(providerKey);
    } catch (err) {
      logger.warn(
        { providerKey, err },
        "Circuit breaker success recording failed"
      );
    }
  }

  private async recordProviderFailure(providerKey: string, reason: string): Promise<void> {
    try {
      await providerCircuitBreakerService.recordFailure(providerKey, reason);
    } catch (err) {
      logger.warn(
        { providerKey, err },
        "Circuit breaker failure recording failed"
      );
    }
  }

  private getProviderRateLimit(providerKey: string): {
    providerKey: string;
    maxRequests: number;
    windowMs: number;
  } {
    switch (providerKey) {
      case PROVIDER_SDEX:
        return {
          providerKey,
          maxRequests: config.SDEX_RATE_LIMIT_MAX,
          windowMs: config.SDEX_RATE_LIMIT_WINDOW_MS,
        };
      case PROVIDER_AMM:
        return {
          providerKey,
          maxRequests: config.AMM_RATE_LIMIT_MAX,
          windowMs: config.AMM_RATE_LIMIT_WINDOW_MS,
        };
      case PROVIDER_CIRCLE:
        return {
          providerKey,
          maxRequests: config.CIRCLE_RATE_LIMIT_MAX,
          windowMs: config.CIRCLE_RATE_LIMIT_WINDOW_MS,
        };
      default:
        throw new PriceFetchError(
          `Unknown provider ${providerKey}`,
          "CONFIG",
          providerKey
        );
    }
  }

  private providerCacheKey(providerKey: string, symbol: string): string {
    return `price:provider:${providerKey}:${symbol.toUpperCase()}`;
  }

  private async getCachedProviderValue(
    providerKey: string,
    symbol: string
  ): Promise<{ price: number; volume: number } | null> {
    try {
      const raw = await redis.get(this.providerCacheKey(providerKey, symbol));
      if (!raw) return null;

      const parsed = JSON.parse(raw) as { price?: unknown; volume?: unknown };
      if (typeof parsed?.price === "number" && Number.isFinite(parsed.price)) {
        return {
          price: parsed.price,
          volume: typeof parsed.volume === "number" && Number.isFinite(parsed.volume)
            ? parsed.volume
            : 0,
        };
      }
      return null;
    } catch (err) {
      logger.warn(
        { providerKey, symbol, err },
        "Provider cache read error"
      );
      return null;
    }
  }

  private async cacheProviderValue(
    providerKey: string,
    symbol: string,
    value: { price: number; volume: number }
  ): Promise<void> {
    try {
      await redis.set(
        this.providerCacheKey(providerKey, symbol),
        JSON.stringify({
          price: value.price,
          volume: value.volume,
          timestamp: new Date().toISOString(),
        }),
        "EX",
        config.PRICE_PROVIDER_CACHE_TTL_SEC
      );
    } catch (err) {
      logger.warn(
        { providerKey, symbol, err },
        "Provider cache write error"
      );
    }
  }

  private async recordThrottle(
    providerKey: string,
    rateLimit?: ProviderRateLimitResult
  ): Promise<void> {
    try {
      await externalRateLimitMetricsService.recordUsage({
        providerKey,
        throttled: true,
        limitTotal: this.getProviderRateLimit(providerKey).maxRequests,
        limitRemaining: 0,
        resetAtEpoch: rateLimit ? rateLimit.resetMs : undefined,
      });
    } catch (err) {
      logger.warn(
        { providerKey, err },
        "Failed to record provider rate-limit metric"
      );
    }
  }

  /**
   * Get price from a specific source (sdex, amm, or circle).
   */
  async getPriceFromSource(
    symbol: string,
    source: string
  ): Promise<PriceSource | null> {
    const normalizedSource = source.toLowerCase();
    const normalizedSymbol = symbol.toUpperCase();
    logger.info(
      { symbol: normalizedSymbol, source: normalizedSource },
      "Fetching price from specific source"
    );

    if (normalizedSource === "circle") {
      if (!CircleSource.supports(normalizedSymbol)) return null;
      const { price } =
        await this.circleSource.getPriceSourceData(normalizedSymbol);
      return {
        source: "Circle",
        price,
        timestamp: new Date().toISOString(),
      };
    }

    const fetchers: Record<
      string,
      () => Promise<{ price: number; volume: number }>
    > = {
      sdex: () => this.fetchSDEXPrice(normalizedSymbol),
      amm: () => this.fetchAMMPrice(normalizedSymbol),
    };

    const fetcher = fetchers[normalizedSource];
    if (!fetcher) return null;

    const result = await fetcher();
    return {
      source: normalizedSource.toUpperCase(),
      price: result.price,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Check if price deviation exceeds the configured threshold
   */
  async checkDeviation(
    symbol: string
  ): Promise<{ deviated: boolean; percentage: number }> {
    logger.info({ symbol }, "Checking price deviation");
    const aggregated = await this.getAggregatedPrice(symbol);

    if (!aggregated) return { deviated: false, percentage: 0 };

    return {
      deviated: aggregated.deviation > config.PRICE_DEVIATION_THRESHOLD,
      percentage: aggregated.deviation,
    };
  }

  /**
   * Get historical price data for charting
   */
  async getHistoricalPrices(
    symbol: string,
    interval: "1h" | "1d" | "7d" | "30d"
  ): Promise<{ timestamp: string; price: number }[]> {
    logger.info({ symbol, interval }, "Fetching historical prices");

    const intervalConfig: Record<"1h" | "1d" | "7d" | "30d", { bucket: string; lookbackMs: number }> = {
      "1h":  { bucket: "5 minutes",  lookbackMs: 60 * 60 * 1000 },
      "1d":  { bucket: "1 hour",     lookbackMs: 24 * 60 * 60 * 1000 },
      "7d":  { bucket: "6 hours",    lookbackMs: 7 * 24 * 60 * 60 * 1000 },
      "30d": { bucket: "1 day",      lookbackMs: 30 * 24 * 60 * 60 * 1000 },
    };

    const { bucket, lookbackMs } = intervalConfig[interval];
    const startTime = new Date(Date.now() - lookbackMs);
    const priceModel = new PriceModel();

    const rows = await priceModel.getTimeBucketed(symbol.toUpperCase(), bucket, startTime);
    return rows.map((r) => ({
      timestamp: new Date(r.bucket).toISOString(),
      price: Number(r.avg_price),
    }));
  }
}
