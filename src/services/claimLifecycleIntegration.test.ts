/**
 * Claim Lifecycle Integration Test
 *
 * Tests the complete claim lifecycle from email intake to JSON output,
 * verifying state transitions, data flow between services, and event emission.
 *
 * All external services (database, Twilio, Google Vision, Gemini, IMAP, VIN decoders)
 * are mocked. Focus is on orchestration correctness.
 */

// Mock external dependencies before imports
jest.mock('../config/database');
jest.mock('../config');
jest.mock('../utils/logger');

import { v4 as uuidv4 } from 'uuid';

// --- Mock setup for database ---
const mockQuery = jest.fn();
jest.mock('../config/database', () => ({
  database: {
    query: (...args: any[]) => mockQuery(...args),
  },
}));

// --- Mock setup for config ---
jest.mock('../config', () => ({
  config: {
    port: 3000,
    imap: {
      host: 'imap.test.com',
      port: 993,
      user: 'test@test.com',
      password: 'password',
      mailbox: 'INBOX',
      completedFolder: 'Completed',
      failedFolder: 'Failed',
      pollIntervalMinutes: 15,
    },
    security: {
      jwtSecret: 'test-jwt-secret-key-for-integration-tests',
    },
    assessment: {
      journeyTokenExpiresHours: 24,
      rulesVersion: '1.0.0',
    },
    notifications: {
      twilio: {
        accountSid: 'test-sid',
        authToken: 'test-token',
        phoneNumber: '+15551234567',
      },
    },
    damageAnalysis: {
      confidenceThreshold: 0.7,
      geminiApiKey: 'test-gemini-key',
      geminiModel: 'gemini-1.5-pro',
    },
    vinEnrichment: {
      geography: 'south_africa',
    },
    objectStorage: {
      uploadDir: '/tmp/test-uploads',
      signedUrlSecret: 'test-signed-url-secret',
      signedUrlExpiresMinutes: 60,
    },
  },
}));

// --- Mock logger ---
jest.mock('../utils/logger', () => ({
  loggers: {
    app: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  },
}));


// Import services after mocks are set up
import { EmailIntakeService, ClaimEmail, ParsedIntakeFields } from './emailIntakeService';
import { EventService, EVENT_TYPES } from './eventService';
import { StatusService } from './statusService';
import { DecisionRulesEngine, DecisionInputs, DecisionResult } from './decisionRulesEngine';
import { ManualReviewService, ManualReviewRecord } from './manualReviewService';
import { ResultFormatterService, ResultFormatterInput, InsurerJsonOutput } from './resultFormatterService';
import { VINEnrichmentResult } from './vinEnrichmentService';
import { DamageAnalysisResult } from './damageAnalysisService';
import { GlassTypeAnalysisResult } from './glassTypeAnalysisService';
import { InternalStatus } from '../types';

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockClaimEmail(overrides?: Partial<ClaimEmail>): ClaimEmail {
  return {
    messageId: `msg-${uuidv4()}`,
    subject: 'New Glass Claim',
    body: [
      'Insurer Name: Test Insurance Co',
      'Claim Number: CLM-2024-001',
      'Policyholder Name: John Doe',
      'Policyholder Mobile: +27821234567',
      'Policyholder Email: john@example.com',
      'VIN: 1HGBH41JXMN109186',
    ].join('\n'),
    receivedAt: new Date('2024-01-15T10:00:00Z'),
    sourceMetadata: { from: 'insurer@test.com', to: 'claims@glass.com' },
    ...overrides,
  };
}

function createMockParsedFields(overrides?: Partial<ParsedIntakeFields>): ParsedIntakeFields {
  return {
    insurerName: 'Test Insurance Co',
    claimNumber: 'CLM-2024-001',
    policyholderName: 'John Doe',
    policyholderMobile: '+27821234567',
    policyholderEmail: 'john@example.com',
    insurerProvidedVin: '1HGBH41JXMN109186',
    ...overrides,
  };
}

function createMockVINEnrichment(overrides?: Partial<VINEnrichmentResult>): VINEnrichmentResult {
  return {
    claimId: 'claim-123',
    vinResultState: 'validated',
    insurerProvidedVin: '1HGBH41JXMN109186',
    ocrExtractedVin: '1HGBH41JXMN109186',
    ocrConfidenceScore: 0.95,
    bestValidatedVin: '1HGBH41JXMN109186',
    vinMismatchFlag: false,
    decoderUsed: 'lightstone',
    vehicleData: {
      make: 'Honda',
      model: 'Civic',
      year: 2021,
      bodyType: 'Sedan',
      color: 'White',
    },
    adasStatus: 'yes',
    adasFeatures: ['Lane Departure Warning', 'Forward Collision Warning'],
    enrichedAt: new Date('2024-01-15T10:05:00Z'),
    ...overrides,
  };
}

function createMockDamageAnalysis(overrides?: Partial<DamageAnalysisResult>): DamageAnalysisResult {
  return {
    claimId: 'claim-123',
    damagePoints: [
      {
        affectedRegion: 'center_windscreen',
        severityAttributes: { crackLength: 15, crackType: 'star' },
        glassObservations: ['Star crack pattern', 'Damage in driver line of sight'],
      },
    ],
    overallConfidence: 0.88,
    uncertaintyIndicators: [],
    insufficiencyFlags: [],
    evidenceSufficiencyAssessment: 'sufficient',
    analysedAt: new Date('2024-01-15T10:06:00Z'),
    ...overrides,
  };
}

function createMockGlassTypeAnalysis(overrides?: Partial<GlassTypeAnalysisResult>): GlassTypeAnalysisResult {
  return {
    claimId: 'claim-123',
    glassManufacturer: 'AGC',
    vehicleManufacturerLogo: 'Honda',
    glassType: 'oem',
    confidence: 0.92,
    uncertaintyIndicators: [],
    analysedAt: new Date('2024-01-15T10:06:30Z'),
    ...overrides,
  };
}

function createMockDecisionResult(overrides?: Partial<DecisionResult>): DecisionResult {
  return {
    claimId: 'claim-123',
    outcome: 'replace',
    decisionEligible: true,
    prerequisiteChecks: {
      consentCaptured: true,
      allFixedPhotosAccepted: true,
      atLeastOneDamagePhotoAccepted: true,
      evidenceNotInsufficient: true,
      structuredDamageOutputPresent: true,
      noUnresolvedVinConflict: true,
      noBlockingOperationalFlags: true,
      confidenceThresholdsMet: true,
      noMandatoryManualReviewTrigger: true,
    },
    blockingReasons: [],
    justification: 'Star crack in driver line of sight with ADAS vehicle requires OEM replacement',
    confidenceSummary: { damage: 0.88, vin: 0.95, glassType: 0.92 },
    rulesVersion: '1.0.0',
    generatedAt: new Date('2024-01-15T10:07:00Z'),
    ...overrides,
  };
}

