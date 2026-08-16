import { describe, it, expect, vi, beforeEach } from "vitest";

const runRecoveryProbeSweepMock = vi.hoisted(() => vi.fn());
const loggerInfoMock = vi.hoisted(() => vi.fn());
const loggerErrorMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/services/providerCircuitBreaker.service.js", () => ({
  providerCircuitBreakerService: {
    runRecoveryProbeSweep: runRecoveryProbeSweepMock,
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { info: loggerInfoMock, warn: vi.fn(), error: loggerErrorMock },
}));

vi.mock("../../src/config/index.js", () => ({
  config: { PROVIDER_BREAKER_PROBE_INTERVAL_MS: 30_000 },
}));

import { runRecoveryProbeSweep } from "../../src/jobs/providerCircuitBreaker.job.js";

describe("providerCircuitBreaker.job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns and logs the providers that transitioned to half-open", async () => {
    runRecoveryProbeSweepMock.mockResolvedValue(["sdex", "circle"]);

    const result = await runRecoveryProbeSweep();

    expect(result).toEqual(["sdex", "circle"]);
    expect(loggerInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({ probed: ["sdex", "circle"], count: 2 }),
      expect.stringContaining("half-open")
    );
  });

  it("returns an empty list and logs when the sweep fails", async () => {
    runRecoveryProbeSweepMock.mockRejectedValue(new Error("db down"));

    const result = await runRecoveryProbeSweep();

    expect(result).toEqual([]);
    expect(loggerErrorMock).toHaveBeenCalled();
  });
});
