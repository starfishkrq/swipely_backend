import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "../helpers/knexMock.js";
import {
  createCircuitBreakerProcessor,
  type CircuitBreakerTriggerData,
} from "../../src/workers/circuitBreaker.worker.js";
import { PauseLevel, PauseScope } from "../../src/services/circuitBreaker.service.js";

function makeJob(overrides: Partial<CircuitBreakerTriggerData> = {}) {
  return {
    id: "job-1",
    data: {
      alertId: "alert-1",
      alertType: "price_deviation",
      assetCode: "USDC",
      severity: "high",
      value: 4,
      threshold: 2,
      ...overrides,
    },
  } as any;
}

describe("circuitBreaker.worker", () => {
  const isPaused = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    isPaused.mockResolvedValue(false);
  });

  it("persists a correctly scoped trigger", async () => {
    const db = createMockDb(["circuit_breaker_triggers"]);
    const processTrigger = createCircuitBreakerProcessor({
      getCircuitBreakerService: () => ({ isPaused } as any),
      getDatabase: () => db as any,
    });

    await processTrigger(makeJob());

    expect(isPaused).toHaveBeenCalledWith(PauseScope.Asset, "USDC");
    expect(db.__store.circuit_breaker_triggers).toEqual([
      expect.objectContaining({
        alert_id: "alert-1",
        alert_type: "price_deviation",
        asset_code: "USDC",
        pause_scope: PauseScope.Asset,
        pause_level: PauseLevel.Full,
        status: "triggered",
      }),
    ]);
  });

  it("does not write a duplicate trigger when the scope is already paused", async () => {
    const db = createMockDb(["circuit_breaker_triggers"]);
    isPaused.mockResolvedValue(true);
    const processTrigger = createCircuitBreakerProcessor({
      getCircuitBreakerService: () => ({ isPaused } as any),
      getDatabase: () => db as any,
    });

    await processTrigger(makeJob());

    expect(db("circuit_breaker_triggers").insert).not.toHaveBeenCalled();
  });

  it("surfaces database failures so BullMQ can retry the job", async () => {
    const db = createMockDb(["circuit_breaker_triggers"]);
    db("circuit_breaker_triggers").insert.mockImplementationOnce(() => {
      throw new Error("database unavailable");
    });
    const processTrigger = createCircuitBreakerProcessor({
      getCircuitBreakerService: () => ({ isPaused } as any),
      getDatabase: () => db as any,
    });

    await expect(processTrigger(makeJob())).rejects.toThrow("database unavailable");
  });
});
