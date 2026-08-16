import { describe, it, expect, beforeEach, vi } from "vitest";
import { ProviderCircuitBreakerService } from "../../src/services/providerCircuitBreaker.service.js";

const createQueryBuilder = (rows: any[] = []) => {
  const builder: any = {
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockResolvedValue(1),
    onConflict: vi.fn().mockReturnThis(),
    merge: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
    first: vi.fn().mockResolvedValue(rows[0]),
    then: (resolve: (value: any) => any) => resolve(rows),
  };
  return builder;
};

const mockKnex = vi.hoisted(() => {
  const knex: any = vi.fn(() => createQueryBuilder([]));
  knex.raw = vi.fn((sql: string) => sql);
  return knex;
});

const auditLogMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const loggerInfoMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/database/connection.js", () => ({
  getDatabase: () => mockKnex,
}));

vi.mock("../../src/services/audit.service.js", () => ({
  auditService: { log: auditLogMock },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { info: loggerInfoMock, warn: vi.fn(), error: vi.fn() },
}));

function makeStateRow(overrides: Record<string, unknown> = {}) {
  return {
    provider_key: "coingecko",
    state: "closed",
    consecutive_failures: 0,
    failure_threshold: 3,
    recovery_timeout_ms: 60_000,
    trip_count: 0,
    fallback_provider_key: "coinmarketcap",
    manual_override: null,
    opened_at: null,
    half_opened_at: null,
    last_failure_at: null,
    last_success_at: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("ProviderCircuitBreakerService", () => {
  let service: ProviderCircuitBreakerService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProviderCircuitBreakerService();
  });

  describe("isAvailable", () => {
    it("is available when closed", async () => {
      mockKnex.mockImplementation(() => {
        const builder = createQueryBuilder([]);
        builder.first = vi.fn().mockResolvedValue(makeStateRow());
        return builder;
      });

      expect(await service.isAvailable("coingecko")).toBe(true);
    });

    it("is unavailable while open and within the recovery timeout", async () => {
      mockKnex.mockImplementation(() => {
        const builder = createQueryBuilder([]);
        builder.first = vi.fn().mockResolvedValue(
          makeStateRow({ state: "open", opened_at: new Date().toISOString() })
        );
        return builder;
      });

      expect(await service.isAvailable("coingecko")).toBe(false);
    });

    it("transitions to half-open and allows a probe once the timeout elapses", async () => {
      mockKnex.mockImplementation(() => {
        const builder = createQueryBuilder([]);
        builder.first = vi.fn().mockResolvedValue(
          makeStateRow({ state: "open", opened_at: new Date(Date.now() - 120_000).toISOString() })
        );
        return builder;
      });

      const available = await service.isAvailable("coingecko");

      expect(available).toBe(true);
      expect(mockKnex).toHaveBeenCalledWith("provider_circuit_breaker_transitions");
    });

    it("respects a force_open manual override regardless of state", async () => {
      mockKnex.mockImplementation(() => {
        const builder = createQueryBuilder([]);
        builder.first = vi.fn().mockResolvedValue(makeStateRow({ manual_override: "force_open" }));
        return builder;
      });

      expect(await service.isAvailable("coingecko")).toBe(false);
    });
  });

  describe("recordFailure", () => {
    it("trips the breaker open once the failure threshold is reached", async () => {
      mockKnex.mockImplementation(() => {
        const builder = createQueryBuilder([]);
        builder.first = vi.fn().mockResolvedValue(
          makeStateRow({ consecutive_failures: 2, failure_threshold: 3 })
        );
        return builder;
      });

      await service.recordFailure("coingecko", "timeout");

      expect(mockKnex).toHaveBeenCalledWith("provider_circuit_breaker_state");
      expect(auditLogMock).toHaveBeenCalledWith(
        expect.objectContaining({ action: "provider.circuit_breaker_tripped" })
      );
    });

    it("does not trip below the failure threshold", async () => {
      mockKnex.mockImplementation(() => {
        const builder = createQueryBuilder([]);
        builder.first = vi.fn().mockResolvedValue(
          makeStateRow({ consecutive_failures: 0, failure_threshold: 3 })
        );
        return builder;
      });

      await service.recordFailure("coingecko", "timeout");

      expect(auditLogMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: "provider.circuit_breaker_tripped" })
      );
    });
  });

  describe("recordSuccess", () => {
    it("closes the breaker after a successful half-open probe", async () => {
      mockKnex.mockImplementation(() => {
        const builder = createQueryBuilder([]);
        builder.first = vi.fn().mockResolvedValue(makeStateRow({ state: "half_open" }));
        return builder;
      });

      await service.recordSuccess("coingecko");

      expect(auditLogMock).toHaveBeenCalledWith(
        expect.objectContaining({ action: "provider.circuit_breaker_recovered" })
      );
      expect(loggerInfoMock).toHaveBeenCalledWith(
        expect.objectContaining({ providerKey: "coingecko", toState: "closed" }),
        expect.stringContaining("recovery succeeded")
      );
    });
  });

  describe("getFallbackProvider", () => {
    it("returns null while the breaker is closed with no override", async () => {
      mockKnex.mockImplementation(() => {
        const builder = createQueryBuilder([]);
        builder.first = vi.fn().mockResolvedValue(makeStateRow());
        return builder;
      });

      expect(await service.getFallbackProvider("coingecko")).toBeNull();
    });

    it("returns the configured fallback while open", async () => {
      mockKnex.mockImplementation(() => {
        const builder = createQueryBuilder([]);
        builder.first = vi.fn().mockResolvedValue(makeStateRow({ state: "open" }));
        return builder;
      });

      expect(await service.getFallbackProvider("coingecko")).toBe("coinmarketcap");
    });
  });

  describe("runRecoveryProbeSweep", () => {
    it("returns the provider keys that transitioned to half-open", async () => {
      mockKnex.mockImplementation(() =>
        createQueryBuilder([
          makeStateRow({
            state: "open",
            opened_at: new Date(Date.now() - 120_000).toISOString(),
            recovery_timeout_ms: 60_000,
          }),
        ])
      );

      const probed = await service.runRecoveryProbeSweep();

      expect(probed).toEqual(["coingecko"]);
      expect(loggerInfoMock).toHaveBeenCalledWith(
        expect.objectContaining({ providerKey: "coingecko", toState: "half_open" }),
        expect.stringContaining("half-open")
      );
    });

    it("skips open breakers still inside their recovery timeout", async () => {
      mockKnex.mockImplementation(() =>
        createQueryBuilder([
          makeStateRow({
            state: "open",
            opened_at: new Date().toISOString(),
            recovery_timeout_ms: 60_000,
          }),
        ])
      );

      const probed = await service.runRecoveryProbeSweep();

      expect(probed).toEqual([]);
    });
  });

  describe("callWithBreaker", () => {
    it("throws without invoking the function when the breaker is open", async () => {
      mockKnex.mockImplementation(() => {
        const builder = createQueryBuilder([]);
        builder.first = vi.fn().mockResolvedValue(
          makeStateRow({ state: "open", opened_at: new Date().toISOString() })
        );
        return builder;
      });

      const fn = vi.fn();
      await expect(service.callWithBreaker("coingecko", fn)).rejects.toThrow(/circuit is open/);
      expect(fn).not.toHaveBeenCalled();
    });

    it("records success when the wrapped call succeeds", async () => {
      mockKnex.mockImplementation(() => {
        const builder = createQueryBuilder([]);
        builder.first = vi.fn().mockResolvedValue(makeStateRow());
        return builder;
      });

      const fn = vi.fn().mockResolvedValue("ok");
      const result = await service.callWithBreaker("coingecko", fn);

      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