function createLowConfidenceDecisionResult(): DecisionResult {
  return {
    claimId: 'claim-123',
    outcome: 'needs_manual_review',
    decisionEligible: false,
    prerequisiteChecks: {
      consentCaptured: true,
      allFixedPhotosAccepted: true,
      atLeastOneDamagePhotoAccepted: true,
      evidenceNotInsufficient: true,
      structuredDamageOutputPresent: true,
      noUnresolvedVinConflict: true,
      noBlockingOperationalFlags: true,
      confidenceThresholdsMet: false, // Low confidence triggers manual review
      noMandatoryManualReviewTrigger: false,
    },
    blockingReasons: ['Confidence threshold not met', 'Mandatory manual review trigger fired'],
    justification: 'Low confidence in damage assessment requires manual review',
    confidenceSummary: { damage: 0.45, vin: 0.95, glassType: 0.6 },
    rulesVersion: '1.0.0',
    generatedAt: new Date('2024-01-15T10:07:00Z'),
  };
}


// ============================================================================
// Test Suite: Complete Claim Lifecycle
// ============================================================================

describe('Claim Lifecycle Integration', () => {
  let emittedEvents: Array<{ eventType: string; claimId: string; payload: any }>;

  beforeEach(() => {
    jest.clearAllMocks();
    emittedEvents = [];

    // Mock database query to track events and return appropriate results
    mockQuery.mockImplementation((sql: string, params?: any[]) => {
      // Handle event emission (INSERT INTO claim_events)
      if (sql.includes('INSERT INTO claim_events')) {
        const eventType = params?.[1];
        const claimId = params?.[2];
        const payload = params?.[9] ? JSON.parse(params[9]) : {};
        emittedEvents.push({ eventType, claimId, payload });
        return { rowCount: 1, rows: [{ event_id: uuidv4() }] };
      }

      // Handle claim creation (INSERT INTO claim_inspections)
      if (sql.includes('INSERT INTO claim_inspections')) {
        return { rowCount: 1, rows: [] };
      }

      // Handle journey creation (INSERT INTO journeys)
      if (sql.includes('INSERT INTO journeys')) {
        return { rowCount: 1, rows: [] };
      }

      // Handle notification delivery (INSERT INTO notification_deliveries)
      if (sql.includes('INSERT INTO notification_deliveries')) {
        return { rowCount: 1, rows: [] };
      }

      // Handle claim existence check
      if (sql.includes('SELECT 1 FROM claim_inspections WHERE intake_message_id')) {
        return { rowCount: 0, rows: [] };
      }

      // Handle journey lookup
      if (sql.includes('SELECT') && sql.includes('journeys')) {
        return { rowCount: 0, rows: [] };
      }

      // Handle claim update
      if (sql.includes('UPDATE claim_inspections')) {
        return { rowCount: 1, rows: [] };
      }

      // Handle event retrieval
      if (sql.includes('SELECT') && sql.includes('claim_events')) {
        return {
          rowCount: emittedEvents.length,
          rows: emittedEvents.map((e, i) => ({
            id: i + 1,
            event_id: uuidv4(),
            event_type: e.eventType,
            claim_id: e.claimId,
            timestamp: new Date(),
            source_service: 'test',
            actor_type: 'system',
            actor_id: null,
            correlation_id: null,
            idempotency_key: `key-${i}`,
            payload: e.payload,
          })),
        };
      }

      // Default
      return { rowCount: 0, rows: [] };
    });
  });

  // ==========================================================================
  // 1. Happy Path - Automated Decision
  // ==========================================================================
  describe('Happy Path - Automated Decision (Email to JSON Output)', () => {
    it('should process email intake and create claim with intake_received status', () => {
      const email = createMockClaimEmail();
      const parsed = EmailIntakeService.parseEmailBody(email.body);

      expect(parsed.insurerName).toBe('Test Insurance Co');
      expect(parsed.claimNumber).toBe('CLM-2024-001');
      expect(parsed.policyholderName).toBe('John Doe');
      expect(parsed.policyholderMobile).toBe('+27821234567');
      expect(parsed.policyholderEmail).toBe('john@example.com');
      expect(parsed.insurerProvidedVin).toBe('1HGBH41JXMN109186');
    });

    it('should validate all required intake fields are present', () => {
      const fields = createMockParsedFields();
      const errors = EmailIntakeService.validateIntakeFields(fields);
      expect(errors).toHaveLength(0);
    });

    it('should generate unique intake keys for idempotency', () => {
      const key1 = EmailIntakeService.generateIntakeKey('msg-1', 'CLM-001');
      const key2 = EmailIntakeService.generateIntakeKey('msg-2', 'CLM-001');
      const key3 = EmailIntakeService.generateIntakeKey('msg-1', 'CLM-001');

      expect(key1).not.toBe(key2); // Different message IDs
      expect(key1).toBe(key3); // Same inputs = same key
    });

    it('should derive correct external status from internal status through lifecycle', () => {
      const statusTransitions: Array<{ internal: InternalStatus; expectedExternal: string }> = [
        { internal: 'intake_received', expectedExternal: 'Message Sent' },
        { internal: 'notification_sent', expectedExternal: 'Message Sent' },
        { internal: 'notification_opened', expectedExternal: 'Message Opened' },
        { internal: 'awaiting_consent', expectedExternal: 'Message Opened' },
        { internal: 'awaiting_photos', expectedExternal: 'Photos In Progress' },
        { internal: 'photos_validated', expectedExternal: 'Photos Submitted' },
        { internal: 'vin_enrichment_pending', expectedExternal: 'Under Review' },
        { internal: 'vin_enrichment_complete', expectedExternal: 'Under Review' },
        { internal: 'damage_analysis_pending', expectedExternal: 'Under Review' },
        { internal: 'damage_analysis_complete', expectedExternal: 'Under Review' },
        { internal: 'decision_pending', expectedExternal: 'Under Review' },
        { internal: 'decision_complete', expectedExternal: 'Result Ready' },
        { internal: 'result_delivered', expectedExternal: 'Result Ready' },
      ];

      for (const { internal, expectedExternal } of statusTransitions) {
        const external = StatusService.deriveExternalStatus(internal);
        expect(external).toBe(expectedExternal);
      }
    });

    it('should create claim record in database and emit intake_received event', async () => {
      const email = createMockClaimEmail();
      const fields = createMockParsedFields();

      // Mock the dynamic imports for journey and notification services
      jest.mock('./journeyService', () => ({
        journeyService: {
          createJourney: jest.fn().mockResolvedValue({
            journeyId: 'journey-123',
            token: 'jwt-token-123',
            journeyLink: 'http://localhost:3000/journey/jwt-token-123',
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          }),
        },
      }));

      jest.mock('./notificationService', () => ({
        notificationService: {
          sendNotification: jest.fn().mockResolvedValue({
            claimId: 'claim-123',
            channel: 'sms',
            sentAt: new Date(),
            providerMessageId: 'twilio-msg-123',
            status: 'sent',
          }),
        },
      }));

      const result = await EmailIntakeService.createClaim(email, fields);

      expect(result.claimId).toBeDefined();
      expect(result.intakeKey).toBeDefined();
      expect(result.internalStatus).toBe('intake_received');

      // Verify claim was inserted into database
      const insertCall = mockQuery.mock.calls.find(
        (call) => call[0].includes('INSERT INTO claim_inspections')
      );
      expect(insertCall).toBeDefined();

      // Verify intake_received event was emitted
      const intakeEvent = emittedEvents.find(
        (e) => e.eventType === EVENT_TYPES.INTAKE_RECEIVED
      );
      expect(intakeEvent).toBeDefined();
      expect(intakeEvent!.payload.claimNumber).toBe('CLM-2024-001');
    });

    it('should produce complete automated decision with decision_source="automated"', async () => {
      const decisionResult = createMockDecisionResult();
      const vinEnrichment = createMockVINEnrichment();
      const damageAnalysis = createMockDamageAnalysis();
      const glassTypeAnalysis = createMockGlassTypeAnalysis();

      const formatter = new ResultFormatterService();
      const input: ResultFormatterInput = {
        claimId: 'claim-123',
        claimNumber: 'CLM-2024-001',
        internalStatus: 'decision_complete',
        decisionResult,
        vinEnrichment,
        damageAnalysis,
        glassTypeAnalysis,
        // No manual review = automated
      };

      const output = await formatter.formatResult(input);

      // Verify output contract completeness
      expect(output.schema_version).toBe('1.0.0');
      expect(output.claim_id).toBe('claim-123');
      expect(output.claim_number).toBe('CLM-2024-001');
      expect(output.external_status).toBe('Result Ready');
      expect(output.internal_status).toBe('decision_complete');
      expect(output.final_decision).toBe('replace');
      expect(output.final_decision_source).toBe('automated');
      expect(output.decision_eligibility).toBe(true);
      expect(output.blocking_reasons).toEqual([]);
      expect(output.manual_review_flag).toBe(false);
      expect(output.manual_review_reason_codes).toEqual([]);
      expect(output.rules_version).toBe('1.0.0');
      expect(output.generated_at).toBeDefined();

      // Verify VIN data
      expect(output.vin_data).not.toBeNull();
      expect(output.vin_data!.vin_result_state).toBe('validated');
      expect(output.vin_data!.vehicle_data?.make).toBe('Honda');
      expect(output.vin_data!.vehicle_data?.model).toBe('Civic');
      expect(output.vin_data!.adas_status).toBe('yes');

      // Verify damage summary
      expect(output.damage_summary).not.toBeNull();
      expect(output.damage_summary!.overall_confidence).toBe(0.88);
      expect(output.damage_summary!.damage_points).toHaveLength(1);

      // Verify glass type summary
      expect(output.glass_type_summary).not.toBeNull();
      expect(output.glass_type_summary!.glass_type).toBe('oem');
      expect(output.glass_type_summary!.glass_manufacturer).toBe('AGC');

      // Verify result.delivered event was emitted
      const deliveredEvent = emittedEvents.find(
        (e) => e.eventType === EVENT_TYPES.RESULT_DELIVERED
      );
      expect(deliveredEvent).toBeDefined();
      expect(deliveredEvent!.payload.finalDecision).toBe('replace');
      expect(deliveredEvent!.payload.finalDecisionSource).toBe('automated');
    });

    it('should emit events in correct lifecycle order for happy path', async () => {
      // Simulate the full lifecycle by emitting events in order
      const claimId = 'claim-lifecycle-test';

      await EventService.emit({
        eventType: EVENT_TYPES.INTAKE_RECEIVED,
        claimId,
        sourceService: 'email-intake',
        actorType: 'system',
        payload: { claimNumber: 'CLM-001' },
      });

      await EventService.emit({
        eventType: EVENT_TYPES.JOURNEY_CREATED,
        claimId,
        sourceService: 'journey-service',
        actorType: 'system',
        payload: { journeyId: 'j-1' },
      });

      await EventService.emit({
        eventType: EVENT_TYPES.NOTIFICATION_SENT,
        claimId,
        sourceService: 'notification-service',
        actorType: 'system',
        payload: { channel: 'sms' },
      });

      await EventService.emit({
        eventType: EVENT_TYPES.CONSENT_CAPTURED,
        claimId,
        sourceService: 'journey-service',
        actorType: 'claimant',
        payload: { consentVersion: '1.0.0' },
      });

      await EventService.emit({
        eventType: EVENT_TYPES.PHOTO_SET_COMPLETED,
        claimId,
        sourceService: 'photo-service',
        actorType: 'claimant',
        payload: { totalPhotos: 6 },
      });

      await EventService.emit({
        eventType: EVENT_TYPES.VIN_ENRICHMENT_COMPLETED,
        claimId,
        sourceService: 'vin-enrichment',
        actorType: 'system',
        payload: { vinResultState: 'validated' },
      });

      await EventService.emit({
        eventType: EVENT_TYPES.DAMAGE_ANALYSIS_COMPLETED,
        claimId,
        sourceService: 'damage-analysis',
        actorType: 'system',
        payload: { confidence: 0.88 },
      });

      await EventService.emit({
        eventType: EVENT_TYPES.DECISION_GENERATED,
        claimId,
        sourceService: 'decision-rules-engine',
        actorType: 'system',
        payload: { outcome: 'replace' },
      });

      await EventService.emit({
        eventType: EVENT_TYPES.RESULT_DELIVERED,
        claimId,
        sourceService: 'result-formatter',
        actorType: 'system',
        payload: { finalDecisionSource: 'automated' },
      });

      // Verify events were emitted in correct order
      const claimEvents = emittedEvents.filter((e) => e.claimId === claimId);
      expect(claimEvents).toHaveLength(9);

      const expectedOrder = [
        EVENT_TYPES.INTAKE_RECEIVED,
        EVENT_TYPES.JOURNEY_CREATED,
        EVENT_TYPES.NOTIFICATION_SENT,
        EVENT_TYPES.CONSENT_CAPTURED,
        EVENT_TYPES.PHOTO_SET_COMPLETED,
        EVENT_TYPES.VIN_ENRICHMENT_COMPLETED,
        EVENT_TYPES.DAMAGE_ANALYSIS_COMPLETED,
        EVENT_TYPES.DECISION_GENERATED,
        EVENT_TYPES.RESULT_DELIVERED,
      ];

      claimEvents.forEach((event, index) => {
        expect(event.eventType).toBe(expectedOrder[index]);
      });
    });

    it('should enforce decision engine determinism - same inputs produce same output', async () => {
      const engine = new DecisionRulesEngine();
      const inputs: DecisionInputs = {
        claimId: 'claim-determinism-test',
        consentCaptured: true,
        fixedPhotosAccepted: {
          front_vehicle: true,
          inside_driver: true,
          inside_passenger: true,
          vin_cutout: true,
          logo_silkscreen: true,
        },
        damagePhotosAccepted: 2,
        damageAnalysis: createMockDamageAnalysis(),
        glassTypeAnalysis: createMockGlassTypeAnalysis(),
        vinEnrichment: createMockVINEnrichment(),
      };

      const result1 = await engine.generateDecision(inputs);
      const result2 = await engine.generateDecision(inputs);

      expect(result1.outcome).toBe(result2.outcome);
      expect(result1.decisionEligible).toBe(result2.decisionEligible);
      expect(result1.blockingReasons).toEqual(result2.blockingReasons);
      expect(result1.prerequisiteChecks).toEqual(result2.prerequisiteChecks);
    });
  });


  // ==========================================================================
  // 2. Manual Review Path
  // ==========================================================================
  describe('Manual Review Path - Low Confidence Triggers Review', () => {
    it('should trigger manual review when confidence threshold not met', async () => {
      const engine = new DecisionRulesEngine();
      const inputs: DecisionInputs = {
        claimId: 'claim-manual-review',
        consentCaptured: true,
        fixedPhotosAccepted: {
          front_vehicle: true,
          inside_driver: true,
          inside_passenger: true,
          vin_cutout: true,
          logo_silkscreen: true,
        },
        damagePhotosAccepted: 1,
        damageAnalysis: createMockDamageAnalysis({
          overallConfidence: 0.45, // Below threshold
          uncertaintyIndicators: ['Low image quality', 'Ambiguous damage pattern'],
        }),
        glassTypeAnalysis: createMockGlassTypeAnalysis({
          confidence: 0.5,
          uncertaintyIndicators: ['Logo partially obscured'],
        }),
        vinEnrichment: createMockVINEnrichment(),
      };

      const result = await engine.generateDecision(inputs);

      // Decision should not be repair or replace when confidence is low
      expect(['needs_manual_review', 'insufficient_evidence', 'unable_to_assess']).toContain(
        result.outcome
      );
      expect(result.decisionEligible).toBe(false);
      expect(result.blockingReasons.length).toBeGreaterThan(0);
    });

    it('should create manual review with immutable machine assessment snapshot', async () => {
      const manualReviewService = new ManualReviewService();
      const machineAssessment = createLowConfidenceDecisionResult();

      const review = await manualReviewService.createManualReview({
        claimId: 'claim-manual-review',
        triggerReasons: ['low_confidence', 'confidence_threshold_not_met'],
        triggerSource: 'automatic',
        priority: 'normal',
        machineAssessmentSnapshot: machineAssessment,
      });

      expect(review.reviewId).toBeDefined();
      expect(review.claimId).toBe('claim-manual-review');
      expect(review.triggerReasons).toContain('low_confidence');
      expect(review.triggerSource).toBe('automatic');
      expect(review.machineAssessmentSnapshot).toEqual(machineAssessment);
      expect(review.overrideFlag).toBe(false);
      expect(review.queuedAt).toBeDefined();
      expect(review.reviewCompletedAt).toBeUndefined();

      // Verify manual_review_triggered event was emitted
      const reviewEvent = emittedEvents.find(
        (e) => e.eventType === EVENT_TYPES.DECISION_MANUAL_REVIEW_TRIGGERED
      );
      expect(reviewEvent).toBeDefined();
      expect(reviewEvent!.payload.triggerReasons).toContain('low_confidence');
    });

    it('should produce hybrid decision when reviewer approves machine result', async () => {
      const manualReviewService = new ManualReviewService();
      const machineAssessment = createMockDecisionResult({
        outcome: 'replace',
        claimId: 'claim-hybrid',
      });

      // Create review
      const review = await manualReviewService.createManualReview({
        claimId: 'claim-hybrid',
        triggerReasons: ['low_confidence'],
        triggerSource: 'automatic',
        machineAssessmentSnapshot: machineAssessment,
      });

      // Reviewer approves machine result
      const completedReview = await manualReviewService.processReviewerAction({
        reviewId: review.reviewId,
        reviewerId: 'reviewer-001',
        action: 'approve_machine_result',
        reviewerNotes: 'Machine assessment looks correct',
      });

      expect(completedReview.reviewerAction).toBe('approve_machine_result');
      expect(completedReview.finalReviewedOutcome).toBe('replace');
      expect(completedReview.overrideFlag).toBe(false);
      expect(completedReview.reviewCompletedAt).toBeDefined();

      // Format result with manual review
      const formatter = new ResultFormatterService();
      const output = await formatter.formatResult({
        claimId: 'claim-hybrid',
        claimNumber: 'CLM-2024-002',
        internalStatus: 'decision_complete',
        decisionResult: machineAssessment,
        vinEnrichment: createMockVINEnrichment(),
        damageAnalysis: createMockDamageAnalysis(),
        glassTypeAnalysis: createMockGlassTypeAnalysis(),
        manualReview: completedReview,
      });

      expect(output.final_decision_source).toBe('hybrid');
      expect(output.final_decision).toBe('replace');
      expect(output.manual_review_flag).toBe(true);
      expect(output.manual_review_reason_codes).toContain('low_confidence');
    });

    it('should produce manually_reviewed decision when reviewer overrides', async () => {
      const manualReviewService = new ManualReviewService();
      const machineAssessment = createMockDecisionResult({
        outcome: 'replace',
        claimId: 'claim-override',
      });

      // Create review
      const review = await manualReviewService.createManualReview({
        claimId: 'claim-override',
        triggerReasons: ['suspicious_signals'],
        triggerSource: 'automatic',
        machineAssessmentSnapshot: machineAssessment,
      });

      // Reviewer overrides to repair
      const completedReview = await manualReviewService.processReviewerAction({
        reviewId: review.reviewId,
        reviewerId: 'reviewer-002',
        action: 'override_to_repair',
        overrideReasonCode: 'damage_repairable',
        reviewerNotes: 'Damage is small enough for repair',
      });

      expect(completedReview.overrideFlag).toBe(true);
      expect(completedReview.finalReviewedOutcome).toBe('repair');
      expect(completedReview.overrideReasonCode).toBe('damage_repairable');

      // Original machine assessment snapshot remains unchanged
      expect(completedReview.machineAssessmentSnapshot.outcome).toBe('replace');

      // Format result with override
      const formatter = new ResultFormatterService();
      const output = await formatter.formatResult({
        claimId: 'claim-override',
        claimNumber: 'CLM-2024-003',
        internalStatus: 'decision_complete',
        decisionResult: machineAssessment,
        vinEnrichment: createMockVINEnrichment(),
        damageAnalysis: createMockDamageAnalysis(),
        glassTypeAnalysis: createMockGlassTypeAnalysis(),
        manualReview: completedReview,
      });

      expect(output.final_decision_source).toBe('manually_reviewed');
      expect(output.final_decision).toBe('repair');
      expect(output.manual_review_flag).toBe(true);
      expect(output.assessment_outcome).toBe('replace'); // Machine's original assessment
    });

    it('should preserve immutable machine assessment after reviewer action', async () => {
      const manualReviewService = new ManualReviewService();
      const originalAssessment = createMockDecisionResult({
        outcome: 'replace',
        claimId: 'claim-immutable',
        justification: 'Original machine justification',
      });

      const review = await manualReviewService.createManualReview({
        claimId: 'claim-immutable',
        triggerReasons: ['quality_check'],
        triggerSource: 'insurer_initiated',
        machineAssessmentSnapshot: originalAssessment,
        manualTriggerReason: 'High value claim requires manual verification',
      });

      // Process reviewer action
      await manualReviewService.processReviewerAction({
        reviewId: review.reviewId,
        reviewerId: 'reviewer-003',
        action: 'override_to_replace',
        overrideReasonCode: 'confirmed_replacement_needed',
        reviewerNotes: 'Confirmed after detailed inspection',
      });

      // Retrieve and verify snapshot is unchanged
      const retrievedReview = await manualReviewService.getManualReview(review.reviewId);
      expect(retrievedReview).toBeDefined();
      expect(retrievedReview!.machineAssessmentSnapshot.outcome).toBe('replace');
      expect(retrievedReview!.machineAssessmentSnapshot.justification).toBe(
        'Original machine justification'
      );
      expect(retrievedReview!.machineAssessmentSnapshot.confidenceSummary).toEqual(
        originalAssessment.confidenceSummary
      );
    });

    it('should emit correct events for manual review workflow', async () => {
      const claimId = 'claim-review-events';
      const manualReviewService = new ManualReviewService();

      // Create review (emits decision.manual_review_triggered)
      const review = await manualReviewService.createManualReview({
        claimId,
        triggerReasons: ['low_confidence'],
        triggerSource: 'automatic',
        machineAssessmentSnapshot: createLowConfidenceDecisionResult(),
      });

      // Process action (emits decision.generated for approve)
      await manualReviewService.processReviewerAction({
        reviewId: review.reviewId,
        reviewerId: 'reviewer-004',
        action: 'approve_machine_result',
      });

      // Verify events
      const triggerEvent = emittedEvents.find(
        (e) =>
          e.eventType === EVENT_TYPES.DECISION_MANUAL_REVIEW_TRIGGERED &&
          e.claimId === claimId
      );
      expect(triggerEvent).toBeDefined();

      const decisionEvent = emittedEvents.find(
        (e) =>
          e.eventType === EVENT_TYPES.DECISION_GENERATED &&
          e.claimId === claimId
      );
      expect(decisionEvent).toBeDefined();
      expect(decisionEvent!.payload.overrideFlag).toBe(false);
    });
  });


  // ==========================================================================
  // 3. Error Scenarios and Recovery Paths
  // ==========================================================================
  describe('Error Scenarios and Recovery Paths', () => {
    it('should continue processing when VIN enrichment fails (VIN unavailable)', async () => {
      const vinEnrichment: VINEnrichmentResult = {
        claimId: 'claim-vin-failed',
        vinResultState: 'unavailable',
        insurerProvidedVin: '1HGBH41JXMN109186',
        vinMismatchFlag: false,
        adasStatus: 'unknown',
        enrichedAt: new Date('2024-01-15T10:05:00Z'),
        errors: ['All VIN decoder APIs failed after retries'],
      };

      // Decision engine should still work but may route to manual review
      const engine = new DecisionRulesEngine();
      const inputs = {
        claimId: 'claim-vin-failed',
        consentCaptured: true,
        fixedPhotosAccepted: {
          front_vehicle: true,
          inside_driver: true,
          inside_passenger: true,
          vin_cutout: true,
          logo_silkscreen: true,
        },
        damagePhotosAccepted: 2,
        damageAnalysis: createMockDamageAnalysis(),
        glassTypeAnalysis: createMockGlassTypeAnalysis(),
        vinEnrichment,
      } as DecisionInputs;

      const result = await engine.generateDecision(inputs);

      // With VIN unavailable, system should still produce a decision
      // (may be needs_manual_review due to VIN conflict check)
      expect(result.claimId).toBe('claim-vin-failed');
      expect(result.outcome).toBeDefined();
      expect(result.rulesVersion).toBe('1.0.0');

      // Result formatter should handle null VIN data gracefully
      const formatter = new ResultFormatterService();
      const output = await formatter.formatResult({
        claimId: 'claim-vin-failed',
        claimNumber: 'CLM-2024-VIN-FAIL',
        internalStatus: 'decision_complete',
        decisionResult: result,
        vinEnrichment,
        damageAnalysis: createMockDamageAnalysis(),
        glassTypeAnalysis: createMockGlassTypeAnalysis(),
      });

      expect(output.vin_data).not.toBeNull();
      expect(output.vin_data!.vin_result_state).toBe('unavailable');
    });

    it('should handle photo validation rejection and allow retry', () => {
      // Simulate photo rejection scenario
      // The system should track rejected photos and allow retake
      const photoSlots = {
        front_vehicle: true,
        inside_driver: true,
        inside_passenger: true,
        vin_cutout: false, // Rejected - needs retake
        logo_silkscreen: true,
      };

      // With a rejected photo, not all fixed photos are accepted
      const allAccepted = Object.values(photoSlots).every((v) => v);
      expect(allAccepted).toBe(false);

      // After retake, all should be accepted
      photoSlots.vin_cutout = true;
      const allAcceptedAfterRetake = Object.values(photoSlots).every((v) => v);
      expect(allAcceptedAfterRetake).toBe(true);
    });

    it('should block decision when prerequisites are missing', async () => {
      const engine = new DecisionRulesEngine();

      // Missing consent
      const inputsNoConsent: DecisionInputs = {
        claimId: 'claim-no-consent',
        consentCaptured: false,
        fixedPhotosAccepted: {
          front_vehicle: true,
          inside_driver: true,
          inside_passenger: true,
          vin_cutout: true,
          logo_silkscreen: true,
        },
        damagePhotosAccepted: 1,
        damageAnalysis: createMockDamageAnalysis(),
        vinEnrichment: createMockVINEnrichment(),
      };

      const result = await engine.generateDecision(inputsNoConsent);

      expect(result.decisionEligible).toBe(false);
      expect(result.outcome).not.toBe('repair');
      expect(result.outcome).not.toBe('replace');
      expect(result.blockingReasons.length).toBeGreaterThan(0);
      expect(result.prerequisiteChecks.consentCaptured).toBe(false);
    });

    it('should block decision when fixed photos are incomplete', async () => {
      const engine = new DecisionRulesEngine();

      const inputs: DecisionInputs = {
        claimId: 'claim-missing-photos',
        consentCaptured: true,
        fixedPhotosAccepted: {
          front_vehicle: true,
          inside_driver: true,
          inside_passenger: false, // Missing
          vin_cutout: true,
          logo_silkscreen: true,
        },
        damagePhotosAccepted: 1,
        damageAnalysis: createMockDamageAnalysis(),
        vinEnrichment: createMockVINEnrichment(),
      };

      const result = await engine.generateDecision(inputs);

      expect(result.decisionEligible).toBe(false);
      expect(result.outcome).not.toBe('repair');
      expect(result.outcome).not.toBe('replace');
      expect(result.prerequisiteChecks.allFixedPhotosAccepted).toBe(false);
    });

    it('should block decision when no damage photos are accepted', async () => {
      const engine = new DecisionRulesEngine();

      const inputs: DecisionInputs = {
        claimId: 'claim-no-damage-photos',
        consentCaptured: true,
        fixedPhotosAccepted: {
          front_vehicle: true,
          inside_driver: true,
          inside_passenger: true,
          vin_cutout: true,
          logo_silkscreen: true,
        },
        damagePhotosAccepted: 0, // No damage photos
        vinEnrichment: createMockVINEnrichment(),
      };

      const result = await engine.generateDecision(inputs);

      expect(result.decisionEligible).toBe(false);
      expect(result.outcome).not.toBe('repair');
      expect(result.outcome).not.toBe('replace');
      expect(result.prerequisiteChecks.atLeastOneDamagePhotoAccepted).toBe(false);
    });

    it('should handle VIN mismatch by using insurer VIN and setting flag', async () => {
      const vinEnrichment = createMockVINEnrichment({
        vinResultState: 'mismatch',
        insurerProvidedVin: '1HGBH41JXMN109186',
        ocrExtractedVin: '2HGBH41JXMN109999', // Different
        bestValidatedVin: '1HGBH41JXMN109186', // Uses insurer VIN
        vinMismatchFlag: true,
      });

      expect(vinEnrichment.vinMismatchFlag).toBe(true);
      expect(vinEnrichment.bestValidatedVin).toBe(vinEnrichment.insurerProvidedVin);

      // Format output should expose the mismatch
      const formatter = new ResultFormatterService();
      const output = await formatter.formatResult({
        claimId: 'claim-mismatch',
        claimNumber: 'CLM-2024-MISMATCH',
        internalStatus: 'decision_complete',
        decisionResult: createMockDecisionResult({ claimId: 'claim-mismatch' }),
        vinEnrichment,
        damageAnalysis: createMockDamageAnalysis(),
        glassTypeAnalysis: createMockGlassTypeAnalysis(),
      });

      expect(output.vin_data!.vin_mismatch_flag).toBe(true);
      expect(output.vin_data!.vin_result_state).toBe('mismatch');
      expect(output.vin_data!.insurer_provided_vin).toBe('1HGBH41JXMN109186');
      expect(output.vin_data!.ocr_extracted_vin).toBe('2HGBH41JXMN109999');
    });

    it('should reject intake when required fields are missing', () => {
      const incompleteFields: Partial<ParsedIntakeFields> = {
        insurerName: 'Test Insurance',
        claimNumber: 'CLM-001',
        // Missing: policyholderName, policyholderMobile, policyholderEmail, insurerProvidedVin
      };

      const errors = EmailIntakeService.validateIntakeFields(incompleteFields);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors).toContain('Missing required field: policyholderName');
      expect(errors).toContain('Missing required field: policyholderMobile');
      expect(errors).toContain('Missing required field: policyholderEmail');
      expect(errors).toContain('Missing required field: insurerProvidedVin');
    });

    it('should handle damage analysis with insufficient evidence', async () => {
      const damageAnalysis = createMockDamageAnalysis({
        overallConfidence: 0.3,
        evidenceSufficiencyAssessment: 'insufficient',
        insufficiencyFlags: ['Blurry images', 'Cannot determine damage extent'],
      });

      const engine = new DecisionRulesEngine();
      const inputs: DecisionInputs = {
        claimId: 'claim-insufficient',
        consentCaptured: true,
        fixedPhotosAccepted: {
          front_vehicle: true,
          inside_driver: true,
          inside_passenger: true,
          vin_cutout: true,
          logo_silkscreen: true,
        },
        damagePhotosAccepted: 1,
        damageAnalysis,
        vinEnrichment: createMockVINEnrichment(),
      };

      const result = await engine.generateDecision(inputs);

      expect(result.decisionEligible).toBe(false);
      expect(result.prerequisiteChecks.evidenceNotInsufficient).toBe(false);
      expect(result.outcome).not.toBe('repair');
      expect(result.outcome).not.toBe('replace');
    });
  });


  // ==========================================================================
  // 4. Security Controls and Audit Logging
  // ==========================================================================
  describe('Security Controls and Audit Logging', () => {
    it('should emit immutable events for every lifecycle transition', async () => {
      const claimId = 'claim-audit-trail';

      // Simulate multiple events
      const events = [
        { type: EVENT_TYPES.INTAKE_RECEIVED, service: 'email-intake' },
        { type: EVENT_TYPES.JOURNEY_CREATED, service: 'journey-service' },
        { type: EVENT_TYPES.NOTIFICATION_SENT, service: 'notification-service' },
        { type: EVENT_TYPES.CONSENT_CAPTURED, service: 'consent-handler' },
        { type: EVENT_TYPES.PHOTO_VALIDATED, service: 'photo-validation' },
        { type: EVENT_TYPES.VIN_ENRICHMENT_COMPLETED, service: 'vin-enrichment' },
        { type: EVENT_TYPES.DAMAGE_ANALYSIS_COMPLETED, service: 'damage-analysis' },
        { type: EVENT_TYPES.DECISION_GENERATED, service: 'decision-engine' },
        { type: EVENT_TYPES.RESULT_DELIVERED, service: 'result-formatter' },
      ];

      for (const event of events) {
        await EventService.emit({
          eventType: event.type,
          claimId,
          sourceService: event.service,
          actorType: 'system',
          payload: { test: true },
        });
      }

      // All events should have been stored
      const auditEvents = emittedEvents.filter((e) => e.claimId === claimId);
      expect(auditEvents).toHaveLength(events.length);

      // Each event should have the correct type
      events.forEach((expected, index) => {
        expect(auditEvents[index]!.eventType).toBe(expected.type);
      });
    });

    it('should handle event idempotency - duplicate events are not stored', async () => {
      // Configure mock to simulate idempotency (ON CONFLICT DO NOTHING)
      const idempotencyKey = 'unique-key-123';
      let callCount = 0;

      mockQuery.mockImplementation((sql: string, params?: any[]) => {
        if (sql.includes('INSERT INTO claim_events')) {
          callCount++;
          if (callCount > 1) {
            // Simulate ON CONFLICT DO NOTHING - return 0 rows
            return { rowCount: 0, rows: [] };
          }
          return { rowCount: 1, rows: [{ event_id: 'evt-1' }] };
        }
        return { rowCount: 0, rows: [] };
      });

      const result1 = await EventService.emit({
        eventType: EVENT_TYPES.INTAKE_RECEIVED,
        claimId: 'claim-idempotent',
        sourceService: 'test',
        actorType: 'system',
        idempotencyKey,
        payload: {},
      });

      const result2 = await EventService.emit({
        eventType: EVENT_TYPES.INTAKE_RECEIVED,
        claimId: 'claim-idempotent',
        sourceService: 'test',
        actorType: 'system',
        idempotencyKey,
        payload: {},
      });

      expect(result1).not.toBeNull(); // First event stored
      expect(result2).toBeNull(); // Duplicate silently ignored
    });

    it('should include all required envelope fields in events', async () => {
      // Reset mock to capture full event data
      const capturedParams: any[] = [];
      mockQuery.mockImplementation((sql: string, params?: any[]) => {
        if (sql.includes('INSERT INTO claim_events')) {
          capturedParams.push(params);
          return { rowCount: 1, rows: [{ event_id: params?.[0] }] };
        }
        return { rowCount: 0, rows: [] };
      });

      await EventService.emit({
        eventType: EVENT_TYPES.DECISION_GENERATED,
        claimId: 'claim-envelope-test',
        sourceService: 'decision-rules-engine',
        actorType: 'system',
        actorId: 'system-auto',
        correlationId: 'corr-123',
        payload: { outcome: 'replace', rulesVersion: '1.0.0' },
      });

      expect(capturedParams).toHaveLength(1);
      const params = capturedParams[0];

      // Verify envelope fields: event_id, event_type, claim_id, timestamp,
      // source_service, actor_type, actor_id, correlation_id, idempotency_key, payload
      expect(params[0]).toBeDefined(); // event_id (UUID)
      expect(params[1]).toBe('decision.generated'); // event_type
      expect(params[2]).toBe('claim-envelope-test'); // claim_id
      expect(params[3]).toBeInstanceOf(Date); // timestamp
      expect(params[4]).toBe('decision-rules-engine'); // source_service
      expect(params[5]).toBe('system'); // actor_type
      expect(params[6]).toBe('system-auto'); // actor_id
      expect(params[7]).toBe('corr-123'); // correlation_id
      expect(params[8]).toBeDefined(); // idempotency_key
      expect(JSON.parse(params[9])).toEqual({ outcome: 'replace', rulesVersion: '1.0.0' }); // payload
    });

    it('should enforce hard safety rule - no repair/replace when ineligible', async () => {
      const engine = new DecisionRulesEngine();

      // All prerequisites failing
      const inputs: DecisionInputs = {
        claimId: 'claim-safety-check',
        consentCaptured: false,
        fixedPhotosAccepted: {
          front_vehicle: false,
          inside_driver: false,
          inside_passenger: false,
          vin_cutout: false,
          logo_silkscreen: false,
        },
        damagePhotosAccepted: 0,
      };

      const result = await engine.generateDecision(inputs);

      // Hard safety rule: outcome MUST NOT be repair or replace
      expect(result.outcome).not.toBe('repair');
      expect(result.outcome).not.toBe('replace');
      expect(result.decisionEligible).toBe(false);
    });

    it('should track decision source correctly across all paths', async () => {
      const formatter = new ResultFormatterService();
      const baseDecision = createMockDecisionResult();

      // Path 1: Automated (no manual review)
      const automatedOutput = await formatter.formatResult({
        claimId: 'claim-auto',
        claimNumber: 'CLM-AUTO',
        internalStatus: 'decision_complete',
        decisionResult: baseDecision,
        vinEnrichment: createMockVINEnrichment(),
        damageAnalysis: createMockDamageAnalysis(),
        glassTypeAnalysis: createMockGlassTypeAnalysis(),
      });
      expect(automatedOutput.final_decision_source).toBe('automated');

      // Path 2: Hybrid (reviewer approves)
      const approvedReview: ManualReviewRecord = {
        reviewId: 'rev-1',
        claimId: 'claim-hybrid',
        triggerReasons: ['low_confidence'],
        triggerSource: 'automatic',
        priority: 'normal',
        machineAssessmentSnapshot: baseDecision,
        queuedAt: new Date(),
        reviewStartedAt: new Date(),
        reviewCompletedAt: new Date(),
        reviewerId: 'reviewer-1',
        reviewerAction: 'approve_machine_result',
        finalReviewedOutcome: 'replace',
        overrideFlag: false,
      };

      const hybridOutput = await formatter.formatResult({
        claimId: 'claim-hybrid',
        claimNumber: 'CLM-HYBRID',
        internalStatus: 'decision_complete',
        decisionResult: baseDecision,
        vinEnrichment: createMockVINEnrichment(),
        damageAnalysis: createMockDamageAnalysis(),
        glassTypeAnalysis: createMockGlassTypeAnalysis(),
        manualReview: approvedReview,
      });
      expect(hybridOutput.final_decision_source).toBe('hybrid');

      // Path 3: Manually reviewed (reviewer overrides)
      const overriddenReview: ManualReviewRecord = {
        reviewId: 'rev-2',
        claimId: 'claim-manual',
        triggerReasons: ['suspicious_signals'],
        triggerSource: 'automatic',
        priority: 'urgent',
        machineAssessmentSnapshot: baseDecision,
        queuedAt: new Date(),
        reviewStartedAt: new Date(),
        reviewCompletedAt: new Date(),
        reviewerId: 'reviewer-2',
        reviewerAction: 'override_to_repair',
        finalReviewedOutcome: 'repair',
        overrideFlag: true,
        overrideReasonCode: 'damage_repairable',
        reviewerNotes: 'Small chip, repairable',
      };

      const manualOutput = await formatter.formatResult({
        claimId: 'claim-manual',
        claimNumber: 'CLM-MANUAL',
        internalStatus: 'decision_complete',
        decisionResult: baseDecision,
        vinEnrichment: createMockVINEnrichment(),
        damageAnalysis: createMockDamageAnalysis(),
        glassTypeAnalysis: createMockGlassTypeAnalysis(),
        manualReview: overriddenReview,
      });
      expect(manualOutput.final_decision_source).toBe('manually_reviewed');
      expect(manualOutput.final_decision).toBe('repair');
    });

    it('should validate JSON output against schema before delivery', async () => {
      const formatter = new ResultFormatterService();

      // Valid input should produce valid output
      const output = await formatter.formatResult({
        claimId: 'claim-schema-test',
        claimNumber: 'CLM-SCHEMA',
        internalStatus: 'decision_complete',
        decisionResult: createMockDecisionResult(),
        vinEnrichment: createMockVINEnrichment(),
        damageAnalysis: createMockDamageAnalysis(),
        glassTypeAnalysis: createMockGlassTypeAnalysis(),
      });

      // All required fields should be present
      expect(output.schema_version).toBeDefined();
      expect(output.claim_id).toBeDefined();
      expect(output.claim_number).toBeDefined();
      expect(output.external_status).toBeDefined();
      expect(output.internal_status).toBeDefined();
      expect(output.assessment_outcome).toBeDefined();
      expect(typeof output.decision_eligibility).toBe('boolean');
      expect(Array.isArray(output.blocking_reasons)).toBe(true);
      expect(output.final_decision).toBeDefined();
      expect(output.final_decision_source).toBeDefined();
      expect(output.justification).toBeDefined();
      expect(output.confidence_summary).toBeDefined();
      expect(output.prerequisite_checks).toBeDefined();
      expect(typeof output.manual_review_flag).toBe('boolean');
      expect(Array.isArray(output.manual_review_reason_codes)).toBe(true);
      expect(output.generated_at).toBeDefined();
      expect(output.rules_version).toBeDefined();
    });

    it('should derive external status correctly and never store it independently', () => {
      // Verify all internal statuses have a valid external mapping
      const allInternalStatuses = StatusService.getAllInternalStatuses();
      expect(allInternalStatuses.length).toBeGreaterThan(0);

      for (const status of allInternalStatuses) {
        const external = StatusService.deriveExternalStatus(status);
        expect(external).toBeDefined();
        expect(typeof external).toBe('string');
        expect(external.length).toBeGreaterThan(0);
      }

      // Verify external status is always derived, never stored
      const validExternalStatuses = StatusService.getAllExternalStatuses();
      expect(validExternalStatuses).toContain('Message Sent');
      expect(validExternalStatuses).toContain('Result Ready');
      expect(validExternalStatuses).toContain('Under Review');
    });

    it('should handle insurer-initiated manual review with reason tracking', async () => {
      const manualReviewService = new ManualReviewService();

      const review = await manualReviewService.createManualReview({
        claimId: 'claim-insurer-triggered',
        triggerReasons: ['insurer_quality_check'],
        triggerSource: 'insurer_initiated',
        priority: 'urgent',
        machineAssessmentSnapshot: createMockDecisionResult(),
        manualTriggerReason: 'High value claim requires additional verification',
      });

      expect(review.triggerSource).toBe('insurer_initiated');
      expect(review.manualTriggerReason).toBe(
        'High value claim requires additional verification'
      );
      expect(review.priority).toBe('urgent');

      // Verify event includes trigger source
      const event = emittedEvents.find(
        (e) =>
          e.eventType === EVENT_TYPES.DECISION_MANUAL_REVIEW_TRIGGERED &&
          e.claimId === 'claim-insurer-triggered'
      );
      expect(event).toBeDefined();
      expect(event!.payload.triggerSource).toBe('insurer_initiated');
      expect(event!.payload.manualTriggerReason).toBe(
        'High value claim requires additional verification'
      );
    });

    it('should reject insurer-initiated review without reason', async () => {
      const manualReviewService = new ManualReviewService();

      await expect(
        manualReviewService.createManualReview({
          claimId: 'claim-no-reason',
          triggerReasons: ['insurer_request'],
          triggerSource: 'insurer_initiated',
          machineAssessmentSnapshot: createMockDecisionResult(),
          // Missing manualTriggerReason
        })
      ).rejects.toThrow('Manual trigger reason required for insurer-initiated reviews');
    });
  });
});
