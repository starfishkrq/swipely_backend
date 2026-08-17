import { getDatabase } from "../database/connection.js";
import { auditService } from "./audit.service.js";
import { logger } from "../utils/logger.js";

export type BreakerState = "closed" | "open" | "half_open";
export type ManualOverride = "force_open" | "force_closed" | null;

export interface ProviderBreakerState {
  providerKey: string;
  state: BreakerState;
  consecutiveFailures: number;
  failureThreshold: number;
  recoveryTimeoutMs: number;
  tripCount: number;
  fallbackProviderKey: string | null;
  manualOverride: ManualOverride;
  openedAt: string | null;
  halfOpenedAt: string | null;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  updatedAt: string;
}

export interface BreakerTransition {
  id: string;
  providerKey: string;
  fromState: BreakerState;
  toState: BreakerState;
  reason: string;
  createdAt: string;
}

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_RECOVERY_TIMEOUT_MS = 60_000;

export class ProviderCircuitBreakerService {
  private db = getDatabase();

  async getState(providerKey: string): Promise<ProviderBreakerState> {
    const row = await this.ensureState(providerKey);
    return this.mapRow(row);
  }

  async listStates(): Promise<ProviderBreakerState[]> {
    const rows = await this.db("provider_circuit_breaker_state").orderBy("provider_key");
    return rows.map((row) => this.mapRow(row));
  }

  async getTransitionHistory(providerKey: string, limit = 50): Promise<BreakerTransition[]> {
    const rows = await this.db("provider_circuit_breaker_transitions")
      .where({ provider_key: providerKey })
      .orderBy("created_at", "desc")
      .limit(Math.min(limit, 200));

    return rows.map((row) => ({
      id: String(row.id),
      providerKey: String(row.provider_key),
      fromState: row.from_state as BreakerState,
      toState: row.to_state as BreakerState,
      reason: String(row.reason),
      createdAt: new Date(String(row.created_at)).toISOString(),
    }));
  }

  /**
   * Returns true if a call to this provider should be attempted. A half-open
   * breaker allows exactly the caller that observes the transition through as
   * a recovery probe; the result of that call drives the next transition.
   */
  async isAvailable(providerKey: string): Promise<boolean> {
    const row = await this.ensureState(providerKey);
    const state = this.mapRow(row);

    if (state.manualOverride === "force_open") return false;
    if (state.manualOverride === "force_closed") return true;

    if (state.state === "closed") return true;

    if (state.state === "open") {
      const openedAt = state.openedAt ? new Date(state.openedAt).getTime() : 0;
      if (Date.now() >= openedAt + state.recoveryTimeoutMs) {
        await this.transition(providerKey, "open", "half_open", "recovery timeout elapsed; allowing probe");
        return true;
      }
      return false;
    }

    // half_open: a probe is already in flight, but the caller is free to attempt it
    return true;
  }

  async recordSuccess(providerKey: string): Promise<ProviderBreakerState> {
    const row = await this.ensureState(providerKey);
    const state = this.mapRow(row);

    await this.db("provider_circuit_breaker_state")
      .where({ provider_key: providerKey })
      .update({ last_success_at: new Date(), consecutive_failures: 0, updated_at: new Date() });

    if (state.state === "half_open") {
      await this.transition(providerKey, "half_open", "closed", "recovery probe succeeded");
      await auditService.log({
        action: "provider.circuit_breaker_recovered",
        actorId: "system",
        actorType: "system",
        resourceType: "provider",
        resourceId: providerKey,
      });
    }

    return this.getState(providerKey);
  }

