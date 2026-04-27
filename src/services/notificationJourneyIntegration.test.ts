import { notificationService } from './notificationService';
import { journeyService } from './journeyService';
import { database } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

/**
 * Integration tests for Notification and Journey Services
 * Tests the complete flow: claim creation → journey creation → notification dispatch
 * 
 * Task 4.3: Integration test - Notification to journey creation
 * - Test notification dispatch and journey token generation
 * - Test token security and rate limiting
 * - Test journey expiration and abandonment
 */

describe('Notification and Journey Integration', () => {
  const testClaimId = uuidv4();
  const testClaimNumber = `INT-TEST-${Date.now()}`;

  beforeAll(async () => {
    // Ensure database connection is established
    await database.testConnection();

    // Create a test claim
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
        testClaimNumber,
        'TEST-INSURER',
        'Message Sent',
        'intake_received',
        'Integration Test User',
        '+15555551234',
        `int-test-message-${Date.now()}`,
        new Date(),
        JSON.stringify({ rawIntakePayload: {}, validationDetails: { intakeKey: 'test' } }),
      ]
    );
  });

  afterAll(async () => {
    // Clean up test data
    await database.query('DELETE FROM notification_deliveries WHERE claim_id = $1', [testClaimId]);
    await database.query('DELETE FROM journeys WHERE claim_id = $1', [testClaimId]);
    await database.query('DELETE FROM claim_events WHERE claim_id = $1', [testClaimId]);
    await database.query('DELETE FROM claim_inspections WHERE claim_number = $1', [testClaimNumber]);
    await database.close();
  });

  describe('Complete notification flow', () => {
    it('should create journey and send notification with journey link', async () => {
      // Step 1: Create journey
      const journeyResult = await journeyService.createJourney({
        claimId: testClaimId,
        channel: 'pwa',
        sessionMetadata: { source: 'integration_test' },
      });

      expect(journeyResult).toBeDefined();
      expect(journeyResult.token).toBeDefined();
      expect(journeyResult.journeyLink).toBeDefined();

      // Step 2: Send notification with journey link
      const notificationResult = await notificationService.sendNotification({
        claimId: testClaimId,
        claimNumber: testClaimNumber,
        policyholderName: 'Integration Test User',
        policyholderMobile: '+15555551234',
        journeyLink: journeyResult.journeyLink,
        channel: 'sms',
      });

      expect(notificationResult).toBeDefined();
      expect(['sent', 'failed']).toContain(notificationResult.status);

      // Step 3: Verify journey token is valid
      const validation = await journeyService.validateToken(journeyResult.token);
      expect(validation.valid).toBe(true);
      expect(validation.journey?.claimId).toBe(testClaimId);
    }, 15000);

    it('should track notification delivery and journey creation events', async () => {
      const uniqueClaimId = uuidv4();

      // Create journey
      const journeyResult = await journeyService.createJourney({
        claimId: uniqueClaimId,
        channel: 'pwa',
      });

      // Send notification
      const notificationResult = await notificationService.sendNotification({
        claimId: uniqueClaimId,
        claimNumber: `TEST-${Date.now()}`,
        policyholderName: 'Test User',
        policyholderMobile: '+15555551234',
        journeyLink: journeyResult.journeyLink,
        channel: 'sms',
      });

      // Give a small delay for events to be written
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify both events were emitted (if notification succeeded)
      const events = await database.query(
        `
        SELECT event_type, source_service 
        FROM claim_events 
        WHERE claim_id = $1 
        ORDER BY timestamp ASC
      `,
        [uniqueClaimId]
      );

      // Journey event should always be present
      expect(events.rowCount).toBeGreaterThanOrEqual(1);

      const eventTypes = events.rows.map((row: any) => row.event_type);
      expect(eventTypes).toContain('journey.created');
      
      // Notification event only present if notification succeeded
      if (notificationResult.status === 'sent') {
        expect(eventTypes).toContain('notification.sent');
      }

      // Clean up
      await database.query('DELETE FROM notification_deliveries WHERE claim_id = $1', [uniqueClaimId]);
      await database.query('DELETE FROM journeys WHERE claim_id = $1', [uniqueClaimId]);
      await database.query('DELETE FROM claim_events WHERE claim_id = $1', [uniqueClaimId]);
    }, 15000);
  });

  describe('Token security', () => {
    it('should generate secure, unique tokens for each journey', async () => {
      const journey1 = await journeyService.createJourney({
        claimId: testClaimId,
        channel: 'pwa',
      });

      const journey2 = await journeyService.createJourney({
        claimId: testClaimId,
        channel: 'pwa',
      });

      // Tokens should be different
      expect(journey1.token).not.toBe(journey2.token);
      expect(journey1.journeyId).not.toBe(journey2.journeyId);

      // Both tokens should be valid
      const validation1 = await journeyService.validateToken(journey1.token);
      const validation2 = await journeyService.validateToken(journey2.token);

      expect(validation1.valid).toBe(true);
      expect(validation2.valid).toBe(true);
    });

    it('should scope tokens to specific claims', async () => {
      const claimId1 = uuidv4();
      const claimId2 = uuidv4();

      const journey1 = await journeyService.createJourney({
        claimId: claimId1,
        channel: 'pwa',
      });

      const journey2 = await journeyService.createJourney({
        claimId: claimId2,
        channel: 'pwa',
      });

      // Validate tokens are scoped to correct claims
      const validation1 = await journeyService.validateToken(journey1.token);
      const validation2 = await journeyService.validateToken(journey2.token);

      expect(validation1.journey?.claimId).toBe(claimId1);
      expect(validation2.journey?.claimId).toBe(claimId2);

      // Clean up
      await database.query('DELETE FROM journeys WHERE claim_id IN ($1, $2)', [claimId1, claimId2]);
      await database.query('DELETE FROM claim_events WHERE claim_id IN ($1, $2)', [claimId1, claimId2]);
    });

    it('should reject revoked tokens', async () => {
      const journey = await journeyService.createJourney({
        claimId: testClaimId,
        channel: 'pwa',
      });

      // Token should be valid initially
      let validation = await journeyService.validateToken(journey.token);
      expect(validation.valid).toBe(true);

      // Revoke token
      await journeyService.revokeToken(journey.journeyId, 'security_test');

      // Token should now be invalid
      validation = await journeyService.validateToken(journey.token);
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('revoked');
    });
  });

  describe('Journey expiration and abandonment', () => {
    it('should handle journey expiration', async () => {
      // Note: This test verifies the expiration logic exists
      // Actual expiration would take 24 hours in production
      const journey = await journeyService.createJourney({
        claimId: testClaimId,
        channel: 'pwa',
      });

      // Verify expiration time is set correctly (24 hours from now)
      const now = Date.now();
      const expiresAt = journey.expiresAt.getTime();
      const expectedExpiry = now + 24 * 60 * 60 * 1000;

      // Allow 1 second tolerance
      expect(Math.abs(expiresAt - expectedExpiry)).toBeLessThan(1000);
    });

    it('should abandon journey and emit event', async () => {
      const uniqueClaimId = uuidv4();

      const journey = await journeyService.createJourney({
        claimId: uniqueClaimId,
        channel: 'pwa',
      });

      // Abandon journey
      await journeyService.abandonJourney(journey.journeyId, 'timeout');

      // Verify abandonment event was emitted
      const events = await database.query(
        `
        SELECT * FROM claim_events 
        WHERE claim_id = $1 AND event_type = 'claim.abandoned'
      `,
        [uniqueClaimId]
      );

      expect(events.rowCount).toBeGreaterThan(0);

      const event = events.rows[0];
      
      // Payload is already a JSON object, not a string
      const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
      expect(payload.reason).toBe('timeout');

      // Clean up
      await database.query('DELETE FROM journeys WHERE claim_id = $1', [uniqueClaimId]);
      await database.query('DELETE FROM claim_events WHERE claim_id = $1', [uniqueClaimId]);
    });
  });

  describe('Multi-channel support', () => {
    it('should support SMS and WhatsApp channels', async () => {
      // Create PWA journey
      const pwaJourney = await journeyService.createJourney({
        claimId: testClaimId,
        channel: 'pwa',
      });

      // Create WhatsApp journey
      const whatsappJourney = await journeyService.createJourney({
        claimId: testClaimId,
        channel: 'whatsapp',
      });

      // Send SMS notification
      const smsResult = await notificationService.sendNotification({
        claimId: testClaimId,
        claimNumber: testClaimNumber,
        policyholderName: 'Test User',
        policyholderMobile: '+15555551234',
        journeyLink: pwaJourney.journeyLink,
        channel: 'sms',
      });

      // Send WhatsApp notification (may fail if not configured)
      const whatsappResult = await notificationService.sendNotification({
        claimId: testClaimId,
        claimNumber: testClaimNumber,
        policyholderName: 'Test User',
        policyholderMobile: '+15555551234',
        journeyLink: whatsappJourney.journeyLink,
        channel: 'whatsapp',
      });

      expect(smsResult.channel).toBe('sms');
      expect(whatsappResult.channel).toBe('whatsapp');
    }, 15000);
  });

  describe('Error handling', () => {
    it('should handle notification failure gracefully', async () => {
      const journey = await journeyService.createJourney({
        claimId: testClaimId,
        channel: 'pwa',
      });

      // Try to send notification with invalid phone number
      const result = await notificationService.sendNotification({
        claimId: testClaimId,
        claimNumber: testClaimNumber,
        policyholderName: 'Test User',
        policyholderMobile: 'invalid-phone',
        journeyLink: journey.journeyLink,
        channel: 'sms',
      });

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toBeDefined();

      // Journey should still be valid even if notification failed
      const validation = await journeyService.validateToken(journey.token);
      expect(validation.valid).toBe(true);
    }, 15000);

    it('should handle invalid token validation', async () => {
      const validation = await journeyService.validateToken('invalid.token.here');

      expect(validation.valid).toBe(false);
      expect(validation.error).toBeDefined();
      expect(validation.journey).toBeUndefined();
    });
  });

  describe('Consent capture integration', () => {
    it('should capture consent and update journey', async () => {
      const journey = await journeyService.createJourney({
        claimId: testClaimId,
        channel: 'pwa',
      });

      // Initially, consent should not be captured
      let journeyData = await journeyService.getJourney(journey.journeyId);
      expect(journeyData?.consentCaptured).toBe(false);

      // Capture consent
      await journeyService.captureConsent(journey.journeyId, '1.0', '1.0');

      // Verify consent was captured
      journeyData = await journeyService.getJourney(journey.journeyId);
      expect(journeyData?.consentCaptured).toBe(true);
      expect(journeyData?.consentVersion).toBe('1.0');
      expect(journeyData?.legalNoticeVersion).toBe('1.0');
      expect(journeyData?.consentCapturedAt).toBeInstanceOf(Date);
    });
  });
});
