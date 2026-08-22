import { Queue, Worker, Job } from "bullmq";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { getDatabase } from "../database/connection.js";
import { getCircuitBreakerService, PauseScope, PauseLevel } from "../services/circuitBreaker.service.js";

export interface CircuitBreakerTriggerData {
  alertId: string;
  alertType: string;
  assetCode?: string;
  bridgeId?: string;
  severity: "low" | "medium" | "high";
  value: number;
  threshold: number;
}

const isTestEnv = process.env.NODE_ENV === "test";

class NoOpQueue<T> {
  async add(_name: string, _data: T, _opts?: unknown): Promise<void> {
    return;
  }
}

export const circuitBreakerQueue = isTestEnv
  ? new NoOpQueue<CircuitBreakerTriggerData>()
  : new Queue<CircuitBreakerTriggerData>("circuit-breaker", {
      connection: {
        host: config.REDIS_HOST,
        port: config.REDIS_PORT,
        password: config.REDIS_PASSWORD,
      },
    });

export function createCircuitBreakerProcessor(deps?: {
  getCircuitBreakerService?: typeof getCircuitBreakerService;
  getDatabase?: typeof getDatabase;
}) {
  const getCircuitBreaker = deps?.getCircuitBreakerService ?? getCircuitBreakerService;
  const getDb = deps?.getDatabase ?? getDatabase;

  return async function processCircuitBreakerTrigger(job: Job<CircuitBreakerTriggerData>) {
    const { alertId, alertType, assetCode, bridgeId, severity, value, threshold } = job.data;

    logger.info(
      {
        alertId,
        alertType,
        assetCode,
        bridgeId,
        severity,
        value,
        threshold,
      },
      "Processing circuit breaker trigger"
    );

    const circuitBreaker = getCircuitBreaker();
    if (!circuitBreaker) {
      logger.warn("Circuit breaker service not configured, skipping trigger");
      return;
    }

    try {
      // Determine pause scope and level based on alert type and severity
      let scope: PauseScope;
      let identifier: string | undefined;
      let level: PauseLevel;
      let reason: string;

      switch (alertType) {
        case "price_deviation":
          scope = PauseScope.Asset;
          identifier = assetCode;
          level = severity === "high" ? PauseLevel.Full :
                 severity === "medium" ? PauseLevel.Partial : PauseLevel.Warning;
          reason = `Price deviation alert: ${value}% (threshold: ${threshold}%)`;
          break;

        case "supply_mismatch":
          scope = PauseScope.Bridge;
          identifier = bridgeId;
          level = severity === "high" ? PauseLevel.Full : PauseLevel.Partial;
          reason = `Supply mismatch alert: ${value}% (threshold: ${threshold}%)`;
          break;

        case "bridge_downtime":
          scope = PauseScope.Bridge;
          identifier = bridgeId;
          level = PauseLevel.Full;
          reason = `Bridge downtime detected`;
          break;

        case "volume_spike":
          scope = PauseScope.Asset;
          identifier = assetCode;
          level = severity === "high" ? PauseLevel.Partial : PauseLevel.Warning;
          reason = `Volume spike alert: ${value} (threshold: ${threshold})`;
          break;

        case "reserve_ratio":
          scope = PauseScope.Bridge;
          identifier = bridgeId;
          level = severity === "high" ? PauseLevel.Full : PauseLevel.Partial;
          reason = `Reserve ratio breach: ${value}% (threshold: ${threshold}%)`;
          break;

        case "health_score":
          scope = PauseScope.Asset;
          identifier = assetCode;
          level = severity === "high" ? PauseLevel.Full :
                 severity === "medium" ? PauseLevel.Partial : PauseLevel.Warning;
          reason = `Health score drop: ${value} (threshold: ${threshold})`;
          break;

        default:
          logger.warn(`Unknown alert type for circuit breaker: ${alertType}`);
          return;
      }

      // Check if already paused to avoid duplicate triggers
      const isAlreadyPaused = await circuitBreaker.isPaused(scope, identifier);
      if (isAlreadyPaused) {
        logger.info({ scope, identifier }, "Scope already paused, skipping trigger");
        return;
      }

      // Trigger pause via emergency guardian (system account)
      // In production, this would use a dedicated system keypair
      logger.info({ scope, identifier, level, reason }, "Triggering circuit breaker pause");

      // TODO: Implement actual pause trigger with proper authentication
      // For now, log the trigger for manual intervention

      // Store the trigger in database for audit
      const db = getDb();
      await db("circuit_breaker_triggers").insert({
        alert_id: alertId,
        alert_type: alertType,
        asset_code: assetCode,
        bridge_id: bridgeId,
        severity,
        value,
        threshold,
        pause_scope: scope,
        pause_level: level,
        reason,
        triggered_at: new Date(),
        status: "triggered",
      });

      logger.info({ alertId }, "Circuit breaker trigger processed successfully");
    } catch (error) {
      logger.error({ err: error }, "Circuit breaker trigger failed");
      throw error;
    }
  };
}

export const circuitBreakerWorker = isTestEnv
  ? null
  : new Worker<CircuitBreakerTriggerData>(
      "circuit-breaker",
      createCircuitBreakerProcessor(),
  {
    connection: {
      host: config.REDIS_HOST,
      port: config.REDIS_PORT,
      password: config.REDIS_PASSWORD,
    },
    concurrency: 1, // Process one trigger at a time
    removeOnComplete: {
      count: 10,
      age: 86400,
    },
    removeOnFail: {
      count: 50,
      age: 86400,
    },
  }
);

// Event listeners
if (!isTestEnv && circuitBreakerWorker) {
  circuitBreakerWorker.on("completed", (job) => {
    logger.info(`Circuit breaker job completed: ${job.id}`);
  });

  circuitBreakerWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "Circuit breaker job failed");
  });
}

export default circuitBreakerWorker;
