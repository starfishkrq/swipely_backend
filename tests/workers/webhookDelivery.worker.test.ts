import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/webhook.service.js", () => ({
  webhookService: {
    processDelivery: vi.fn(),
    updateDeliveryStatus: vi.fn(),
  },
}));

vi.mock("../../src/services/retryPolicy.service.js", () => ({
  retryPolicyService: {
    getPolicy: vi.fn(() => ({
      maxRetries: 7,
      baseDelayMs: 1000,
      maxDelayMs: 3_600_000,
      backoffMultiplier: 2,
      jitterRatio: 0.2,
    })),
    getDelayMs: vi.fn(() => 2000),
  },
}));

vi.mock("../../src/workers/queue.js", () => ({
  getCustomBackoffStrategy: vi.fn(() => vi.fn()),
  DeliveryDLQ: class {},
}));

import {
  createWebhookDeliveryProcessor,
  createWebhookFailureHandler,
} from "../../src/workers/webhookDelivery.worker.js";

function makeJob(attemptsMade = 0) {
  return {
    id: "job-1",
    name: "deliver",
    attemptsMade,
    data: {
      deliveryId: "delivery-1",
      webhookEndpointId: "endpoint-1",
      idempotencyKey: "event-1",
      payload: { value: 1 },
    },
    returnvalue: null,
  } as any;
}

describe("webhookDelivery.worker", () => {
  const processDelivery = vi.fn();
  const getDelayMs = vi.fn();
  const updateDeliveryStatus = vi.fn();
  const moveToDLQ = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates a delivery job without changing its idempotency data", async () => {
    const job = makeJob();
    const response = { status: 200, body: "ok" };
    processDelivery.mockResolvedValue(response);
    const processWebhook = createWebhookDeliveryProcessor({ processDelivery, getDelayMs });

    await expect(processWebhook(job)).resolves.toBe(response);
    expect(processDelivery).toHaveBeenCalledOnce();
    expect(processDelivery).toHaveBeenCalledWith(job);
  });

  it("calculates retry delay and rethrows delivery failures", async () => {
    processDelivery.mockRejectedValue(new Error("request timeout"));
    getDelayMs.mockReturnValue(4000);
    const processWebhook = createWebhookDeliveryProcessor({ processDelivery, getDelayMs });

    await expect(processWebhook(makeJob(1))).rejects.toThrow(
      "Webhook delivery failed: request timeout"
    );
    expect(getDelayMs).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ operation: "webhook:delivery", maxRetries: 7 })
    );
  });

  it("marks exhausted deliveries failed and moves them to the DLQ", async () => {
    const handleFailure = createWebhookFailureHandler({ updateDeliveryStatus, moveToDLQ });

    await handleFailure(makeJob(7), new Error("endpoint unavailable"));

    expect(updateDeliveryStatus).toHaveBeenCalledWith(
      "delivery-1",
      "failed",
      undefined,
      "endpoint unavailable"
    );
    expect(moveToDLQ).toHaveBeenCalledWith(
      expect.objectContaining({
        queue_name: "webhook-delivery",
        payload: expect.objectContaining({ idempotencyKey: "event-1" }),
        attempts: 7,
        last_error: "endpoint unavailable",
      })
    );
  });

  it("leaves retryable failures for BullMQ to retry", async () => {
    const handleFailure = createWebhookFailureHandler({ updateDeliveryStatus, moveToDLQ });

    await handleFailure(makeJob(6), new Error("temporary failure"));

    expect(updateDeliveryStatus).not.toHaveBeenCalled();
    expect(moveToDLQ).not.toHaveBeenCalled();
  });
});
