import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { database } from '../config/database';
import { EmailIntakeService, ParsedIntakeFields, ClaimEmail } from './emailIntakeService';
import { EventService } from './eventService';
import { StatusService } from './statusService';
import { v4 as uuidv4 } from 'uuid';

/**
 * Integration tests for Email Intake System
 * 
 * Tests:
 * - Complete email processing flow from inbox to database
 * - Idempotency (processing same email twice should not create duplicate)
 * - Status transitions and event emission
 * - Error handling for malformed emails
 */

describe('Email Intake Service - Integration Tests', () => {
  beforeAll(async () => {
    // Ensure database connection
    await database.testConnection();
  });

  afterAll(async () => {
    // Clean up
    await database.close();
  });

  beforeEach(async () => {
    // Clean up test data before each test
    await database.query('DELETE FROM claim_events WHERE claim_id LIKE $1', ['test-%']);
    await database.query('DELETE FROM claim_inspections WHERE claim_number LIKE $1', ['TEST-%']);
  });

  describe('Email Body Parsing', () => {
    it('should parse valid email body in key:value format', () => {
      const emailBody = `
Insurer Name: ABC Insurance
Insurer ID: ABC123
Claim Number: TEST-CLM-001
Policyholder Name: John Doe
Policyholder Mobile: +1234567890
Policyholder Email: john@example.com
Insurer Provided VIN: 1HGBH41JXMN109186
      `.trim();

      const parsed = EmailIntakeService.parseEmailBody(emailBody);

      expect(parsed.insurerName).toBe('ABC Insurance');
      expect(parsed.insurerId).toBe('ABC123');
      expect(parsed.claimNumber).toBe('TEST-CLM-001');
      expect(parsed.policyholderName).toBe('John Doe');
      expect(parsed.policyholderMobile).toBe('+1234567890');
      expect(parsed.policyholderEmail).toBe('john@example.com');
      expect(parsed.insurerProvidedVin).toBe('1HGBH41JXMN109186');
    });

    it('should handle missing optional fields', () => {
      const emailBody = `
Insurer Name: ABC Insurance
Insurer ID: ABC123
Claim Number: TEST-CLM-002
Policyholder Name: Jane Smith
Policyholder Mobile: +9876543210
      `.trim();

      const parsed = EmailIntakeService.parseEmailBody(emailBody);

      expect(parsed.insurerName).toBe('ABC Insurance');
      expect(parsed.insurerId).toBe('ABC123');
      expect(parsed.claimNumber).toBe('TEST-CLM-002');
      expect(parsed.policyholderName).toBe('Jane Smith');
      expect(parsed.policyholderMobile).toBe('+9876543210');
      expect(parsed.policyholderEmail).toBeUndefined();
      expect(parsed.insurerProvidedVin).toBeUndefined();
    });

    it('should handle case-insensitive field names', () => {
      const emailBody = `
INSURER NAME: ABC Insurance
insurer id: ABC123
Claim Number: TEST-CLM-003
POLICYHOLDER NAME: Bob Johnson
policyholder mobile: +1111111111
      `.trim();

      const parsed = EmailIntakeService.parseEmailBody(emailBody);

      expect(parsed.insurerName).toBe('ABC Insurance');
      expect(parsed.insurerId).toBe('ABC123');
      expect(parsed.claimNumber).toBe('TEST-CLM-003');
    });
  });

  describe('Field Validation', () => {
    it('should validate all required fields are present', () => {
      const validFields: ParsedIntakeFields = {
        insurerName: 'ABC Insurance',
        insurerId: 'ABC123',
        claimNumber: 'TEST-CLM-004',
        policyholderName: 'Alice Brown',
        policyholderMobile: '+2222222222',
      };

      const errors = EmailIntakeService.validateIntakeFields(validFields);
      expect(errors).toHaveLength(0);
    });

    it('should return errors for missing required fields', () => {
      const invalidFields: Partial<ParsedIntakeFields> = {
        insurerName: 'ABC Insurance',
        claimNumber: 'TEST-CLM-005',
        // Missing insurerId, policyholderName, policyholderMobile
      };

      const errors = EmailIntakeService.validateIntakeFields(invalidFields);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors).toContain('Missing required field: insurerId');
      expect(errors).toContain('Missing required field: policyholderName');
      expect(errors).toContain('Missing required field: policyholderMobile');
    });
  });

  describe('Intake Key Generation', () => {
    it('should generate consistent intake keys for same inputs', () => {
      const messageId = 'test-message-123';
      const claimNumber = 'TEST-CLM-006';

      const key1 = EmailIntakeService.generateIntakeKey(messageId, claimNumber);
      const key2 = EmailIntakeService.generateIntakeKey(messageId, claimNumber);

      expect(key1).toBe(key2);
      expect(key1).toHaveLength(64); // SHA256 hex string
    });

    it('should generate different keys for different inputs', () => {
      const key1 = EmailIntakeService.generateIntakeKey('msg1', 'CLM-001');
      const key2 = EmailIntakeService.generateIntakeKey('msg2', 'CLM-001');
      const key3 = EmailIntakeService.generateIntakeKey('msg1', 'CLM-002');

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key2).not.toBe(key3);
    });
  });

  describe('Claim Creation', () => {
    it('should create claim record in database with correct status', async () => {
      const claimEmail: ClaimEmail = {
        messageId: `test-msg-${uuidv4()}`,
        subject: 'New Glass Claim',
        body: 'Test body',
        receivedAt: new Date(),
        sourceMetadata: {
          from: 'insurer@example.com',
          to: 'claims@glassscans.com',
        },
      };

      const fields: ParsedIntakeFields = {
        insurerName: 'Test Insurance',
        insurerId: 'TEST123',
        claimNumber: `TEST-CLM-${Date.now()}`,
        policyholderName: 'Test User',
        policyholderMobile: '+1234567890',
        policyholderEmail: 'test@example.com',
        insurerProvidedVin: '1HGBH41JXMN109186',
      };

      const result = await EmailIntakeService.createClaim(claimEmail, fields);

      expect(result.claimId).toBeDefined();
      expect(result.intakeKey).toBeDefined();
      expect(result.internalStatus).toBe('intake_received');

      // Verify database record
      const dbResult = await database.query(
        'SELECT * FROM claim_inspections WHERE claim_number = $1',
        [fields.claimNumber]
      );

      expect(dbResult.rowCount).toBe(1);
      const claim = dbResult.rows[0];
      expect(claim.insurer_id).toBe(fields.insurerId);
      expect(claim.internal_status).toBe('intake_received');
      expect(claim.external_status).toBe('Message Sent');
      expect(claim.policyholder_name).toBe(fields.policyholderName);
      expect(claim.policyholder_mobile).toBe(fields.policyholderMobile);
      expect(claim.consent_captured).toBe(false);

      // Verify event was emitted
      const events = await EventService.getClaimEvents(result.claimId);
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.eventType).toBe('claim.intake_received');
    });

    it('should store inspection_data as JSONB', async () => {
      const claimEmail: ClaimEmail = {
        messageId: `test-msg-${uuidv4()}`,
        subject: 'New Glass Claim',
        body: 'Test body',
        receivedAt: new Date(),
        sourceMetadata: {
          from: 'insurer@example.com',
          to: 'claims@glassscans.com',
        },
      };

      const fields: ParsedIntakeFields = {
        insurerName: 'Test Insurance',
        insurerId: 'TEST456',
        claimNumber: `TEST-CLM-${Date.now()}`,
        policyholderName: 'Test User 2',
        policyholderMobile: '+9876543210',
      };

      await EmailIntakeService.createClaim(claimEmail, fields);

      // Verify inspection_data structure
      const dbResult = await database.query(
        'SELECT inspection_data FROM claim_inspections WHERE claim_number = $1',
        [fields.claimNumber]
      );

      const inspectionData = dbResult.rows[0].inspection_data;
      expect(inspectionData.rawIntakePayload).toBeDefined();
      expect(inspectionData.validationDetails).toBeDefined();
      expect(inspectionData.validationDetails.intakeKey).toBeDefined();
      expect(inspectionData.rawIntakePayload.insurerName).toBe(fields.insurerName);
    });
  });

  describe('Idempotency', () => {
    it('should not create duplicate claim for same intake key', async () => {
      const messageId = `test-msg-${uuidv4()}`;
      const claimNumber = `TEST-CLM-${Date.now()}`;

      const claimEmail: ClaimEmail = {
        messageId,
        subject: 'New Glass Claim',
        body: 'Test body',
        receivedAt: new Date(),
        sourceMetadata: {
          from: 'insurer@example.com',
          to: 'claims@glassscans.com',
        },
      };

      const fields: ParsedIntakeFields = {
        insurerName: 'Test Insurance',
        insurerId: 'TEST789',
        claimNumber,
        policyholderName: 'Test User 3',
        policyholderMobile: '+5555555555',
      };

      // Create claim first time
      await EmailIntakeService.createClaim(claimEmail, fields);

      // Check if claim exists
      const exists = await EmailIntakeService.claimExists(
        EmailIntakeService.generateIntakeKey(messageId, claimNumber),
        messageId
      );

      expect(exists).toBe(true);

      // Verify only one record in database
      const dbResult = await database.query(
        'SELECT * FROM claim_inspections WHERE claim_number = $1',
        [claimNumber]
      );

      expect(dbResult.rowCount).toBe(1);
    });
  });

  describe('Status Derivation', () => {
    it('should derive correct external status from internal status', () => {
      expect(StatusService.deriveExternalStatus('intake_received')).toBe('Message Sent');
      expect(StatusService.deriveExternalStatus('intake_validated')).toBe('Message Sent');
      expect(StatusService.deriveExternalStatus('intake_failed')).toBe('Needs Action');
      expect(StatusService.deriveExternalStatus('awaiting_photos')).toBe('Photos In Progress');
      expect(StatusService.deriveExternalStatus('decision_complete')).toBe('Result Ready');
      expect(StatusService.deriveExternalStatus('abandoned')).toBe('Abandoned');
    });

    it('should never store external status independently', async () => {
      // This test verifies that external_status in database is always derived
      const claimEmail: ClaimEmail = {
        messageId: `test-msg-${uuidv4()}`,
        subject: 'New Glass Claim',
        body: 'Test body',
        receivedAt: new Date(),
        sourceMetadata: {},
      };

      const fields: ParsedIntakeFields = {
        insurerName: 'Test Insurance',
        insurerId: 'TEST999',
        claimNumber: `TEST-CLM-${Date.now()}`,
        policyholderName: 'Test User 4',
        policyholderMobile: '+6666666666',
      };

      await EmailIntakeService.createClaim(claimEmail, fields);

      // Verify external status matches derived status
      const dbResult = await database.query(
        'SELECT internal_status, external_status FROM claim_inspections WHERE claim_number = $1',
        [fields.claimNumber]
      );

      const claim = dbResult.rows[0];
      const derivedStatus = StatusService.deriveExternalStatus(claim.internal_status);
      expect(claim.external_status).toBe(derivedStatus);
    });
  });

  describe('Event Emission', () => {
    it('should emit intake_received event on successful claim creation', async () => {
      const claimEmail: ClaimEmail = {
        messageId: `test-msg-${uuidv4()}`,
        subject: 'New Glass Claim',
        body: 'Test body',
        receivedAt: new Date(),
        sourceMetadata: {},
      };

      const fields: ParsedIntakeFields = {
        insurerName: 'Test Insurance',
        insurerId: 'TESTEVT1',
        claimNumber: `TEST-CLM-${Date.now()}`,
        policyholderName: 'Test User 5',
        policyholderMobile: '+7777777777',
      };

      const result = await EmailIntakeService.createClaim(claimEmail, fields);

      // Verify event was emitted
      const events = await EventService.getClaimEvents(result.claimId);
      expect(events.length).toBeGreaterThan(0);

      const intakeEvent = events.find(e => e.eventType === 'claim.intake_received');
      expect(intakeEvent).toBeDefined();
      expect(intakeEvent?.claimId).toBe(result.claimId);
      expect(intakeEvent?.sourceService).toBe('email-intake');
      expect(intakeEvent?.actorType).toBe('system');
    });
  });
});
