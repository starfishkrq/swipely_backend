import { describe, it, expect, vi, beforeEach } from "vitest";

const getAggregatedPriceMock = vi.hoisted(() => vi.fn());
const loggerWarnMock = vi.hoisted(() => vi.fn());
const loggerErrorMock = vi.hoisted(() => vi.fn());
const loggerInfoMock = vi.hoisted(() => vi.fn());
const loggerDebugMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/services/price.service.js", () => ({
  PriceService: class {
    getAggregatedPrice = getAggregatedPriceMock;
  },
}));

vi.mock("../../src/config/index.js", () => ({
  SUPPORTED_ASSETS: [{ code: "USDC" }, { code: "XLM" }],
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: loggerErrorMock,
    debug: loggerDebugMock,
  },
}));

import { processPriceCollection } from "../../src/workers/priceCollection.job.js";

function makeAggregated(symbol: string, sources: Array<Record<string, unknown>>) {
  return {
    symbol,
    vwap: 1,
    sources,
    deviation: 0,
    lastUpdated: new Date().toISOString(),
  };
}

describe("priceCollection.job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs when cached/last-known-good values are used", async () => {
    getAggregatedPriceMock.mockImplementation((symbol: string) =>
      Promise.resolve(
        makeAggregated(symbol, [
          {
            source: "Stellar DEX",
            price: 1,
            timestamp: new Date().toISOString(),
            stale: true,
          },
        ])
      )
    );

    await processPriceCollection({ id: "job-1" } as any);

    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({ asset: "USDC", staleSources: ["Stellar DEX"] }),
      expect.stringContaining("cached/last-known-good")
    );
  });

  it("continues to the next asset when one fetch fails", async () => {
    getAggregatedPriceMock
      .mockRejectedValueOnce(new Error("USDC failed"))
      .mockResolvedValue(
        makeAggregated("XLM", [
          { source: "Stellar DEX", price: 0.1, timestamp: new Date().toISOString() },
        ])
      );

    await processPriceCollection({ id: "job-2" } as any);

    expect(getAggregatedPriceMock).toHaveBeenCalledTimes(2);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ asset: "USDC" }),
      expect.stringContaining("Failed to fetch aggregated price")
    );
  });

  it("starts with an info log", async () => {
    getAggregatedPriceMock.mockResolvedValue(
      makeAggregated("USDC", [
        { source: "Stellar DEX", price: 1, timestamp: new Date().toISOString() },
      ])
    );

    await processPriceCollection({ id: "job-3" } as any);

    expect(loggerInfoMock).toHaveBeenCalledWith(
      { jobId: "job-3" },
      "Starting price collection job"
    );
  });
});
