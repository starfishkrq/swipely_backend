import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/alert.service.js", () => ({
  AlertService: class {},
}));

import {
  alertEvaluationQueue,
  buildMetricSnapshot,
  createAlertEvaluationProcessor,
  scheduleAlertEvaluation,
} from "../../src/workers/alertEvaluation.worker.js";

describe("alertEvaluation.worker", () => {
  const batchEvaluate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the evaluated alerts from the service", async () => {
    const snapshots = [buildMetricSnapshot("USDC", { priceDeviationBps: 250 })];
    const events = [{ eventId: "event-1", assetCode: "USDC" }];
    batchEvaluate.mockResolvedValue(events);
    const processEvaluation = createAlertEvaluationProcessor(() => ({ batchEvaluate } as any));

    const result = await processEvaluation({ id: "job-1", data: { snapshots } });

    expect(batchEvaluate).toHaveBeenCalledWith(snapshots);
    expect(result).toEqual({ success: true, alertCount: 1, events });
  });

  it("surfaces evaluation failures so BullMQ marks the job as failed", async () => {
    const error = new Error("rules unavailable");
    batchEvaluate.mockRejectedValue(error);
    const processEvaluation = createAlertEvaluationProcessor(() => ({ batchEvaluate } as any));

    await expect(
      processEvaluation({ id: "job-2", data: { snapshots: [] } })
    ).rejects.toBe(error);
  });

  it("enqueues snapshots on the alert evaluation queue", async () => {
    const snapshots = [buildMetricSnapshot("EURC", { healthScore: 75 })];

    await scheduleAlertEvaluation(snapshots);

    expect(alertEvaluationQueue.add).toHaveBeenCalledWith("evaluate", { snapshots });
  });
});
