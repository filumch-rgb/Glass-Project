import { EventService, EVENT_TYPES, ActorType } from './eventService';
import { database } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

/**
 * Unit tests for Event Service
 * Tests event emission, idempotency, retrieval, and audit logging
 */

describe('EventService', () => {
  const testClaimId = uuidv4();
  const testCorrelationId = uuidv4();

  beforeAll(async () => {
    // Ensure database connection is established
    await database.testConnection();
  });

  afterAll(async () => {
    // Clean up test data
    await database.query('DELETE FROM claim_events WHERE claim_id = $1', [testClaimId]);
    await database.close();
  });

  describe('emit', () => {
    it('should emit an event successfully', async () => {
      const eventId = await EventService.emit({
        eventType: EVENT_TYPES.INTAKE_RECEIVED,
        claimId: testClaimId,
        sourceService: 'test-service',
        actorType: 'system',
        payload: { test: 'data' },
      });

      expect(eventId).toBeTruthy();
      expect(typeof eventId).toBe('string');
    });

    it('should handle idempotency - duplicate events return null', async () => {
      const idempotencyKey = `test-idempotency-${Date.now()}`;

      // First emission should succeed
      const eventId1 = await EventService.emit({
        eventType: EVENT_TYPES.INTAKE_VALIDATED,
        claimId: testClaimId,
        sourceService: 'test-service',
        actorType: 'system',
        idempotencyKey,
      });

      expect(eventId1).toBeTruthy();

      // Second emission with same idempotency key should return null
      const eventId2 = await EventService.emit({
        eventType: EVENT_TYPES.INTAKE_VALIDATED,
        claimId: testClaimId,
        sourceService: 'test-service',
        actorType: 'system',
        idempotencyKey,
      });

      expect(eventId2).toBeNull();
    });

    it('should emit event with correlation ID', async () => {
      const eventId = await EventService.emit({
        eventType: EVENT_TYPES.JOURNEY_CREATED,
        claimId: testClaimId,
        sourceService: 'journey-service',
        actorType: 'system',
        correlationId: testCorrelationId,
        payload: { journeyId: uuidv4() },
      });

      expect(eventId).toBeTruthy();
    });

    it('should emit event with actor information', async () => {
      const eventId = await EventService.emit({
        eventType: EVENT_TYPES.CONSENT_CAPTURED,
        claimId: testClaimId,
        sourceService: 'consent-service',
        actorType: 'claimant',
        actorId: 'claimant-123',
        payload: { consentVersion: '1.0' },
      });

      expect(eventId).toBeTruthy();
    });
  });

  describe('getClaimEvents', () => {
    it('should retrieve all events for a claim in chronological order', async () => {
      const events = await EventService.getClaimEvents(testClaimId);

      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBeGreaterThan(0);

      // Verify chronological order
      for (let i = 1; i < events.length; i++) {
        const prevEvent = events[i - 1];
        const currEvent = events[i];
        if (prevEvent && currEvent) {
          const prevTimestamp = new Date(prevEvent.timestamp).getTime();
          const currTimestamp = new Date(currEvent.timestamp).getTime();
          expect(currTimestamp).toBeGreaterThanOrEqual(prevTimestamp);
        }
      }
    });

    it('should return empty array for non-existent claim', async () => {
      const events = await EventService.getClaimEvents('non-existent-claim-id');
      expect(events).toEqual([]);
    });
  });

  describe('getEventsByType', () => {
    it('should retrieve events by type', async () => {
      const events = await EventService.getEventsByType(EVENT_TYPES.INTAKE_RECEIVED, 10);

      expect(Array.isArray(events)).toBe(true);
      events.forEach(event => {
        expect(event.eventType).toBe(EVENT_TYPES.INTAKE_RECEIVED);
      });
    });

    it('should respect limit parameter', async () => {
      const events = await EventService.getEventsByType(EVENT_TYPES.INTAKE_RECEIVED, 2);

      expect(events.length).toBeLessThanOrEqual(2);
    });
  });

  describe('getEventsByCorrelation', () => {
    it('should retrieve events by correlation ID', async () => {
      const events = await EventService.getEventsByCorrelation(testCorrelationId);

      expect(Array.isArray(events)).toBe(true);
      events.forEach(event => {
        expect(event.correlationId).toBe(testCorrelationId);
      });
    });
  });

  describe('eventExists', () => {
    it('should return true for existing idempotency key', async () => {
      const idempotencyKey = `test-exists-${Date.now()}`;

      await EventService.emit({
        eventType: EVENT_TYPES.PHOTO_UPLOADED,
        claimId: testClaimId,
        sourceService: 'photo-service',
        actorType: 'claimant',
        idempotencyKey,
      });

      const exists = await EventService.eventExists(idempotencyKey);
      expect(exists).toBe(true);
    });

    it('should return false for non-existent idempotency key', async () => {
      const exists = await EventService.eventExists('non-existent-key');
      expect(exists).toBe(false);
    });
  });

  describe('getLatestEvent', () => {
    it('should retrieve the latest event for a claim', async () => {
      const latestEvent = await EventService.getLatestEvent(testClaimId);

      expect(latestEvent).toBeTruthy();
      expect(latestEvent?.claimId).toBe(testClaimId);
    });

    it('should return null for claim with no events', async () => {
      const latestEvent = await EventService.getLatestEvent('no-events-claim-id');
      expect(latestEvent).toBeNull();
    });
  });

  describe('logSensitiveDataAccess', () => {
    it('should log sensitive data access', async () => {
      await expect(
        EventService.logSensitiveDataAccess({
          claimId: testClaimId,
          actorType: 'reviewer',
          actorId: 'reviewer-456',
          action: 'read',
          resource: 'policyholder_data',
          details: { field: 'policyholder_mobile' },
        })
      ).resolves.not.toThrow();
    });
  });

  describe('Event Type Constants', () => {
    it('should have all required event types defined', () => {
      const requiredEventTypes = [
        'INTAKE_RECEIVED',
        'INTAKE_VALIDATED',
        'INTAKE_FAILED',
        'JOURNEY_CREATED',
        'NOTIFICATION_SENT',
        'NOTIFICATION_DELIVERED',
        'NOTIFICATION_OPENED',
        'CONSENT_CAPTURED',
        'PHOTO_UPLOADED',
        'PHOTO_VALIDATED',
        'PHOTO_REJECTED',
        'PHOTO_SET_COMPLETED',
        'PHOTO_SET_INSUFFICIENT',
        'VIN_ENRICHMENT_STARTED',
        'VIN_ENRICHMENT_COMPLETED',
        'VIN_ENRICHMENT_FAILED',
        'DAMAGE_ANALYSIS_STARTED',
        'DAMAGE_ANALYSIS_COMPLETED',
        'DAMAGE_ANALYSIS_FAILED',
        'DECISION_MANUAL_REVIEW_TRIGGERED',
        'DECISION_GENERATED',
        'DECISION_OVERRIDDEN',
        'RESULT_DELIVERED',
        'CLAIM_ABANDONED',
      ];

      requiredEventTypes.forEach(eventType => {
        expect(EVENT_TYPES).toHaveProperty(eventType);
        expect(typeof EVENT_TYPES[eventType as keyof typeof EVENT_TYPES]).toBe('string');
      });
    });
  });
});
