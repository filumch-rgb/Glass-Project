/**
 * Integration test for consent capture flow
 * Tests the complete flow from journey creation to consent capture
 */

import { journeyService } from './journeyService';
import { consentService } from './consentService';
import { database } from '../config/database';

describe('Consent Integration Tests', () => {
  let testClaimId: string;
  let testJourneyToken: string;
  let testJourneyId: string;

  beforeAll(async () => {
    // Ensure database connection
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
    
    // Close database connection
    await database.close();
  });

  describe('Full consent capture flow', () => {
    it('should create journey, present legal notice, and capture consent', async () => {
      // Step 1: Create a test claim
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
          'TEST-CONSENT-001',
          'TEST-INSURER',
          'Message Sent',
          'intake_validated',
          'Test User',
          '+1234567890',
          'test-message-id',
          JSON.stringify({ rawIntakePayload: {}, validationDetails: { intakeKey: 'test-key' } }),
        ]
      );

      testClaimId = claimResult.rows[0].id.toString();

      // Step 2: Create journey
      const journeyResult = await journeyService.createJourney({
        claimId: testClaimId,
        channel: 'pwa',
        sessionMetadata: { test: 'integration' },
      });

      expect(journeyResult.journeyId).toBeTruthy();
      expect(journeyResult.token).toBeTruthy();
      expect(journeyResult.journeyLink).toContain('/journey/');

      testJourneyToken = journeyResult.token;
      testJourneyId = journeyResult.journeyId;

      // Step 3: Get legal notice
      const legalNotice = consentService.getLegalNotice();

      expect(legalNotice.version).toBeTruthy();
      expect(legalNotice.content.dataProcessingDescription).toBeTruthy();
      expect(legalNotice.content.automatedAnalysisNotice).toBeTruthy();
      expect(legalNotice.content.manualReviewNotice).toBeTruthy();

      // Step 4: Check consent status (should be false initially)
      const initialConsentStatus = await consentService.isConsentCaptured(testJourneyToken);
      expect(initialConsentStatus).toBe(false);

      // Step 5: Capture consent
      const captureResult = await consentService.captureConsent({
        journeyToken: testJourneyToken,
        consentAccepted: true,
        sessionMetadata: {
          userAgent: 'test-agent',
          ipAddress: '127.0.0.1',
        },
      });

      expect(captureResult.success).toBe(true);
      expect(captureResult.consentRecord).toBeDefined();
      expect(captureResult.consentRecord?.claimId).toBe(testClaimId);
      expect(captureResult.consentRecord?.consentCaptured).toBe(true);
      expect(captureResult.consentRecord?.channel).toBe('pwa');

      // Step 6: Verify consent status is now true
      const finalConsentStatus = await consentService.isConsentCaptured(testJourneyToken);
      expect(finalConsentStatus).toBe(true);

      // Step 7: Verify journey record was updated
      const journey = await journeyService.getJourney(testJourneyId);
      expect(journey).toBeTruthy();
      expect(journey?.consentCaptured).toBe(true);
      expect(journey?.consentCapturedAt).toBeTruthy();
      expect(journey?.consentVersion).toBeTruthy();
      expect(journey?.legalNoticeVersion).toBeTruthy();

      // Step 8: Verify claim record was updated
      const claimCheck = await database.query(
        'SELECT consent_captured FROM claim_inspections WHERE id::text = $1',
        [testClaimId]
      );
      expect(claimCheck.rows[0].consent_captured).toBe(true);

      // Step 9: Verify consent.captured event was emitted
      const eventCheck = await database.query(
        `SELECT * FROM claim_events 
         WHERE claim_id = $1 AND event_type = 'consent.captured'
         ORDER BY timestamp DESC LIMIT 1`,
        [testClaimId]
      );
      expect(eventCheck.rowCount).toBeGreaterThan(0);
      expect(eventCheck.rows[0].event_type).toBe('consent.captured');
    });

    it('should reject consent capture without acceptance', async () => {
      // Create a new journey for this test
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
          'TEST-CONSENT-002',
          'TEST-INSURER',
          'Message Sent',
          'intake_validated',
          'Test User 2',
          '+1234567891',
          'test-message-id-2',
          JSON.stringify({ rawIntakePayload: {}, validationDetails: { intakeKey: 'test-key-2' } }),
        ]
      );

      const claimId = claimResult.rows[0].id.toString();

      const journeyResult = await journeyService.createJourney({
        claimId,
        channel: 'pwa',
      });

      // Try to capture consent without acceptance
      const captureResult = await consentService.captureConsent({
        journeyToken: journeyResult.token,
        consentAccepted: false,
      });

      expect(captureResult.success).toBe(false);
      expect(captureResult.error).toContain('must be accepted');

      // Verify consent was not captured
      const consentStatus = await consentService.isConsentCaptured(journeyResult.token);
      expect(consentStatus).toBe(false);

      // Clean up
      await database.query('DELETE FROM journeys WHERE journey_id = $1', [journeyResult.journeyId]);
      await database.query('DELETE FROM claim_inspections WHERE id::text = $1', [claimId]);
      await database.query('DELETE FROM claim_events WHERE claim_id = $1', [claimId]);
    });

    it('should handle idempotent consent capture', async () => {
      // Create a new journey with unique message ID
      const uniqueMessageId = `test-message-idempotent-${Date.now()}`;
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
          `TEST-CONSENT-${Date.now()}`,
          'TEST-INSURER',
          'Message Sent',
          'intake_validated',
          'Test User Idempotent',
          '+1234567892',
          uniqueMessageId,
          JSON.stringify({ rawIntakePayload: {}, validationDetails: { intakeKey: `test-key-idempotent-${Date.now()}` } }),
        ]
      );

      const claimId = claimResult.rows[0].id.toString();

      const journeyResult = await journeyService.createJourney({
        claimId,
        channel: 'pwa',
      });

      // Capture consent first time
      const firstCapture = await consentService.captureConsent({
        journeyToken: journeyResult.token,
        consentAccepted: true,
      });

      expect(firstCapture.success).toBe(true);
      const firstTimestamp = firstCapture.consentRecord?.consentCapturedAt;

      // Capture consent second time (should be idempotent)
      const secondCapture = await consentService.captureConsent({
        journeyToken: journeyResult.token,
        consentAccepted: true,
      });

      expect(secondCapture.success).toBe(true);
      // Timestamps should be the same (idempotent) or very close (within 10ms for timing variations)
      const timeDiff = Math.abs(
        (secondCapture.consentRecord?.consentCapturedAt?.getTime() || 0) - (firstTimestamp?.getTime() || 0)
      );
      expect(timeDiff).toBeLessThan(10); // Allow up to 10ms difference for timing variations

      // Clean up
      await database.query('DELETE FROM journeys WHERE journey_id = $1', [journeyResult.journeyId]);
      await database.query('DELETE FROM claim_inspections WHERE id::text = $1', [claimId]);
      await database.query('DELETE FROM claim_events WHERE claim_id = $1', [claimId]);
    });
  });
});