  async recordFailure(providerKey: string, reason = "request failed"): Promise<ProviderBreakerState> {
    const row = await this.ensureState(providerKey);
    const state = this.mapRow(row);
    const consecutiveFailures = state.consecutiveFailures + 1;

    await this.db("provider_circuit_breaker_state")
      .where({ provider_key: providerKey })
      .update({ last_failure_at: new Date(), consecutive_failures: consecutiveFailures, updated_at: new Date() });

    if (state.state === "half_open") {
      await this.tripOpen(providerKey, "half_open", "recovery probe failed");
    } else if (state.state === "closed" && consecutiveFailures >= state.failureThreshold) {
      await this.tripOpen(providerKey, "closed", `failure threshold reached (${consecutiveFailures}/${state.failureThreshold}): ${reason}`);
    }

    return this.getState(providerKey);
  }

  /**
   * Convenience wrapper so callers can route a provider call through the
   * breaker without manually tracking success/failure bookkeeping.
   */
  async callWithBreaker<T>(providerKey: string, fn: () => Promise<T>): Promise<T> {
    const available = await this.isAvailable(providerKey);
    if (!available) {
      const fallback = await this.getFallbackProvider(providerKey);
      throw new Error(
        fallback
          ? `Provider "${providerKey}" circuit is open; fall back to "${fallback}"`
          : `Provider "${providerKey}" circuit is open and no fallback is configured`
      );
    }

    try {
      const result = await fn();
      await this.recordSuccess(providerKey);
      return result;
    } catch (error) {
      await this.recordFailure(providerKey, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async getFallbackProvider(providerKey: string): Promise<string | null> {
    const state = await this.getState(providerKey);
    if (state.state === "closed" && state.manualOverride !== "force_open") return null;
    return state.fallbackProviderKey;
  }

  async setFallback(providerKey: string, fallbackProviderKey: string | null, actorId: string): Promise<ProviderBreakerState> {
    await this.ensureState(providerKey);
    await this.db("provider_circuit_breaker_state")
      .where({ provider_key: providerKey })
      .update({ fallback_provider_key: fallbackProviderKey, updated_at: new Date() });

    await auditService.log({
      action: "provider.circuit_breaker_override",
      actorId,
      actorType: "api_key",
      resourceType: "provider",
      resourceId: providerKey,
      metadata: { fallbackProviderKey },
    });

    return this.getState(providerKey);
  }

  async setManualOverride(providerKey: string, override: ManualOverride, actorId: string): Promise<ProviderBreakerState> {
    await this.ensureState(providerKey);
    const updates: Record<string, unknown> = { manual_override: override, updated_at: new Date() };

    if (override === "force_closed") {
      updates.state = "closed";
      updates.consecutive_failures = 0;
    } else if (override === "force_open") {
      updates.state = "open";
      updates.opened_at = new Date();
    }

    await this.db("provider_circuit_breaker_state").where({ provider_key: providerKey }).update(updates);

    await auditService.log({
      action: "provider.circuit_breaker_override",
      actorId,
      actorType: "api_key",
      resourceType: "provider",
      resourceId: providerKey,
      metadata: { override },
    });

    logger.warn({ providerKey, override }, "Provider circuit breaker manual override applied");
    return this.getState(providerKey);
  }

  async configureThresholds(
    providerKey: string,
    options: { failureThreshold?: number; recoveryTimeoutMs?: number }
  ): Promise<ProviderBreakerState> {
    await this.ensureState(providerKey);
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (options.failureThreshold !== undefined) updates.failure_threshold = options.failureThreshold;
    if (options.recoveryTimeoutMs !== undefined) updates.recovery_timeout_ms = options.recoveryTimeoutMs;

    await this.db("provider_circuit_breaker_state").where({ provider_key: providerKey }).update(updates);
    return this.getState(providerKey);
  }

  /**
   * Scheduled sweep: flips any open breaker past its recovery timeout into
   * half-open. Returns the provider keys that transitioned so callers can
   * log exactly which providers are recovering.
   */
  async runRecoveryProbeSweep(): Promise<string[]> {
    const openBreakers = await this.db("provider_circuit_breaker_state").where({ state: "open" });
    const probed: string[] = [];

    for (const row of openBreakers) {
      const state = this.mapRow(row);
      if (state.manualOverride === "force_open") continue;

      const openedAt = state.openedAt ? new Date(state.openedAt).getTime() : 0;
      if (Date.now() >= openedAt + state.recoveryTimeoutMs) {
        await this.transition(state.providerKey, "open", "half_open", "scheduled recovery probe sweep");
        probed.push(state.providerKey);
      }
    }

    return probed;
  }

  private async tripOpen(providerKey: string, fromState: BreakerState, reason: string): Promise<void> {
    await this.db("provider_circuit_breaker_state")
      .where({ provider_key: providerKey })
      .update({
        state: "open",
        opened_at: new Date(),
        updated_at: new Date(),
        trip_count: this.db.raw("trip_count + 1"),
      });

    await this.recordTransition(providerKey, fromState, "open", reason);

    await auditService.log({
      action: "provider.circuit_breaker_tripped",
      actorId: "system",
      actorType: "system",
      resourceType: "provider",
      resourceId: providerKey,
      metadata: { reason },
    });

    logger.warn({ providerKey, reason }, "Provider circuit breaker tripped open");
  }

  private async transition(providerKey: string, fromState: BreakerState, toState: BreakerState, reason: string): Promise<void> {
    const updates: Record<string, unknown> = { state: toState, updated_at: new Date() };
    if (toState === "half_open") updates.half_opened_at = new Date();
    if (toState === "closed") updates.opened_at = null;

    await this.db("provider_circuit_breaker_state").where({ provider_key: providerKey }).update(updates);
    await this.recordTransition(providerKey, fromState, toState, reason);

    if (toState === "half_open") {
      logger.info(
        { providerKey, fromState, toState, reason },
        "Provider circuit breaker entering half-open (recovery probe)"
      );
    } else if (toState === "closed") {
      logger.info(
        { providerKey, fromState, toState, reason },
        "Provider circuit breaker closed (recovery succeeded)"
      );
    }
  }

  private async recordTransition(providerKey: string, fromState: BreakerState, toState: BreakerState, reason: string): Promise<void> {
    await this.db("provider_circuit_breaker_transitions").insert({
      provider_key: providerKey,
      from_state: fromState,
      to_state: toState,
      reason,
    });
  }

  private async ensureState(providerKey: string): Promise<Record<string, unknown>> {
    const existing = await this.db("provider_circuit_breaker_state").where({ provider_key: providerKey }).first();
    if (existing) return existing;

    const [row] = await this.db("provider_circuit_breaker_state")
      .insert({
        provider_key: providerKey,
        state: "closed",
        failure_threshold: DEFAULT_FAILURE_THRESHOLD,
        recovery_timeout_ms: DEFAULT_RECOVERY_TIMEOUT_MS,
      })
      .onConflict("provider_key")
      .merge({})
      .returning("*");

    return row;
  }

  private mapRow(row: Record<string, unknown>): ProviderBreakerState {
    return {
      providerKey: String(row.provider_key),
      state: row.state as BreakerState,
      consecutiveFailures: Number(row.consecutive_failures ?? 0),
      failureThreshold: Number(row.failure_threshold ?? DEFAULT_FAILURE_THRESHOLD),
      recoveryTimeoutMs: Number(row.recovery_timeout_ms ?? DEFAULT_RECOVERY_TIMEOUT_MS),
      tripCount: Number(row.trip_count ?? 0),
      fallbackProviderKey: row.fallback_provider_key ? String(row.fallback_provider_key) : null,
      manualOverride: (row.manual_override as ManualOverride) ?? null,
      openedAt: row.opened_at ? new Date(String(row.opened_at)).toISOString() : null,
      halfOpenedAt: row.half_opened_at ? new Date(String(row.half_opened_at)).toISOString() : null,
      lastFailureAt: row.last_failure_at ? new Date(String(row.last_failure_at)).toISOString() : null,
      lastSuccessAt: row.last_success_at ? new Date(String(row.last_success_at)).toISOString() : null,
      updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : new Date().toISOString(),
    };
  }
}

export const providerCircuitBreakerService = new ProviderCircuitBreakerService();
