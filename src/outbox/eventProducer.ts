import type { Knex } from "knex";
import { createHash } from "crypto";
import { logger } from "../utils/logger.js";

// Match existing event types from webhook service
export type OutboxEventType =
  | "alert.triggered"
  | "alert.resolved"
  | "alert.acknowledged"
  | "alert.closed"
  | "webhook.delivery"
  | "webhook.batch_delivery"
  | "bridge.status_changed"
  | "health.score_changed"
  | "incident.created"
  | "incident.updated"
  | "admin.rotation"
  | "digest.scheduled"
  | "transaction.update"
  | "discord.alert"
  | "bridge.supply_mismatch";

export interface OutboxEvent<T = any> {
  aggregateType: string;
  aggregateId: string;
  eventType: OutboxEventType;
  payload: T;
  metadata?: Record<string, any>;
  idempotencyKey?: string;
}

export interface OutboxEventRecord {
  id: string;
  aggregateType: string;
  aggregateId: string;
  sequenceNo: string;
  eventType: string;
  payload: any;
  metadata: any;
  idempotencyKey?: string;
  status: "pending" | "processing" | "delivered" | "failed";
  retryCount: number;
  retryAfter: Date;
  deliveredAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
}

export class OutboxProducer {
  constructor(private db: Knex) {}

  /**
   * Generate a deterministic idempotency key for an event
   * Uses SHA-256 hash of aggregate type, aggregate id, event type, and payload
   */
  private generateIdempotencyKey<T>(event: OutboxEvent<T>): string {
    const keyString = `${event.aggregateType}:${event.aggregateId}:${event.eventType}:${JSON.stringify(event.payload)}`;
    return createHash("sha256").update(keyString).digest("hex");
  }

  /**
   * Publish an event transactionally within an existing transaction
   * This is the primary method for ensuring ACID compliance
   */
  async publishTransactional<T>(
    tx: Knex.Transaction,
    event: OutboxEvent<T>
  ): Promise<void> {
    try {
      // Generate or use provided idempotency key
      const idempotencyKey = event.idempotencyKey || this.generateIdempotencyKey(event);

      // Get next sequence number atomically
      const [{ get_next_outbox_sequence: sequenceNo }] = await tx.raw(
        "SELECT get_next_outbox_sequence(?, ?) as get_next_outbox_sequence",
        [event.aggregateType, event.aggregateId]
      );

      // Insert event into outbox
      await tx("outbox_events").insert({
        aggregate_type: event.aggregateType,
        aggregate_id: event.aggregateId,
        sequence_no: sequenceNo,
        event_type: event.eventType,
        payload: JSON.stringify(event.payload),
        metadata: JSON.stringify({
          producer: "outbox-producer",
          timestamp: new Date().toISOString(),
          ...event.metadata,
        }),
        idempotency_key: idempotencyKey,
        status: "pending",
        retry_count: 0,
        retry_after: new Date(),
      });

      logger.debug(
        {
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          eventType: event.eventType,
          sequenceNo,
        },
        "Event published to outbox"
      );
    } catch (error) {
      logger.error(
        {
          error,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          eventType: event.eventType,
        },
        "Failed to publish event to outbox"
      );
      throw error;
    }
  }

