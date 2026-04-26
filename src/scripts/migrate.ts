import { database } from '../config/database';
import { loggers } from '../utils/logger';

/**
 * Database migration script for Glass Claim Assessment System
 * Creates all 6 required tables with proper indexes
 */

async function runMigration(): Promise<void> {
  try {
    loggers.app.info('Starting database migration...');

    // Create claim_inspections table
    await database.query(`
      CREATE TABLE IF NOT EXISTS claim_inspections (
        id                    SERIAL PRIMARY KEY,
        customer_id           VARCHAR(100),
        claim_number          VARCHAR(100) NOT NULL,
        insurer_id            VARCHAR(100) NOT NULL,
        external_status       VARCHAR(50)  NOT NULL,
        internal_status       VARCHAR(50)  NOT NULL,
        policyholder_name     VARCHAR(255) NOT NULL,
        policyholder_mobile   VARCHAR(50)  NOT NULL,
        policyholder_email    VARCHAR(255),
        insurer_provided_vin  VARCHAR(17),
        intake_message_id     VARCHAR(255) UNIQUE NOT NULL,
        received_at           TIMESTAMPTZ  NOT NULL,
        consent_captured      BOOLEAN      NOT NULL DEFAULT FALSE,
        decision_eligibility  BOOLEAN,
        assessment_outcome    VARCHAR(50),
        final_decision        VARCHAR(50),
        rules_version         VARCHAR(50),
        output_schema_version VARCHAR(50),
        created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        inspection_data       JSONB        NOT NULL DEFAULT '{}'
      )
    `);
    loggers.app.info('Created table: claim_inspections');

    // Create indexes for claim_inspections
    await database.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ci_claim_number_insurer 
      ON claim_inspections (claim_number, insurer_id)
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_ci_insurer_id 
      ON claim_inspections (insurer_id)
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_ci_internal_status 
      ON claim_inspections (internal_status)
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_ci_created_at 
      ON claim_inspections (created_at)
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_ci_inspection_data 
      ON claim_inspections USING GIN (inspection_data)
    `);
    loggers.app.info('Created indexes for claim_inspections');

    // Create claim_events table
    await database.query(`
      CREATE TABLE IF NOT EXISTS claim_events (
        id               BIGSERIAL    PRIMARY KEY,
        event_id         UUID         NOT NULL UNIQUE DEFAULT gen_random_uuid(),
        event_type       VARCHAR(100) NOT NULL,
        claim_id         VARCHAR(36)  NOT NULL,
        timestamp        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        source_service   VARCHAR(100) NOT NULL,
        actor_type       VARCHAR(50)  NOT NULL,
        actor_id         VARCHAR(100),
        correlation_id   VARCHAR(36),
        idempotency_key  VARCHAR(255) NOT NULL UNIQUE,
        payload          JSONB        NOT NULL DEFAULT '{}'
      )
    `);
    loggers.app.info('Created table: claim_events');

    // Create indexes for claim_events
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_ce_claim_id 
      ON claim_events (claim_id)
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_ce_event_type 
      ON claim_events (event_type)
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_ce_timestamp 
      ON claim_events (timestamp)
    `);
    loggers.app.info('Created indexes for claim_events');

    // Create journeys table
    await database.query(`
      CREATE TABLE IF NOT EXISTS journeys (
        id                    SERIAL       PRIMARY KEY,
        journey_id            UUID         NOT NULL UNIQUE DEFAULT gen_random_uuid(),
        claim_id              VARCHAR(36)  NOT NULL,
        channel               VARCHAR(20)  NOT NULL,
        token_jti             VARCHAR(255) NOT NULL UNIQUE,
        expires_at            TIMESTAMPTZ  NOT NULL,
        revoked               BOOLEAN      NOT NULL DEFAULT FALSE,
        consent_captured      BOOLEAN      NOT NULL DEFAULT FALSE,
        consent_captured_at   TIMESTAMPTZ,
        consent_version       VARCHAR(50),
        legal_notice_version  VARCHAR(50),
        session_metadata      JSONB        NOT NULL DEFAULT '{}',
        created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    loggers.app.info('Created table: journeys');

    // Create indexes for journeys
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_j_claim_id 
      ON journeys (claim_id)
    `);
    loggers.app.info('Created indexes for journeys');

    // Create uploaded_photos table
    await database.query(`
      CREATE TABLE IF NOT EXISTS uploaded_photos (
        id                  SERIAL       PRIMARY KEY,
        photo_id            UUID         NOT NULL UNIQUE DEFAULT gen_random_uuid(),
        claim_id            VARCHAR(36)  NOT NULL,
        journey_id          UUID         NOT NULL,
        slot                VARCHAR(50)  NOT NULL,
        storage_key         VARCHAR(500) NOT NULL,
        mime_type           VARCHAR(100) NOT NULL,
        file_size_bytes     INTEGER      NOT NULL,
        uploaded_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        validation_outcome  VARCHAR(50)  NOT NULL,
        validation_details  JSONB        NOT NULL DEFAULT '{}'
      )
    `);
    loggers.app.info('Created table: uploaded_photos');

    // Create indexes for uploaded_photos
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_up_claim_id 
      ON uploaded_photos (claim_id)
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_up_slot 
      ON uploaded_photos (claim_id, slot)
    `);
    loggers.app.info('Created indexes for uploaded_photos');

    // Create manual_reviews table
    await database.query(`
      CREATE TABLE IF NOT EXISTS manual_reviews (
        id                          SERIAL       PRIMARY KEY,
        review_id                   UUID         NOT NULL UNIQUE DEFAULT gen_random_uuid(),
        claim_id                    VARCHAR(36)  NOT NULL,
        trigger_reasons             TEXT[]       NOT NULL,
        machine_assessment_snapshot JSONB        NOT NULL,
        queued_at                   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        review_started_at           TIMESTAMPTZ,
        review_completed_at         TIMESTAMPTZ,
        reviewer_id                 VARCHAR(100),
        reviewer_action             VARCHAR(50),
        final_reviewed_outcome      VARCHAR(50),
        override_flag               BOOLEAN      NOT NULL DEFAULT FALSE,
        override_reason_code        VARCHAR(100),
        reviewer_notes              TEXT,
        manual_trigger_reason       VARCHAR(100),
        trigger_source              VARCHAR(20)  NOT NULL DEFAULT 'automatic'
      )
    `);
    loggers.app.info('Created table: manual_reviews');

    // Create indexes for manual_reviews
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_mr_claim_id 
      ON manual_reviews (claim_id)
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_mr_queued_at 
      ON manual_reviews (queued_at)
    `);
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_mr_trigger_source 
      ON manual_reviews (trigger_source)
    `);
    loggers.app.info('Created indexes for manual_reviews');

    // Create notification_deliveries table
    await database.query(`
      CREATE TABLE IF NOT EXISTS notification_deliveries (
        id                  SERIAL       PRIMARY KEY,
        claim_id            VARCHAR(36)  NOT NULL,
        channel             VARCHAR(20)  NOT NULL,
        provider_message_id VARCHAR(255),
        sent_at             TIMESTAMPTZ,
        delivered_at        TIMESTAMPTZ,
        opened_at           TIMESTAMPTZ,
        status              VARCHAR(50)  NOT NULL,
        error_details       JSONB
      )
    `);
    loggers.app.info('Created table: notification_deliveries');

    // Create indexes for notification_deliveries
    await database.query(`
      CREATE INDEX IF NOT EXISTS idx_nd_claim_id 
      ON notification_deliveries (claim_id)
    `);
    loggers.app.info('Created indexes for notification_deliveries');

    loggers.app.info('Database migration completed successfully');
  } catch (error) {
    loggers.app.error('Database migration failed', error as Error);
    throw error;
  }
}

// Run migration if executed directly
if (require.main === module) {
  runMigration()
    .then(() => {
      loggers.app.info('Migration script finished');
      process.exit(0);
    })
    .catch((error) => {
      loggers.app.error('Migration script failed', error);
      process.exit(1);
    });
}

export { runMigration };
