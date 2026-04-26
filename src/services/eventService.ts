import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { database } from '../config/database';
import { loggers } from '../utils/logger';
import { EventEnvelope } from '../types';

/**
 * Event Service for Glass Claim Assessment System
 * Provides immutable event logging and audit trail functionality
 * 
 * All events are stored in the claim_events table with:
 * - Idempotency handling to prevent duplicate events
 * - Event correlation for tracking related events
 * - Audit logging for sensitive data access
 */

export type ActorType = 'system' | 'claimant' | 'reviewer' | 'insurer';

/**
 * All lifecycle event types as specified in design.md
 */
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

/**
 * Event type constants for easy reference
 */
export const EVENT_TYPES = {
  // Intake events
  INTAKE_RECEIVED: 'claim.intake_received' as const,
  INTAKE_VALIDATED: 'claim.intake_validated' as const,
  INTAKE_FAILED: 'claim.intake_failed' as const,
  
  // Journey events
  JOURNEY_CREATED: 'journey.created' as const,
  
  // Notification events
  NOTIFICATION_SENT: 'notification.sent' as const,
  NOTIFICATION_DELIVERED: 'notification.delivered' as const,
  NOTIFICATION_OPENED: 'notification.opened' as const,
  
  // Consent events
  CONSENT_CAPTURED: 'consent.captured' as const,
  
  // Photo events
  PHOTO_UPLOADED: 'photo.uploaded' as const,
  PHOTO_VALIDATED: 'photo.validated' as const,
  PHOTO_REJECTED: 'photo.rejected' as const,
  PHOTO_SET_COMPLETED: 'photo.set_completed' as const,
  PHOTO_SET_INSUFFICIENT: 'photo.set_insufficient' as const,
  
  // VIN enrichment events
  VIN_ENRICHMENT_STARTED: 'vin.enrichment_started' as const,
  VIN_ENRICHMENT_COMPLETED: 'vin.enrichment_completed' as const,
  VIN_ENRICHMENT_FAILED: 'vin.enrichment_failed' as const,
  
  // Damage analysis events
  DAMAGE_ANALYSIS_STARTED: 'damage.analysis_started' as const,
  DAMAGE_ANALYSIS_COMPLETED: 'damage.analysis_completed' as const,
  DAMAGE_ANALYSIS_FAILED: 'damage.analysis_failed' as const,
  
  // Decision events
  DECISION_MANUAL_REVIEW_TRIGGERED: 'decision.manual_review_triggered' as const,
  DECISION_GENERATED: 'decision.generated' as const,
  DECISION_OVERRIDDEN: 'decision.overridden' as const,
  
  // Result events
  RESULT_DELIVERED: 'result.delivered' as const,
  
  // Claim lifecycle events
  CLAIM_ABANDONED: 'claim.abandoned' as const,
} as const;

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

export interface SensitiveDataAccessParams {
  claimId: string;
  actorType: ActorType;
  actorId: string;
  action: 'read' | 'write' | 'delete';
  resource: string;
  details?: Record<string, unknown>;
}

/**
 * Event Service class
 * Handles all event emission and retrieval operations
 */
export class EventService {
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
   * 
   * @param params - Event parameters
   * @returns Event ID if successful, null if duplicate (idempotency)
   * 
   * Events are immutable once stored. Duplicate events (same idempotency key)
   * are silently ignored and return null.
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
   * 
   * @param claimId - Claim identifier
   * @returns Array of events ordered by timestamp
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
   * 
   * @param eventType - Type of event to retrieve
   * @param limit - Maximum number of events to return (default: 100)
   * @returns Array of events ordered by timestamp (most recent first)
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
   * 
   * @param correlationId - Correlation identifier
   * @returns Array of correlated events ordered by timestamp
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
   * Log sensitive data access for audit trail
   * 
   * Records all reads, writes, and deletes of sensitive claim data.
   * Logs are PII-safe and stored in both the application log and event store.
   * 
   * @param params - Sensitive data access parameters
   */
  static async logSensitiveDataAccess(
    params: SensitiveDataAccessParams
  ): Promise<void> {
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
    // Using a dedicated audit event type
    await this.emit({
      eventType: EVENT_TYPES.INTAKE_RECEIVED, // Placeholder - could add dedicated audit event type
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

  /**
   * Check if an event with the given idempotency key already exists
   * 
   * @param idempotencyKey - Idempotency key to check
   * @returns True if event exists, false otherwise
   */
  static async eventExists(idempotencyKey: string): Promise<boolean> {
    try {
      const result = await database.query(
        `
        SELECT 1 FROM claim_events WHERE idempotency_key = $1 LIMIT 1
      `,
        [idempotencyKey]
      );

      return result.rowCount > 0;
    } catch (error) {
      loggers.app.error('Failed to check event existence', error as Error, {
        idempotencyKey,
      });
      throw error;
    }
  }

  /**
   * Get the latest event for a claim
   * 
   * @param claimId - Claim identifier
   * @returns Latest event or null if no events exist
   */
  static async getLatestEvent(claimId: string): Promise<EventEnvelope | null> {
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
        ORDER BY timestamp DESC, id DESC
        LIMIT 1
      `,
        [claimId]
      );

      if (result.rowCount === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
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
      };
    } catch (error) {
      loggers.app.error('Failed to retrieve latest event', error as Error, {
        claimId,
      });
      throw error;
    }
  }
}

// Export singleton instance for convenience
export const eventService = EventService;
