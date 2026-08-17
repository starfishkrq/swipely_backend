import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProviderRateLimiterService } from "../../src/services/providerRateLimiter.service.js";

const evalMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/utils/redis.js", () => ({
  redis: { eval: evalMock },
}));

describe("ProviderRateLimiterService", () => {
  let service: ProviderRateLimiterService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new ProviderRateLimiterService();
  });

  it("allows a request under the limit and reports window metadata", async () => {
    evalMock.mockResolvedValue([1, 1, 123_456, 10]);

    const result = await service.checkLimit({
      providerKey: "sdex",
      maxRequests: 10,
      windowMs: 60_000,
    });

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(10);
    expect(result.remaining).toBe(9);
  });

  it("rejects a request once the limit is reached", async () => {
    evalMock.mockResolvedValue([0, 10, 123_456, 10]);

    const result = await service.checkLimit({
      providerKey: "sdex",
      maxRequests: 10,
      windowMs: 60_000,
    });

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("keeps an independent Redis key per provider", async () => {
    evalMock.mockResolvedValue([1, 1, 123_456, 10]);

    await service.checkLimit({ providerKey: "sdex", maxRequests: 10, windowMs: 60_000 });
    await service.checkLimit({ providerKey: "amm", maxRequests: 20, windowMs: 60_000 });

    expect(evalMock.mock.calls[0][1]).toBe(1);
    expect(evalMock.mock.calls[0][2]).toBe("bw:provider:rl:sdex");
    expect(evalMock.mock.calls[1][2]).toBe("bw:provider:rl:amm");
  });

  it("passes the configured window and limit into the eval script", async () => {
    evalMock.mockResolvedValue([1, 1, 123_456, 5]);

    await service.checkLimit({ providerKey: "sdex", maxRequests: 5, windowMs: 10_000 });

    // eval args: (script, numKeys, key, now, window, limit)
    expect(evalMock.mock.calls[0][4]).toBe("10000");
    expect(evalMock.mock.calls[0][5]).toBe("5");
  });

  it("fails open when Redis errors", async () => {
    evalMock.mockRejectedValue(new Error("redis down"));

    const result = await service.checkLimit({
      providerKey: "sdex",
      maxRequests: 10,
      windowMs: 60_000,
    });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(10);
  });

  it("does not let concurrent calls bypass the per-provider limit", async () => {
    // In-memory emulation of the Lua sliding-window script keyed per provider.
    const windows = new Map<string, number[]>();
    evalMock.mockImplementation(
      async (
        _script: string,
        _numKeys: number,
        key: string,
        now: string,
        window: string,
        limit: string
      ) => {
        const nowMs = Number(now);
        const windowMs = Number(window);
        const limitNum = Number(limit);
        const active = (windows.get(key) ?? []).filter((ts) => ts > nowMs - windowMs);
        if (active.length >= limitNum) {
          windows.set(key, active);
          return [0, active.length, nowMs + windowMs, limitNum];
        }
        active.push(nowMs);
        windows.set(key, active);
        return [1, active.length, nowMs + windowMs, limitNum];
      }
    );

    const sdexCalls = Array.from({ length: 5 }, () =>
      service.checkLimit({ providerKey: "sdex", maxRequests: 2, windowMs: 60_000 })
    );
    const ammCalls = Array.from({ length: 5 }, () =>
      service.checkLimit({ providerKey: "amm", maxRequests: 2, windowMs: 60_000 })
    );

    const [sdexResults, ammResults] = [
      await Promise.all(sdexCalls),
      await Promise.all(ammCalls),
    ];

    expect(sdexResults.filter((r) => r.allowed)).toHaveLength(2);
    expect(ammResults.filter((r) => r.allowed)).toHaveLength(2);
  });
});
