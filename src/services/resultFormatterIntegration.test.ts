/**
 * Result Formatter Service - Integration Tests
 *
 * Tests the insurer JSON output contract completeness, decision source derivation,
 * and schema validation as an integration-level concern.
 *
 * Validates Requirements: 12.2, 12.4
 */

import {
  ResultFormatterService,
  InsurerJsonOutput,
  ResultFormatterInput,
  insurerOutputSchema,
} from './resultFormatterService';
import { DecisionResult, DecisionOutcome } from './decisionRulesEngine';
import { ManualReviewRecord } from './manualReviewService';
import { VINEnrichmentResult } from './vinEnrichmentService';
import { DamageAnalysisResult } from './damageAnalysisService';
import { GlassTypeAnalysisResult } from './glassTypeAnalysisService';

// Mock EventService
jest.mock('./eventService', () => ({
  EventService: {
    emit: jest.fn().mockResolvedValue('event-id-123'),
  },
  EVENT_TYPES: {
    RESULT_DELIVERED: 'result.delivered',
  },
}));

// Mock config
jest.mock('../config', () => ({
  config: {
    assessment: {
      rulesVersion: '1.0.0',
    },
    damageAnalysis: {
      confidenceThreshold: 0.7,
    },
  },
}));

// Mock logger
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

