import { Worker, Queue } from "bullmq";
import { config } from "../config/index.js";
import { AlertService, type MetricSnapshot } from "../services/alert.service.js";
import { logger } from "../utils/logger.js";

const QUEUE_NAME = "alert-evaluation";

const connection = {
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD || undefined,
};

export const alertEvaluationQueue = new Queue(QUEUE_NAME, { connection });

export interface AlertEvaluationJobData {
  snapshots: MetricSnapshot[];
}

export function createAlertEvaluationProcessor(
  createAlertService: () => Pick<AlertService, "batchEvaluate"> = () => new AlertService()
) {
  return async function processAlertEvaluation(job: {
    id?: string;
    data: AlertEvaluationJobData;
  }) {
    const alertService = createAlertService();
    const { snapshots } = job.data;

    logger.info(
      { jobId: job.id, assetCount: snapshots.length },
      "Processing alert evaluation job"
    );

    const events = await alertService.batchEvaluate(snapshots);

    logger.info(
      { jobId: job.id, alertCount: events.length },
      "Alert evaluation complete"
    );

    return { success: true, alertCount: events.length, events };
  };
}

export const alertEvaluationWorker = new Worker<AlertEvaluationJobData>(
  QUEUE_NAME,
  createAlertEvaluationProcessor(),
  { connection, concurrency: 1 }
);

alertEvaluationWorker.on("completed", (job) => {
  logger.debug({ jobId: job?.id }, "Alert evaluation job completed");
});

alertEvaluationWorker.on("failed", (job, error) => {
  logger.error(
    { jobId: job?.id, error: error.message },
    "Alert evaluation job failed"
  );
});

export async function scheduleAlertEvaluation(
  snapshots: MetricSnapshot[]
): Promise<void> {
  await alertEvaluationQueue.add("evaluate", { snapshots });
}

export function buildMetricSnapshot(
  assetCode: string,
  metrics: {
    priceDeviationBps?: number;
    supplyMismatchBps?: number;
    bridgeUptimePct?: number;
    healthScore?: number;
    volumeZscore?: number;
    reserveRatioBps?: number;
  }
): MetricSnapshot {
  return {
    assetCode,
    metrics: {
      price_deviation_bps: metrics.priceDeviationBps ?? 0,
      supply_mismatch_bps: metrics.supplyMismatchBps ?? 0,
      bridge_uptime_pct: metrics.bridgeUptimePct ?? 100,
      health_score: metrics.healthScore ?? 100,
      volume_zscore: metrics.volumeZscore ?? 0,
      reserve_ratio_bps: metrics.reserveRatioBps ?? 10000,
    },
  };
}
