/**
 * Consent Gate Enforcement Tests
 * 
 * Tests that verify consent gate blocks photo uploads and other operations
 * until consent is captured (Requirements 2.6, 2.7)
 * 
 * These tests validate Property 3: Consent Gate Blocks Photo Upload
 */

import { consentService } from './consentService';
import { journeyService } from './journeyService';
import { database } from '../config/database';

describe('Consent Gate Enforcement', () => {
  let testClaimId: string;
  let testJourneyToken: string;
  let testJourneyId: string;

  beforeAll(async () => {
    await database.testConnection();
  });

  afterAll(async () => {
    // Clean up test data
    if (testJourneyId) {
      await database.query('DELETE FROM journeys WHERE journey_id = $1', [testJourneyId]);
    }
    if (testClaimId) {
      await database.query('DELETE FROM claim_inspections WHERE id::text = $1', [testClaimId]);
      await database.query('DELETE FROM claim_events WHERE claim_id = $1', [testClaimId]);
    }
    
    await database.close();
  });

  beforeEach(async () => {
    // Create a test claim and journey for each test
    const claimResult = await database.query(
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
        consent_captured,
        inspection_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), false, $8)
      RETURNING id
    `,
      [
        `TEST-GATE-${Date.now()}`,
        'TEST-INSURER',
        'Message Sent',
        'intake_validated',
        'Test User',
        '+1234567890',
        `test-message-${Date.now()}`,
        JSON.stringify({ rawIntakePayload: {}, validationDetails: { intakeKey: `test-key-${Date.now()}` } }),
      ]
    );

    testClaimId = claimResult.rows[0].id.toString();

    const journeyResult = await journeyService.createJourney({
      claimId: testClaimId,
      channel: 'pwa',
    });

    testJourneyToken = journeyResult.token;
    testJourneyId = journeyResult.journeyId;
  });

  describe('Consent gate blocking', () => {
    it('should block operations when consent is not captured', async () => {
      // Verify consent is not captured
      const consentStatus = await consentService.isConsentCaptured(testJourneyToken);
      expect(consentStatus).toBe(false);

      // Verify journey shows consent not captured
      const journey = await journeyService.getJourney(testJourneyId);
      expect(journey?.consentCaptured).toBe(false);

      // Verify claim shows consent not captured
      const claimCheck = await database.query(
        'SELECT consent_captured FROM claim_inspections WHERE id::text = $1',
        [testClaimId]
      );
      expect(claimCheck.rows[0].consent_captured).toBe(false);
    });

    it('should allow operations after consent is captured', async () => {
      // Capture consent
      const captureResult = await consentService.captureConsent({
        journeyToken: testJourneyToken,
        consentAccepted: true,
      });

      expect(captureResult.success).toBe(true);

      // Verify consent is now captured
      const consentStatus = await consentService.isConsentCaptured(testJourneyToken);
      expect(consentStatus).toBe(true);

      // Verify journey shows consent captured
      const journey = await journeyService.getJourney(testJourneyId);
      expect(journey?.consentCaptured).toBe(true);
      expect(journey?.consentCapturedAt).toBeTruthy();
      expect(journey?.consentVersion).toBeTruthy();
      expect(journey?.legalNoticeVersion).toBeTruthy();

      // Verify claim shows consent captured
      const claimCheck = await database.query(
        'SELECT consent_captured FROM claim_inspections WHERE id::text = $1',
        [testClaimId]
      );
      expect(claimCheck.rows[0].consent_captured).toBe(true);
    });

    it('should maintain consent state across multiple checks', async () => {
      // Initial state - no consent
      expect(await consentService.isConsentCaptured(testJourneyToken)).toBe(false);
      expect(await consentService.isConsentCaptured(testJourneyToken)).toBe(false);

      // Capture consent
      await consentService.captureConsent({
        journeyToken: testJourneyToken,
        consentAccepted: true,
      });

      // After consent - should remain true
      expect(await consentService.isConsentCaptured(testJourneyToken)).toBe(true);
      expect(await consentService.isConsentCaptured(testJourneyToken)).toBe(true);
      expect(await consentService.isConsentCaptured(testJourneyToken)).toBe(true);
    });

    it('should record consent metadata correctly', async () => {
      const sessionMetadata = {
        userAgent: 'Mozilla/5.0 Test Browser',
        ipAddress: '192.168.1.1',
        timestamp: new Date().toISOString(),
      };

      const captureResult = await consentService.captureConsent({
        journeyToken: testJourneyToken,
        consentAccepted: true,
        sessionMetadata,
      });

      expect(captureResult.success).toBe(true);
      expect(captureResult.consentRecord).toBeDefined();
      expect(captureResult.consentRecord?.consentCaptured).toBe(true);
      expect(captureResult.consentRecord?.consentCapturedAt).toBeInstanceOf(Date);
      expect(captureResult.consentRecord?.consentVersion).toBeTruthy();
      expect(captureResult.consentRecord?.legalNoticeVersion).toBeTruthy();
      expect(captureResult.consentRecord?.channel).toBe('pwa');
      expect(captureResult.consentRecord?.claimId).toBe(testClaimId);
    });

    it('should emit consent.captured event when consent is recorded', async () => {
      // Capture consent
      await consentService.captureConsent({
        journeyToken: testJourneyToken,
        consentAccepted: true,
      });

      // Verify event was emitted
      const eventCheck = await database.query(
        `SELECT * FROM claim_events 
         WHERE claim_id = $1 AND event_type = 'consent.captured'
         ORDER BY timestamp DESC LIMIT 1`,
        [testClaimId]
      );

      expect(eventCheck.rowCount).toBeGreaterThan(0);
      expect(eventCheck.rows[0].event_type).toBe('consent.captured');
      expect(eventCheck.rows[0].claim_id).toBe(testClaimId);
      expect(eventCheck.rows[0].actor_type).toBe('claimant');
      expect(eventCheck.rows[0].source_service).toBe('journey-service');
      
      const payload = eventCheck.rows[0].payload;
      expect(payload.journeyId).toBe(testJourneyId);
      expect(payload.consentVersion).toBeTruthy();
      expect(payload.legalNoticeVersion).toBeTruthy();
      expect(payload.capturedAt).toBeTruthy();
    });
  });

  describe('Consent gate with different channels', () => {
    it('should enforce consent gate for PWA channel', async () => {
      const journey = await journeyService.getJourney(testJourneyId);
      expect(journey?.channel).toBe('pwa');
      expect(journey?.consentCaptured).toBe(false);

      // Capture consent
      const result = await consentService.captureConsent({
        journeyToken: testJourneyToken,
        consentAccepted: true,
      });

      expect(result.success).toBe(true);
      expect(result.consentRecord?.channel).toBe('pwa');
    });

    it('should enforce consent gate for WhatsApp channel', async () => {
      // Create WhatsApp journey
      const claimResult = await database.query(
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
          consent_captured,
          inspection_data
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), false, $8)
        RETURNING id
      `,
        [
          `TEST-WHATSAPP-${Date.now()}`,
          'TEST-INSURER',
          'Message Sent',
          'intake_validated',
          'WhatsApp User',
          '+1234567899',
          `test-whatsapp-${Date.now()}`,
          JSON.stringify({ rawIntakePayload: {}, validationDetails: { intakeKey: `test-whatsapp-key-${Date.now()}` } }),
        ]
      );

      const whatsappClaimId = claimResult.rows[0].id.toString();

      const journeyResult = await journeyService.createJourney({
        claimId: whatsappClaimId,
        channel: 'whatsapp',
      });

      const journey = await journeyService.getJourney(journeyResult.journeyId);
      expect(journey?.channel).toBe('whatsapp');
      expect(journey?.consentCaptured).toBe(false);

      // Capture consent
      const result = await consentService.captureConsent({
        journeyToken: journeyResult.token,
        consentAccepted: true,
      });

      expect(result.success).toBe(true);
      expect(result.consentRecord?.channel).toBe('whatsapp');

      // Clean up
      await database.query('DELETE FROM journeys WHERE journey_id = $1', [journeyResult.journeyId]);
      await database.query('DELETE FROM claim_inspections WHERE id::text = $1', [whatsappClaimId]);
      await database.query('DELETE FROM claim_events WHERE claim_id = $1', [whatsappClaimId]);
    });
  });

  describe('Legal notice content validation', () => {
    it('should provide all required legal notice fields', () => {
      const notice = consentService.getLegalNotice();

      // Validate structure
      expect(notice).toHaveProperty('version');
      expect(notice).toHaveProperty('content');

      // Validate version
      expect(notice.version).toBeTruthy();
      expect(typeof notice.version).toBe('string');

      // Validate content fields (Requirements 2.2)
      expect(notice.content).toHaveProperty('dataProcessingDescription');
      expect(notice.content).toHaveProperty('automatedAnalysisNotice');
      expect(notice.content).toHaveProperty('manualReviewNotice');
      expect(notice.content).toHaveProperty('privacyNoticeUrl');
      expect(notice.content).toHaveProperty('supportContact');

      // Validate content is non-empty
      expect(notice.content.dataProcessingDescription.length).toBeGreaterThan(0);
      expect(notice.content.automatedAnalysisNotice.length).toBeGreaterThan(0);
      expect(notice.content.manualReviewNotice.length).toBeGreaterThan(0);
      expect(notice.content.privacyNoticeUrl.length).toBeGreaterThan(0);
      expect(notice.content.supportContact.length).toBeGreaterThan(0);

      // Validate URL format
      expect(notice.content.privacyNoticeUrl).toMatch(/^https?:\/\//);

      // Validate email format
      expect(notice.content.supportContact).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    });

    it('should include required content about data processing', () => {
      const notice = consentService.getLegalNotice();

      // Should mention image/photo processing
      expect(notice.content.dataProcessingDescription.toLowerCase()).toMatch(/photo|image/);

      // Should mention automated analysis
      expect(notice.content.automatedAnalysisNotice.toLowerCase()).toMatch(/automat/);

      // Should mention manual review possibility
      expect(notice.content.manualReviewNotice.toLowerCase()).toMatch(/manual|human|review/);
    });
  });

  describe('Error handling', () => {
    it('should reject consent capture with invalid token', async () => {
      const result = await consentService.captureConsent({
        journeyToken: 'invalid-token-12345',
        consentAccepted: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('should reject consent capture when consent not accepted', async () => {
      const result = await consentService.captureConsent({
        journeyToken: testJourneyToken,
        consentAccepted: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('must be accepted');

      // Verify consent was not captured
      const consentStatus = await consentService.isConsentCaptured(testJourneyToken);
      expect(consentStatus).toBe(false);
    });

    it('should handle expired journey tokens', async () => {
      // Create journey with expired token
      const expiredClaimResult = await database.query(
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
          consent_captured,
          inspection_data
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), false, $8)
        RETURNING id
      `,
        [
          `TEST-EXPIRED-${Date.now()}`,
          'TEST-INSURER',
          'Message Sent',
          'intake_validated',
          'Expired User',
          '+1234567898',
          `test-expired-${Date.now()}`,
          JSON.stringify({ rawIntakePayload: {}, validationDetails: { intakeKey: `test-expired-key-${Date.now()}` } }),
        ]
      );

      const expiredClaimId = expiredClaimResult.rows[0].id.toString();

      // Manually create expired journey with proper UUID
      const { v4: uuidv4 } = require('uuid');
      const expiredJourneyId = uuidv4();
      const expiredTokenJti = 'expired-jti';
      const expiredDate = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago

      await database.query(
        `
        INSERT INTO journeys (
          journey_id,
          claim_id,
          channel,
          token_jti,
          expires_at,
          session_metadata
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `,
        [expiredJourneyId, expiredClaimId, 'pwa', expiredTokenJti, expiredDate, JSON.stringify({})]
      );

      // Try to check consent status with expired journey
      const consentStatus = await consentService.isConsentCaptured('fake-expired-token');
      expect(consentStatus).toBe(false);

      // Clean up
      await database.query('DELETE FROM journeys WHERE journey_id = $1', [expiredJourneyId]);
      await database.query('DELETE FROM claim_inspections WHERE id::text = $1', [expiredClaimId]);
      await database.query('DELETE FROM claim_events WHERE claim_id = $1', [expiredClaimId]);
    });
  });
});
