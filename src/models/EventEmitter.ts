import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { database } from '../config/database';
import { loggers } from '../utils/logger';
import { EventEnvelope } from '../types';

/**
 * Event emission system for immutable audit trail
 * All events are stored in claim_events table with idempotency handling
 */

export type ActorType = 'system' | 'claimant' | 'reviewer' | 'insurer';

export type EventType =
  | 'claim.intake_received'
  | 'claim.intake_validated'
  | 'claim.intake_failed'
  | 'journey.created'
  | 'notification.sent'
  | 'notification.delivered'
  | 'notification.opened'
  | 'consent.captured'
  | 'photo.uploaded'
  | 'photo.validated'
  | 'photo.rejected'
  | 'photo.set_completed'
  | 'photo.set_insufficient'
  | 'vin.enrichment_started'
  | 'vin.enrichment_completed'
  | 'vin.enrichment_failed'
  | 'damage.analysis_started'
  | 'damage.analysis_completed'
  | 'damage.analysis_failed'
  | 'decision.manual_review_triggered'
  | 'decision.generated'
  | 'decision.overridden'
  | 'result.delivered'
  | 'claim.abandoned';

export interface EmitEventParams {
  eventType: EventType;
  claimId: string;
  sourceService: string;
  actorType: ActorType;
  actorId?: string;
  correlationId?: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
}

export class EventEmitter {
  /**
   * Generate idempotency key from event parameters
   * Ensures duplicate events are not stored
   */
  private static generateIdempotencyKey(
    eventType: string,
    claimId: string,
    timestamp: Date,
    additionalData?: string
  ): string {
    const data = `${eventType}:${claimId}:${timestamp.toISOString()}:${additionalData || ''}`;
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Emit an event to the immutable event log
   * Returns the event ID if successful, null if duplicate (idempotency)
   */
  static async emit(params: EmitEventParams): Promise<string | null> {
    const {
      eventType,
      claimId,
      sourceService,
      actorType,
      actorId,
      correlationId,
      payload = {},
      idempotencyKey,
    } = params;

    const eventId = uuidv4();
    const timestamp = new Date();
    const finalIdempotencyKey =
      idempotencyKey ||
      this.generateIdempotencyKey(
        eventType,
        claimId,
        timestamp,
        JSON.stringify(payload)
      );

    try {
      const result = await database.query(
        `
        INSERT INTO claim_events (
          event_id,
          event_type,
          claim_id,
          timestamp,
          source_service,
          actor_type,
          actor_id,
          correlation_id,
          idempotency_key,
          payload
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING event_id
      `,
        [
          eventId,
          eventType,
          claimId,
          timestamp,
          sourceService,
          actorType,
          actorId || null,
          correlationId || null,
          finalIdempotencyKey,
          JSON.stringify(payload),
        ]
      );

      if (result.rowCount === 0) {
        loggers.app.debug('Duplicate event detected (idempotency)', {
          eventType,
          claimId,
          idempotencyKey: finalIdempotencyKey,
        });
        return null;
      }

      loggers.app.info('Event emitted', {
        eventId,
        eventType,
        claimId,
        actorType,
      });

      return eventId;
    } catch (error) {
      loggers.app.error('Failed to emit event', error as Error, {
        eventType,
        claimId,
      });
      throw error;
    }
  }

  /**
   * Retrieve all events for a claim in chronological order
   */
  static async getClaimEvents(claimId: string): Promise<EventEnvelope[]> {
    try {
      const result = await database.query(
        `
        SELECT 
          id,
          event_id,
          event_type,
          claim_id,
          timestamp,
          source_service,
          actor_type,
          actor_id,
          correlation_id,
          idempotency_key,
          payload
        FROM claim_events
        WHERE claim_id = $1
        ORDER BY timestamp ASC, id ASC
      `,
        [claimId]
      );

      return result.rows.map((row: any) => ({
        id: row.id,
        eventId: row.event_id,
        eventType: row.event_type,
        claimId: row.claim_id,
        timestamp: row.timestamp,
        sourceService: row.source_service,
        actorType: row.actor_type,
        actorId: row.actor_id,
        correlationId: row.correlation_id,
        idempotencyKey: row.idempotency_key,
        payload: row.payload,
      }));
    } catch (error) {
      loggers.app.error('Failed to retrieve claim events', error as Error, {
        claimId,
      });
      throw error;
    }
  }

  /**
   * Retrieve events by type
   */
  static async getEventsByType(
    eventType: EventType,
    limit: number = 100
  ): Promise<EventEnvelope[]> {
    try {
      const result = await database.query(
        `
        SELECT 
          id,
          event_id,
          event_type,
          claim_id,
          timestamp,
          source_service,
          actor_type,
          actor_id,
          correlation_id,
          idempotency_key,
          payload
        FROM claim_events
        WHERE event_type = $1
        ORDER BY timestamp DESC
        LIMIT $2
      `,
        [eventType, limit]
      );

      return result.rows.map((row: any) => ({
        id: row.id,
        eventId: row.event_id,
        eventType: row.event_type,
        claimId: row.claim_id,
        timestamp: row.timestamp,
        sourceService: row.source_service,
        actorType: row.actor_type,
        actorId: row.actor_id,
        correlationId: row.correlation_id,
        idempotencyKey: row.idempotency_key,
        payload: row.payload,
      }));
    } catch (error) {
      loggers.app.error('Failed to retrieve events by type', error as Error, {
        eventType,
      });
      throw error;
    }
  }

  /**
   * Retrieve events by correlation ID
   * Useful for tracking related events across services
   */
  static async getEventsByCorrelation(
    correlationId: string
  ): Promise<EventEnvelope[]> {
    try {
      const result = await database.query(
        `
        SELECT 
          id,
          event_id,
          event_type,
          claim_id,
          timestamp,
          source_service,
          actor_type,
          actor_id,
          correlation_id,
          idempotency_key,
          payload
        FROM claim_events
        WHERE correlation_id = $1
        ORDER BY timestamp ASC
      `,
        [correlationId]
      );

      return result.rows.map((row: any) => ({
        id: row.id,
        eventId: row.event_id,
        eventType: row.event_type,
        claimId: row.claim_id,
        timestamp: row.timestamp,
        sourceService: row.source_service,
        actorType: row.actor_type,
        actorId: row.actor_id,
        correlationId: row.correlation_id,
        idempotencyKey: row.idempotency_key,
        payload: row.payload,
      }));
    } catch (error) {
      loggers.app.error(
        'Failed to retrieve events by correlation',
        error as Error,
        { correlationId }
      );
      throw error;
    }
  }

  /**
   * Get audit trail for sensitive data access
   * Logs all reads and writes to sensitive claim data
   */
  static async logSensitiveDataAccess(params: {
    claimId: string;
    actorType: ActorType;
    actorId: string;
    action: 'read' | 'write' | 'delete';
    resource: string;
    details?: Record<string, unknown>;
  }): Promise<void> {
    const { claimId, actorType, actorId, action, resource, details } = params;

    // Log to audit trail (using app logger for PII-safe logging)
    loggers.app.info('Sensitive data access', {
      claimId,
      actorType,
      actorId,
      action,
      resource,
      timestamp: new Date().toISOString(),
    });

    // Also emit as event for immutable audit trail
    await this.emit({
      eventType: 'claim.intake_received', // Using a generic event type for audit
      claimId,
      sourceService: 'audit-trail',
      actorType,
      actorId,
      payload: {
        auditAction: action,
        resource,
        details: details || {},
      },
    });
  }
}