describe('ResultFormatterService - Integration Tests', () => {
  let service: ResultFormatterService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ResultFormatterService();
  });

  // --- Test Data Factories ---

  const createFullDecisionResult = (): DecisionResult => ({
    claimId: 'claim-int-001',
    outcome: 'repair',
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
    justification: 'Repair: Single bullseye chip ~0.6" diameter, outside DPVA, no edge cracks',
    confidenceSummary: { damageAnalysis: 0.88, vinOcr: 0.96 },
    rulesVersion: '1.0.0',
    generatedAt: new Date('2024-02-01T12:00:00Z'),
  });

  const createFullVinEnrichment = (): VINEnrichmentResult => ({
    claimId: 'claim-int-001',
    vinResultState: 'validated',
    insurerProvidedVin: 'WBA3A5C55DF123456',
    ocrExtractedVin: 'WBA3A5C55DF123456',
    ocrConfidenceScore: 0.97,
    bestValidatedVin: 'WBA3A5C55DF123456',
    vinMismatchFlag: false,
    decoderUsed: 'bayanaty',
    vehicleData: {
      make: 'BMW',
      model: '3 Series',
      year: 2013,
      bodyType: 'Sedan',
      color: 'Alpine White',
    },
    adasStatus: 'yes',
    adasFeatures: ['Lane Departure Warning', 'Forward Collision Warning', 'Automatic Emergency Braking'],
    enrichedAt: new Date('2024-02-01T11:55:00Z'),
  });

  const createFullDamageAnalysis = (): DamageAnalysisResult => ({
    claimId: 'claim-int-001',
    damagePoints: [
      {
        affectedRegion: 'driver_side_lower',
        severityAttributes: {
          damageType: 'bullseye',
          estimatedDiameterInches: 0.6,
          inDPVA: false,
          repairEligible: true,
          repairBlockingReasons: [],
        },
        glassObservations: ['clean_outer_surface_damage', 'no_edge_cracks'],
      },
    ],
    overallConfidence: 0.88,
    uncertaintyIndicators: [],
    insufficiencyFlags: [],
    evidenceSufficiencyAssessment: 'sufficient',
    analysedAt: new Date('2024-02-01T11:58:00Z'),
  });

  const createFullGlassTypeAnalysis = (): GlassTypeAnalysisResult => ({
    claimId: 'claim-int-001',
    glassManufacturer: 'Pilkington',
    vehicleManufacturerLogo: 'BMW',
    glassType: 'oem',
    confidence: 0.94,
    uncertaintyIndicators: [],
    analysedAt: new Date('2024-02-01T11:57:00Z'),
  });

  const createCompletedManualReview = (overrides?: Partial<ManualReviewRecord>): ManualReviewRecord => ({
    reviewId: 'review-int-001',
    claimId: 'claim-int-001',
    triggerReasons: ['low_confidence'],
    triggerSource: 'automatic',
    priority: 'normal',
    machineAssessmentSnapshot: createFullDecisionResult(),
    queuedAt: new Date('2024-02-01T12:00:00Z'),
    reviewStartedAt: new Date('2024-02-01T12:05:00Z'),
    reviewCompletedAt: new Date('2024-02-01T12:10:00Z'),
    reviewerId: 'reviewer-int-001',
    reviewerAction: 'approve_machine_result',
    finalReviewedOutcome: 'repair',
    overrideFlag: false,
    ...overrides,
  });

  // --- 1. Output Contract Completeness ---

  describe('Output Contract Completeness (Requirement 12.2)', () => {
    it('should produce a complete JSON output with every required field populated for a full claim', async () => {
      const input: ResultFormatterInput = {
        claimId: 'claim-int-001',
        claimNumber: 'CLM-INT-2024-001',
        internalStatus: 'decision_complete',
        decisionResult: createFullDecisionResult(),
        vinEnrichment: createFullVinEnrichment(),
        damageAnalysis: createFullDamageAnalysis(),
        glassTypeAnalysis: createFullGlassTypeAnalysis(),
      };

      const result = await service.formatResult(input);

      // All top-level required fields must be present and non-null
      expect(result.schema_version).toBe('1.0.0');
      expect(result.claim_id).toBe('claim-int-001');
      expect(result.claim_number).toBe('CLM-INT-2024-001');
      expect(result.external_status).toBeDefined();
      expect(result.external_status.length).toBeGreaterThan(0);
      expect(result.internal_status).toBe('decision_complete');
      expect(result.assessment_outcome).toBe('repair');
      expect(result.decision_eligibility).toBe(true);
      expect(Array.isArray(result.blocking_reasons)).toBe(true);
      expect(result.final_decision).toBe('repair');
      expect(result.final_decision_source).toBe('automated');
      expect(result.justification.length).toBeGreaterThan(0);
      expect(result.confidence_summary).toEqual({ damageAnalysis: 0.88, vinOcr: 0.96 });
      expect(result.prerequisite_checks).toBeDefined();
      expect(result.generated_at).toBeDefined();
      expect(result.rules_version).toBe('1.0.0');

      // VIN data section populated
      expect(result.vin_data).not.toBeNull();
      expect(result.vin_data!.vin_result_state).toBe('validated');
      expect(result.vin_data!.vehicle_data).toBeDefined();
      expect(result.vin_data!.vehicle_data!.make).toBe('BMW');
      expect(result.vin_data!.vehicle_data!.model).toBe('3 Series');
      expect(result.vin_data!.adas_status).toBe('yes');
      expect(result.vin_data!.adas_features).toHaveLength(3);

      // Damage summary section populated
      expect(result.damage_summary).not.toBeNull();
      expect(result.damage_summary!.damage_points).toHaveLength(1);
      expect(result.damage_summary!.overall_confidence).toBe(0.88);
      expect(result.damage_summary!.analysed_at).toBeDefined();

      // Glass type summary section populated
      expect(result.glass_type_summary).not.toBeNull();
      expect(result.glass_type_summary!.glass_type).toBe('oem');
      expect(result.glass_type_summary!.glass_manufacturer).toBe('Pilkington');
      expect(result.glass_type_summary!.confidence).toBe(0.94);
    });

    it('should produce a valid output with null sections when claim has minimal data', async () => {
      const input: ResultFormatterInput = {
        claimId: 'claim-int-002',
        claimNumber: 'CLM-INT-2024-002',
        internalStatus: 'decision_complete',
        decisionResult: createFullDecisionResult(),
        // No VIN enrichment, no damage analysis, no glass type
      };

      const result = await service.formatResult(input);

      // Core fields still present
      expect(result.schema_version).toBe('1.0.0');
      expect(result.claim_id).toBe('claim-int-002');
      expect(result.claim_number).toBe('CLM-INT-2024-002');
      expect(result.final_decision).toBe('repair');
      expect(result.final_decision_source).toBe('automated');
      expect(result.generated_at).toBeDefined();
      expect(result.rules_version).toBe('1.0.0');

      // Optional sections are null (not undefined)
      expect(result.vin_data).toBeNull();
      expect(result.damage_summary).toBeNull();
      expect(result.glass_type_summary).toBeNull();

      // Output still passes schema validation (no throw)
      const { error } = insurerOutputSchema.validate(result, { abortEarly: false });
      expect(error).toBeUndefined();
    });

    it('should always include schema_version matching expected version', async () => {
      const input: ResultFormatterInput = {
        claimId: 'claim-int-003',
        claimNumber: 'CLM-INT-2024-003',
        internalStatus: 'result_delivered',
        decisionResult: createFullDecisionResult(),
      };

      const result = await service.formatResult(input);

      expect(result.schema_version).toBe('1.0.0');
      expect(typeof result.schema_version).toBe('string');
    });
  });

  // --- 2. Decision Source Derivation (Requirement 12.4) ---

  describe('Decision Source Derivation (Requirement 12.4)', () => {
    it('should set final_decision_source to "automated" when no manual review exists', async () => {
      const input: ResultFormatterInput = {
        claimId: 'claim-int-010',
        claimNumber: 'CLM-INT-2024-010',
        internalStatus: 'decision_complete',
        decisionResult: createFullDecisionResult(),
        vinEnrichment: createFullVinEnrichment(),
        damageAnalysis: createFullDamageAnalysis(),
      };

      const result = await service.formatResult(input);

      expect(result.final_decision_source).toBe('automated');
      expect(result.manual_review_flag).toBe(false);
      expect(result.manual_review_reason_codes).toEqual([]);
    });

    it('should set final_decision_source to "hybrid" when reviewer approved machine result', async () => {
      const manualReview = createCompletedManualReview({
        reviewerAction: 'approve_machine_result',
        finalReviewedOutcome: 'repair',
        overrideFlag: false,
      });

      const input: ResultFormatterInput = {
        claimId: 'claim-int-011',
        claimNumber: 'CLM-INT-2024-011',
        internalStatus: 'decision_complete',
        decisionResult: createFullDecisionResult(),
        vinEnrichment: createFullVinEnrichment(),
        damageAnalysis: createFullDamageAnalysis(),
        manualReview,
      };

      const result = await service.formatResult(input);

      expect(result.final_decision_source).toBe('hybrid');
      expect(result.final_decision).toBe('repair');
      expect(result.manual_review_flag).toBe(true);
      expect(result.manual_review_reason_codes).toContain('low_confidence');
    });

    it('should set final_decision_source to "manually_reviewed" when reviewer overrode', async () => {
      const manualReview = createCompletedManualReview({
        reviewerAction: 'override_to_replace',
        finalReviewedOutcome: 'replace',
        overrideFlag: true,
        overrideReasonCode: 'damage_extends_to_edge',
        reviewerNotes: 'Crack extends to windscreen edge, replacement required',
      });

      const input: ResultFormatterInput = {
        claimId: 'claim-int-012',
        claimNumber: 'CLM-INT-2024-012',
        internalStatus: 'decision_complete',
        decisionResult: createFullDecisionResult(),
        vinEnrichment: createFullVinEnrichment(),
        damageAnalysis: createFullDamageAnalysis(),
        manualReview,
      };

      const result = await service.formatResult(input);

      expect(result.final_decision_source).toBe('manually_reviewed');
      expect(result.final_decision).toBe('replace');
      expect(result.justification).toContain('Reviewer override');
      expect(result.justification).toContain('Crack extends to windscreen edge');
      expect(result.manual_review_flag).toBe(true);
    });

    it('should set final_decision_source to "automated" when manual review is queued but not completed', async () => {
      // Incomplete manual review: queued but reviewCompletedAt is undefined
      const incompleteReview: ManualReviewRecord = {
        reviewId: 'review-int-incomplete',
        claimId: 'claim-int-013',
        triggerReasons: ['vin_mismatch', 'low_confidence'],
        triggerSource: 'automatic',
        priority: 'normal',
        machineAssessmentSnapshot: createFullDecisionResult(),
        queuedAt: new Date('2024-02-01T12:00:00Z'),
        // No reviewStartedAt, no reviewCompletedAt
        overrideFlag: false,
      };

      const input: ResultFormatterInput = {
        claimId: 'claim-int-013',
        claimNumber: 'CLM-INT-2024-013',
        internalStatus: 'decision_complete',
        decisionResult: createFullDecisionResult(),
        manualReview: incompleteReview,
      };

      const result = await service.formatResult(input);

      // Since review is not completed, decision source should be automated
      expect(result.final_decision_source).toBe('automated');
      // But manual_review_flag is still true because a review record exists
      expect(result.manual_review_flag).toBe(true);
      expect(result.manual_review_reason_codes).toEqual(['vin_mismatch', 'low_confidence']);
    });
  });

  // --- 3. Schema Validation ---

  describe('Schema Validation (Requirement 12.3)', () => {
    it('should produce output that passes Joi schema validation', async () => {
      const input: ResultFormatterInput = {
        claimId: 'claim-int-020',
        claimNumber: 'CLM-INT-2024-020',
        internalStatus: 'decision_complete',
        decisionResult: createFullDecisionResult(),
        vinEnrichment: createFullVinEnrichment(),
        damageAnalysis: createFullDamageAnalysis(),
        glassTypeAnalysis: createFullGlassTypeAnalysis(),
      };

      const result = await service.formatResult(input);

      // Validate the output against the exported Joi schema
      const { error } = insurerOutputSchema.validate(result, { abortEarly: false });
      expect(error).toBeUndefined();
    });

    it('should fail validation when required fields are missing', () => {
      // Construct an incomplete output manually (bypassing the service)
      const incompleteOutput = {
        schema_version: '1.0.0',
        claim_id: 'claim-int-021',
        // Missing: claim_number, external_status, internal_status, etc.
      };

      const { error } = insurerOutputSchema.validate(incompleteOutput, { abortEarly: false });

      expect(error).toBeDefined();
      expect(error!.details.length).toBeGreaterThan(0);

      // Should report missing required fields
      const missingFields = error!.details.map((d) => d.path.join('.'));
      expect(missingFields).toContain('claim_number');
      expect(missingFields).toContain('internal_status');
      expect(missingFields).toContain('final_decision');
      expect(missingFields).toContain('final_decision_source');
    });

    it('should fail validation when final_decision has an invalid value', () => {
      const invalidOutput: Record<string, unknown> = {
        schema_version: '1.0.0',
        claim_id: 'claim-int-022',
        claim_number: 'CLM-INT-2024-022',
        external_status: 'Result Ready',
        internal_status: 'decision_complete',
        assessment_outcome: 'repair',
        decision_eligibility: true,
        blocking_reasons: [],
        final_decision: 'invalid_decision_value', // Invalid
        final_decision_source: 'automated',
        justification: 'Test justification',
        confidence_summary: { damageAnalysis: 0.85 },
        prerequisite_checks: {
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
        vin_data: null,
        damage_summary: null,
        glass_type_summary: null,
        manual_review_flag: false,
        manual_review_reason_codes: [],
        generated_at: new Date().toISOString(),
        rules_version: '1.0.0',
      };

      const { error } = insurerOutputSchema.validate(invalidOutput, { abortEarly: false });

      expect(error).toBeDefined();
      const messages = error!.details.map((d) => d.message);
      expect(messages.some((m) => m.includes('final_decision'))).toBe(true);
    });

    it('should fail validation when final_decision_source has an invalid value', () => {
      const invalidOutput: Record<string, unknown> = {
        schema_version: '1.0.0',
        claim_id: 'claim-int-023',
        claim_number: 'CLM-INT-2024-023',
        external_status: 'Result Ready',
        internal_status: 'decision_complete',
        assessment_outcome: 'repair',
        decision_eligibility: true,
        blocking_reasons: [],
        final_decision: 'repair',
        final_decision_source: 'invalid_source', // Invalid
        justification: 'Test justification',
        confidence_summary: { damageAnalysis: 0.85 },
        prerequisite_checks: {
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
        vin_data: null,
        damage_summary: null,
        glass_type_summary: null,
        manual_review_flag: false,
        manual_review_reason_codes: [],
        generated_at: new Date().toISOString(),
        rules_version: '1.0.0',
      };

      const { error } = insurerOutputSchema.validate(invalidOutput, { abortEarly: false });

      expect(error).toBeDefined();
      const messages = error!.details.map((d) => d.message);
      expect(messages.some((m) => m.includes('final_decision_source'))).toBe(true);
    });
  });
});
