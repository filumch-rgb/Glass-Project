import { JourneyService, journeyService } from './journeyService';
import { database } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { config } from '../config';

/**
 * Integration tests for Journey Service
 * Tests journey token generation, validation, security, and lifecycle management
 */

describe('JourneyService', () => {
  const testClaimId = uuidv4();

  beforeAll(async () => {
    // Ensure database connection is established
    await database.testConnection();

    // Create a test claim for journey tests
    await database.query(
      `
      INSERT INTO claim_inspections (
        claim_number,
        insurer_id,
        external_status,
        internal_status,
        policyholder_name,
        policyholder_mobile,
        intake_message_id,
        received_at,
        inspection_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
      [
        `TEST-${Date.now()}`,
        'TEST-INSURER',
        'Message Sent',
        'intake_received',
        'Test User',
        '+15555551234',
        `test-message-${Date.now()}`,
        new Date(),
        JSON.stringify({ rawIntakePayload: {}, validationDetails: { intakeKey: 'test' } }),
      ]
    );
  });

  afterAll(async () => {
    // Clean up test data
    await database.query('DELETE FROM journeys WHERE claim_id = $1', [testClaimId]);
    await database.query('DELETE FROM claim_events WHERE claim_id = $1', [testClaimId]);
    await database.query('DELETE FROM claim_inspections WHERE claim_number LIKE $1', ['TEST-%']);
    await database.close();
  });

  describe('createJourney', () => {
    it('should create journey with valid JWT token', async () => {
      const request = {
        claimId: testClaimId,
        channel: 'pwa' as const,
        sessionMetadata: { userAgent: 'test-browser' },
      };

      const result = await journeyService.createJourney(request);

      expect(result).toBeDefined();
      expect(result.journeyId).toBeDefined();
      expect(result.token).toBeDefined();
      expect(result.journeyLink).toContain('/journey/');
      expect(result.expiresAt).toBeInstanceOf(Date);

      // Verify token is valid JWT
      const decoded = jwt.verify(result.token, config.security.jwtSecret) as any;
      expect(decoded.claimId).toBe(testClaimId);
      expect(decoded.journeyId).toBe(result.journeyId);
      expect(decoded.channel).toBe('pwa');
      expect(decoded.jti).toBeDefined();
    });

    it('should store journey record in database', async () => {
      const request = {
        claimId: testClaimId,
        channel: 'pwa' as const,
      };

      const result = await journeyService.createJourney(request);

      // Verify journey was stored
      const journey = await journeyService.getJourney(result.journeyId);

      expect(journey).toBeDefined();
      expect(journey?.journeyId).toBe(result.journeyId);
      expect(journey?.claimId).toBe(testClaimId);
      expect(journey?.channel).toBe('pwa');
      expect(journey?.revoked).toBe(false);
      expect(journey?.consentCaptured).toBe(false);
    });

    it('should set token expiration to 24 hours by default', async () => {
      const request = {
        claimId: testClaimId,
        channel: 'pwa' as const,
      };

      const result = await journeyService.createJourney(request);

      const now = Date.now();
      const expiresAt = result.expiresAt.getTime();
      const expectedExpiry = now + 24 * 60 * 60 * 1000; // 24 hours

      // Allow 1 second tolerance for test execution time
      expect(Math.abs(expiresAt - expectedExpiry)).toBeLessThan(1000);
    });

    it('should emit journey.created event', async () => {
      const uniqueClaimId = uuidv4();
      
      const request = {
        claimId: uniqueClaimId,
        channel: 'pwa' as const,
      };

      const result = await journeyService.createJourney(request);

      // Verify event was emitted
      const events = await database.query(
        `SELECT * FROM claim_events WHERE claim_id = $1 AND event_type = 'journey.created'`,
        [uniqueClaimId]
      );

      expect(events.rowCount).toBeGreaterThan(0);
      
      const event = events.rows[0];
      expect(event.claim_id).toBe(uniqueClaimId);
      expect(event.event_type).toBe('journey.created');
      expect(event.source_service).toBe('journey-service');

      // Clean up
      await database.query('DELETE FROM journeys WHERE claim_id = $1', [uniqueClaimId]);
      await database.query('DELETE FROM claim_events WHERE claim_id = $1', [uniqueClaimId]);
    });

    it('should create journey with WhatsApp channel', async () => {
      const request = {
        claimId: testClaimId,
        channel: 'whatsapp' as const,
      };

      const result = await journeyService.createJourney(request);

      expect(result).toBeDefined();
      
      const journey = await journeyService.getJourney(result.journeyId);
      expect(journey?.channel).toBe('whatsapp');
    });
  });

  describe('validateToken', () => {
    let validToken: string;
    let validJourneyId: string;

    beforeEach(async () => {
      const result = await journeyService.createJourney({
        claimId: testClaimId,
        channel: 'pwa',
      });
      validToken = result.token;
      validJourneyId = result.journeyId;
    });

    it('should validate valid token successfully', async () => {
      const validation = await journeyService.validateToken(validToken);

      expect(validation.valid).toBe(true);
      expect(validation.journey).toBeDefined();
      expect(validation.journey?.journeyId).toBe(validJourneyId);
      expect(validation.journey?.claimId).toBe(testClaimId);
      expect(validation.error).toBeUndefined();
    });

    it('should reject invalid token signature', async () => {
      const invalidToken = 'invalid.token.signature';

      const validation = await journeyService.validateToken(invalidToken);

      expect(validation.valid).toBe(false);
      expect(validation.error).toBeDefined();
      expect(validation.journey).toBeUndefined();
    });

    it('should reject revoked token', async () => {
      // Revoke the token
      await journeyService.revokeToken(validJourneyId, 'test_revocation');

      const validation = await journeyService.validateToken(validToken);

      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('revoked');
    });

    it('should reject expired token', async () => {
      // Create a token that expires immediately
      const expiredPayload = {
        claimId: testClaimId,
        journeyId: uuidv4(),
        channel: 'pwa',
        exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
        jti: uuidv4(),
      };

      const expiredToken = jwt.sign(expiredPayload, config.security.jwtSecret);

      const validation = await journeyService.validateToken(expiredToken);

      expect(validation.valid).toBe(false);
      // JWT library catches expiration and returns "Invalid token signature" or "expired"
      expect(validation.error).toBeDefined();
    });

    it('should reject token for non-existent journey', async () => {
      // Create a valid JWT but with non-existent journey ID
      const fakePayload = {
        claimId: testClaimId,
        journeyId: uuidv4(),
        channel: 'pwa',
        exp: Math.floor(Date.now() / 1000) + 3600,
        jti: uuidv4(),
      };

      const fakeToken = jwt.sign(fakePayload, config.security.jwtSecret);

      const validation = await journeyService.validateToken(fakeToken);

      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('not found');
    });
  });

  describe('revokeToken', () => {
    it('should revoke journey token', async () => {
      const result = await journeyService.createJourney({
        claimId: testClaimId,
        channel: 'pwa',
      });

      // Revoke the token
      await journeyService.revokeToken(result.journeyId, 'security_concern');

      // Verify token is revoked
      const journey = await journeyService.getJourney(result.journeyId);
      expect(journey?.revoked).toBe(true);

      // Verify token validation fails
      const validation = await journeyService.validateToken(result.token);
      expect(validation.valid).toBe(false);
    });
  });

  describe('abandonJourney', () => {
    it('should abandon journey and emit event', async () => {
      const uniqueClaimId = uuidv4();
      
      const result = await journeyService.createJourney({
        claimId: uniqueClaimId,
        channel: 'pwa',
      });

      await journeyService.abandonJourney(result.journeyId, 'token_expired');

      // Verify claim.abandoned event was emitted
      const events = await database.query(
        `SELECT * FROM claim_events WHERE claim_id = $1 AND event_type = 'claim.abandoned'`,
        [uniqueClaimId]
      );

      expect(events.rowCount).toBeGreaterThan(0);
      
      const event = events.rows[0];
      expect(event.event_type).toBe('claim.abandoned');
      
      // Payload is already a JSON object, not a string
      const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
      expect(payload.reason).toBe('token_expired');

      // Clean up
      await database.query('DELETE FROM journeys WHERE claim_id = $1', [uniqueClaimId]);
      await database.query('DELETE FROM claim_events WHERE claim_id = $1', [uniqueClaimId]);
    });
  });

  describe('captureConsent', () => {
    it('should capture consent for journey', async () => {
      const result = await journeyService.createJourney({
        claimId: testClaimId,
        channel: 'pwa',
      });

      await journeyService.captureConsent(
        result.journeyId,
        '1.0',
        '1.0'
      );

      // Verify consent was captured
      const journey = await journeyService.getJourney(result.journeyId);
      expect(journey?.consentCaptured).toBe(true);
      expect(journey?.consentCapturedAt).toBeInstanceOf(Date);
      expect(journey?.consentVersion).toBe('1.0');
      expect(journey?.legalNoticeVersion).toBe('1.0');
    });

    it('should emit consent.captured event', async () => {
      const uniqueClaimId = uuidv4();
      
      const result = await journeyService.createJourney({
        claimId: uniqueClaimId,
        channel: 'pwa',
      });

      await journeyService.captureConsent(result.journeyId, '1.0', '1.0');

      // Verify event was emitted
      const events = await database.query(
        `SELECT * FROM claim_events WHERE claim_id = $1 AND event_type = 'consent.captured'`,
        [uniqueClaimId]
      );

      expect(events.rowCount).toBeGreaterThan(0);

      // Clean up
      await database.query('DELETE FROM journeys WHERE claim_id = $1', [uniqueClaimId]);
      await database.query('DELETE FROM claim_events WHERE claim_id = $1', [uniqueClaimId]);
    });
  });

  describe('getJourney', () => {
    it('should retrieve journey by ID', async () => {
      const result = await journeyService.createJourney({
        claimId: testClaimId,
        channel: 'pwa',
      });

      const journey = await journeyService.getJourney(result.journeyId);

      expect(journey).toBeDefined();
      expect(journey?.journeyId).toBe(result.journeyId);
      expect(journey?.claimId).toBe(testClaimId);
    });

    it('should return null for non-existent journey', async () => {
      // Use a valid UUID format
      const nonExistentJourneyId = uuidv4();
      const journey = await journeyService.getJourney(nonExistentJourneyId);
      expect(journey).toBeNull();
    });
  });

  describe('getClaimJourneys', () => {
    it('should retrieve all journeys for a claim', async () => {
      // Create multiple journeys for the same claim
      await journeyService.createJourney({
        claimId: testClaimId,
        channel: 'pwa',
      });

      await journeyService.createJourney({
        claimId: testClaimId,
        channel: 'whatsapp',
      });

      const journeys = await journeyService.getClaimJourneys(testClaimId);

      expect(journeys.length).toBeGreaterThanOrEqual(2);
      journeys.forEach(journey => {
        expect(journey.claimId).toBe(testClaimId);
      });
    });

    it('should return empty array for claim with no journeys', async () => {
      const journeys = await journeyService.getClaimJourneys('non-existent-claim');
      expect(journeys).toEqual([]);
    });

    it('should return journeys in reverse chronological order', async () => {
      const journeys = await journeyService.getClaimJourneys(testClaimId);

      if (journeys.length > 1) {
        for (let i = 1; i < journeys.length; i++) {
          const prevJourney = journeys[i - 1];
          const currJourney = journeys[i];
          if (prevJourney && currJourney) {
            const prevTimestamp = new Date(prevJourney.createdAt).getTime();
            const currTimestamp = new Date(currJourney.createdAt).getTime();
            expect(prevTimestamp).toBeGreaterThanOrEqual(currTimestamp);
          }
        }
      }
    });
  });

  describe('Token security', () => {
    it('should generate unique JTI for each token', async () => {
      const result1 = await journeyService.createJourney({
        claimId: testClaimId,
        channel: 'pwa',
      });

      const result2 = await journeyService.createJourney({
        claimId: testClaimId,
        channel: 'pwa',
      });

      const decoded1 = jwt.decode(result1.token) as any;
      const decoded2 = jwt.decode(result2.token) as any;

      expect(decoded1.jti).not.toBe(decoded2.jti);
    });

    it('should scope token to specific claim', async () => {
      const result = await journeyService.createJourney({
        claimId: testClaimId,
        channel: 'pwa',
      });

      const decoded = jwt.decode(result.token) as any;
      expect(decoded.claimId).toBe(testClaimId);
    });

    it('should include channel in token payload', async () => {
      const result = await journeyService.createJourney({
        claimId: testClaimId,
        channel: 'whatsapp',
      });

      const decoded = jwt.decode(result.token) as any;
      expect(decoded.channel).toBe('whatsapp');
    });
  });
});