  /**
   * Publish an event in its own transaction (use sparingly)
   * Prefer publishTransactional for ACID compliance
   */
  async publish<T>(event: OutboxEvent<T>): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.publishTransactional(tx, event);
    });
  }

  /**
   * Publish multiple events in a single transaction
   * Maintains ordering within the transaction
   */
  async publishBatch<T>(events: OutboxEvent<T>[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const event of events) {
        await this.publishTransactional(tx, event);
      }
    });
  }

  /**
   * Get pending events for processing (used by dispatcher)
   */
  async getPendingEvents(
    limit = 100,
    skipLocked = true
  ): Promise<OutboxEventRecord[]> {
    const query = this.db("outbox_events")
      .select("*")
      .where("status", "pending")
      .where("retry_after", "<=", new Date())
      .orderBy([
        { column: "aggregate_type", order: "asc" },
        { column: "aggregate_id", order: "asc" },
        { column: "sequence_no", order: "asc" },
      ])
      .limit(limit);

    if (skipLocked) {
      query.forUpdate().skipLocked();
    }

    const rows = await query;
    return rows.map(this.mapToEventRecord);
  }

  /**
   * Mark event as processing (prevents duplicate processing)
   */
  async markProcessing(eventId: string): Promise<boolean> {
    const updated = await this.db("outbox_events")
      .where({ id: eventId, status: "pending" })
      .update({ status: "processing" });
    
    return updated > 0;
  }

  /**
   * Mark event as delivered
   */
  async markDelivered(eventId: string): Promise<void> {
    await this.db("outbox_events")
      .where({ id: eventId })
      .update({
        status: "delivered",
        delivered_at: new Date(),
      });
  }

  /**
   * Mark event for retry with exponential backoff
   */
  async markForRetry(
    eventId: string,
    error: string,
    maxRetries = 5
  ): Promise<void> {
    const [event] = await this.db("outbox_events")
      .select("retry_count")
      .where({ id: eventId });

    if (!event) {
      throw new Error(`Event not found: ${eventId}`);
    }

    const retryCount = event.retry_count + 1;
    
    if (retryCount >= maxRetries) {
      // Move to dead letter queue
      await this.moveToDeadLetter(eventId, error, retryCount);
    } else {
      // Schedule retry with exponential backoff
      const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 15 * 60 * 1000); // Cap at 15 minutes
      const retryAfter = new Date(Date.now() + backoffMs);

      await this.db("outbox_events")
        .where({ id: eventId })
        .update({
          status: "pending",
          retry_count: retryCount,
          retry_after: retryAfter,
          error_message: error,
        });
    }
  }

  /**
   * Move event to dead letter queue
   */
  private async moveToDeadLetter(
    eventId: string,
    error: string,
    errorCount: number
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Get event details
      const [event] = await tx("outbox_events")
        .select("*")
        .where({ id: eventId });

      if (!event) {
        throw new Error(`Event not found: ${eventId}`);
      }

      // Insert into dead letter queue
      await tx("dead_letter_events").insert({
        outbox_id: eventId,
        event_type: event.event_type,
        aggregate_id: event.aggregate_id,
        payload: event.payload,
        error_count: errorCount,
        last_error: error,
        last_attempt: new Date(),
      });

      // Mark original event as failed
      await tx("outbox_events")
        .where({ id: eventId })
        .update({
          status: "failed",
          error_message: error,
        });
    });

    logger.warn(
      { eventId, errorCount, error },
      "Event moved to dead letter queue"
    );
  }

  /**
   * Get dead letter queue statistics
   */
  async getDeadLetterStats(): Promise<{
    total: number;
    byEventType: Array<{ eventType: string; count: number }>;
    byError: Array<{ error: string; count: number }>;
  }> {
    const [totalResult] = await this.db("dead_letter_events").count("* as count");
    const total = parseInt(totalResult.count as string);

    const byEventType = await this.db("dead_letter_events")
      .select("event_type as eventType")
      .count("* as count")
      .groupBy("event_type")
      .orderBy("count", "desc");

    const byError = await this.db("dead_letter_events")
      .select("last_error as error")
      .count("* as count")
      .groupBy("last_error")
      .orderBy("count", "desc")
      .limit(10);

    return {
      total,
      byEventType: byEventType.map(row => ({
        eventType: row.eventType,
        count: parseInt(row.count as string),
      })),
      byError: byError.map(row => ({
        error: row.error,
        count: parseInt(row.count as string),
      })),
    };
  }

  private mapToEventRecord(row: any): OutboxEventRecord {
    return {
      id: row.id.toString(),
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      sequenceNo: row.sequence_no.toString(),
      eventType: row.event_type,
      payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
      metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
      idempotencyKey: row.idempotency_key,
      status: row.status,
      retryCount: row.retry_count,
      retryAfter: row.retry_after,
      deliveredAt: row.delivered_at,
      errorMessage: row.error_message,
      createdAt: row.created_at,
    };
  }
}