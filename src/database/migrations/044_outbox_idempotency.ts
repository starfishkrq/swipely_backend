import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Add idempotency_key column to outbox_events
  await knex.schema.alterTable("outbox_events", (table) => {
    table.string("idempotency_key", 255).nullable().after("metadata");
    // Add index for efficient idempotency key lookups
    table.index(["idempotency_key"], "idx_outbox_idempotency_key");
  });

  // Create idempotency_ledger table to track processed keys with TTL
  await knex.schema.createTable("idempotency_ledger", (table) => {
    table.string("idempotency_key", 255).primary();
    table.timestamp("processed_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("expires_at", { useTz: true }).notNullable();
    
    // Index for efficient cleanup of expired entries
    table.index(["expires_at"], "idx_idempotency_expires_at");
  });

  // Create function to check and record idempotency key atomically
  await knex.raw(`
    CREATE OR REPLACE FUNCTION check_and_record_idempotency(
      p_idempotency_key VARCHAR(255),
      p_ttl_hours INTEGER DEFAULT 24
    ) RETURNS BOOLEAN AS $$
    DECLARE
      is_processed BOOLEAN;
      expires_at TIMESTAMPTZ;
    BEGIN
      -- Check if key already exists and not expired
      SELECT EXISTS (
        SELECT 1 FROM idempotency_ledger
        WHERE idempotency_key = p_idempotency_key
        AND expires_at > NOW()
      ) INTO is_processed;

      IF is_processed THEN
        RETURN FALSE; -- Already processed, skip
      END IF;

      -- Record the key with TTL
      expires_at := NOW() + (p_ttl_hours || ' hours')::INTERVAL;
      
      INSERT INTO idempotency_ledger (idempotency_key, processed_at, expires_at)
      VALUES (p_idempotency_key, NOW(), expires_at)
      ON CONFLICT (idempotency_key)
      DO UPDATE SET
        processed_at = NOW(),
        expires_at = expires_at;

      RETURN TRUE; -- Not processed, proceed
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Create function to clean up expired idempotency entries
  await knex.raw(`
    CREATE OR REPLACE FUNCTION cleanup_expired_idempotency_entries()
    RETURNS INTEGER AS $$
    DECLARE
      deleted_count INTEGER;
    BEGIN
      DELETE FROM idempotency_ledger
      WHERE expires_at <= NOW();
      
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
      RETURN deleted_count;
    END;
    $$ LANGUAGE plpgsql;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw("DROP FUNCTION IF EXISTS cleanup_expired_idempotency_entries()");
  await knex.raw("DROP FUNCTION IF EXISTS check_and_record_idempotency(VARCHAR(255), INTEGER)");
  await knex.schema.dropTableIfExists("idempotency_ledger");
  
  // Remove idempotency_key column from outbox_events
  await knex.schema.alterTable("outbox_events", (table) => {
    table.dropColumn("idempotency_key");
  });
}
