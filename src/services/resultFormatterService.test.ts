/**
 * Result Formatter Service Tests
 * 
 * Tests for the insurer JSON output contract including:
 * - Complete output formatting with all required fields
 * - Schema validation
 * - Decision source tracking (automated/manually_reviewed/hybrid)
 * - Blocking reasons and prerequisite check results
 * - VIN data, damage summary, and glass type formatting
 * - Event emission on result delivery
 */

import { ResultFormatterService, InsurerJsonOutput, ResultFormatterInput } from './resultFormatterService';
import { DecisionResult, DecisionPrerequisiteChecks } from './decisionRulesEngine';
import { ManualReviewRecord } from './manualReviewService';
import { VINEnrichmentResult } from './vinEnrichmentService';
import { DamageAnalysisResult } from './damageAnalysisService';
import { GlassTypeAnalysisResult } from './glassTypeAnalysisService';
import { EventService } from './eventService';

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

describe('ResultFormatterService', () => {
  let service: ResultFormatterService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ResultFormatterService();
  });

  // Helper: Create a valid decision result
  const createDecisionResult = (overrides?: Partial<DecisionResult>): DecisionResult => ({
    claimId: 'claim-001',
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
    justification: 'Repair: Bullseye ~0.8" diameter, outside DPVA',
    confidenceSummary: { damageAnalysis: 0.85, vinOcr: 0.95 },
    rulesVersion: '1.0.0',
    generatedAt: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  });

  // Helper: Create VIN enrichment result
  const createVinEnrichment = (overrides?: Partial<VINEnrichmentResult>): VINEnrichmentResult => ({
    claimId: 'claim-001',
    vinResultState: 'validated',
    insurerProvidedVin: 'AAVZZZ6SZEU024494',
    ocrExtractedVin: 'AAVZZZ6SZEU024494',
    ocrConfidenceScore: 0.95,
    bestValidatedVin: 'AAVZZZ6SZEU024494',
    vinMismatchFlag: false,
    decoderUsed: 'lightstone',
    vehicleData: {
      make: 'Volkswagen',
      model: 'Polo Vivo',
      year: 2014,
      color: 'White',
    },
    adasStatus: 'no',
    enrichedAt: new Date('2024-01-15T09:55:00Z'),
    ...overrides,
  });

  // Helper: Create damage analysis result
  const createDamageAnalysis = (overrides?: Partial<DamageAnalysisResult>): DamageAnalysisResult => ({
    claimId: 'claim-001',
    damagePoints: [
      {
        affectedRegion: 'passenger_side_upper',
        severityAttributes: {
          damageType: 'bullseye',
          estimatedDiameterInches: 0.8,
          inDPVA: false,
          repairEligible: true,
          repairBlockingReasons: [],
        },
        glassObservations: ['clean_outer_surface_damage'],
      },
    ],
    overallConfidence: 0.85,
    uncertaintyIndicators: [],
    insufficiencyFlags: [],
    evidenceSufficiencyAssessment: 'sufficient',
    analysedAt: new Date('2024-01-15T09:58:00Z'),
    ...overrides,
  });

  // Helper: Create glass type analysis result
  const createGlassTypeAnalysis = (overrides?: Partial<GlassTypeAnalysisResult>): GlassTypeAnalysisResult => ({
    claimId: 'claim-001',
    glassManufacturer: 'AGC',
    vehicleManufacturerLogo: 'Volkswagen',
    glassType: 'oem',
    confidence: 0.92,
    uncertaintyIndicators: [],
    analysedAt: new Date('2024-01-15T09:57:00Z'),
    ...overrides,
  });

  // Helper: Create manual review record
  const createManualReview = (overrides?: Partial<ManualReviewRecord>): ManualReviewRecord => ({
    reviewId: 'review-001',
    claimId: 'claim-001',
    triggerReasons: ['low_confidence'],
    triggerSource: 'automatic',
    priority: 'normal',
    machineAssessmentSnapshot: createDecisionResult({ outcome: 'needs_manual_review' }),
    queuedAt: new Date('2024-01-15T10:00:00Z'),
    reviewStartedAt: new Date('2024-01-15T10:05:00Z'),
    reviewCompletedAt: new Date('2024-01-15T10:10:00Z'),
    reviewerId: 'reviewer-001',
    reviewerAction: 'approve_machine_result',
    finalReviewedOutcome: 'repair',
    overrideFlag: false,
    ...overrides,
  });

  // Helper: Create full formatter input
  const createFormatterInput = (overrides?: Partial<ResultFormatterInput>): ResultFormatterInput => ({
    claimId: 'claim-001',
    claimNumber: 'CLM-2024-001',
    internalStatus: 'decision_complete',
    decisionResult: createDecisionResult(),
    vinEnrichment: createVinEnrichment(),
    damageAnalysis: createDamageAnalysis(),
    glassTypeAnalysis: createGlassTypeAnalysis(),
    ...overrides,
  });

  describe('formatResult - Complete Output', () => {
    it('should produce a complete JSON output with all required fields', async () => {
      const input = createFormatterInput();
      const result = await service.formatResult(input);

      // Verify all required fields from Requirement 12.2
      expect(result.schema_version).toBe('1.0.0');
      expect(result.claim_id).toBe('claim-001');
      expect(result.claim_number).toBe('CLM-2024-001');
      expect(result.external_status).toBe('Result Ready');
      expect(result.internal_status).toBe('decision_complete');
      expect(result.assessment_outcome).toBe('repair');
      expect(result.decision_eligibility).toBe(true);
      expect(result.blocking_reasons).toEqual([]);
      expect(result.final_decision).toBe('repair');
      expect(result.final_decision_source).toBe('automated');
      expect(result.justification).toContain('Repair');
      expect(result.confidence_summary).toEqual({ damageAnalysis: 0.85, vinOcr: 0.95 });
      expect(result.prerequisite_checks).toBeDefined();
      expect(result.vin_data).not.toBeNull();
      expect(result.damage_summary).not.toBeNull();
      expect(result.glass_type_summary).not.toBeNull();
      expect(result.manual_review_flag).toBe(false);
      expect(result.manual_review_reason_codes).toEqual([]);
      expect(result.generated_at).toBeDefined();
      expect(result.rules_version).toBe('1.0.0');
    });

    it('should include valid ISO 8601 generated_at timestamp', async () => {
      const input = createFormatterInput();
      const result = await service.formatResult(input);

      const parsedDate = new Date(result.generated_at);
      expect(parsedDate.toISOString()).toBe(result.generated_at);
    });

    it('should handle missing optional data gracefully', async () => {
      const input: ResultFormatterInput = {
        claimId: 'claim-001',
        claimNumber: 'CLM-2024-001',
        internalStatus: 'decision_complete',
        decisionResult: createDecisionResult(),
      };

      const result = await service.formatResult(input);

      expect(result.vin_data).toBeNull();
      expect(result.damage_summary).toBeNull();
      expect(result.glass_type_summary).toBeNull();
    });
  });

  describe('Decision Source Tracking', () => {
    it('should set source to "automated" when no manual review', async () => {
      const input: ResultFormatterInput = {
        claimId: 'claim-001',
        claimNumber: 'CLM-2024-001',
        internalStatus: 'decision_complete',
        decisionResult: createDecisionResult(),
        vinEnrichment: createVinEnrichment(),
        damageAnalysis: createDamageAnalysis(),
        glassTypeAnalysis: createGlassTypeAnalysis(),
      };
      const result = await service.formatResult(input);

      expect(result.final_decision_source).toBe('automated');
      expect(result.final_decision).toBe('repair');
      expect(result.manual_review_flag).toBe(false);
    });

    it('should set source to "hybrid" when reviewer approved machine result', async () => {
      const manualReview = createManualReview({
        reviewerAction: 'approve_machine_result',
        finalReviewedOutcome: 'repair',
        overrideFlag: false,
      });

      const input = createFormatterInput({ manualReview });
      const result = await service.formatResult(input);

      expect(result.final_decision_source).toBe('hybrid');
      expect(result.final_decision).toBe('repair');
      expect(result.manual_review_flag).toBe(true);
      expect(result.manual_review_reason_codes).toEqual(['low_confidence']);
    });

    it('should set source to "manually_reviewed" when reviewer overrode', async () => {
      const manualReview = createManualReview({
        reviewerAction: 'override_to_replace',
        finalReviewedOutcome: 'replace',
        overrideFlag: true,
        overrideReasonCode: 'damage_worse_than_assessed',
        reviewerNotes: 'Damage extends into DPVA on closer inspection',
      });

      const input = createFormatterInput({ manualReview });
      const result = await service.formatResult(input);

      expect(result.final_decision_source).toBe('manually_reviewed');
      expect(result.final_decision).toBe('replace');
      expect(result.justification).toContain('Reviewer override');
      expect(result.justification).toContain('Damage extends into DPVA');
      expect(result.manual_review_flag).toBe(true);
    });

    it('should use override reason code in justification when no notes', async () => {
      const manualReview = createManualReview({
        reviewerAction: 'override_to_repair',
        finalReviewedOutcome: 'repair',
        overrideFlag: true,
        overrideReasonCode: 'damage_smaller_than_assessed',
      });

      const input = createFormatterInput({ manualReview });
      const result = await service.formatResult(input);

      expect(result.final_decision_source).toBe('manually_reviewed');
      expect(result.justification).toContain('damage_smaller_than_assessed');
    });

    it('should treat incomplete manual review as automated', async () => {
      const manualReview: ManualReviewRecord = {
        reviewId: 'review-001',
        claimId: 'claim-001',
        triggerReasons: ['low_confidence'],
        triggerSource: 'automatic',
        priority: 'normal',
        machineAssessmentSnapshot: createDecisionResult({ outcome: 'needs_manual_review' }),
        queuedAt: new Date('2024-01-15T10:00:00Z'),
        overrideFlag: false,
      };

      const input = createFormatterInput({ manualReview });
      const result = await service.formatResult(input);

      expect(result.final_decision_source).toBe('automated');
      expect(result.manual_review_flag).toBe(true); // Still flagged as having a review record
    });
  });

  describe('Blocking Reasons and Prerequisite Checks', () => {
    it('should include blocking reasons when decision is ineligible', async () => {
      const decisionResult = createDecisionResult({
        outcome: 'needs_manual_review',
        decisionEligible: false,
        blockingReasons: ['low_confidence', 'vin_mismatch'],
        prerequisiteChecks: {
          consentCaptured: true,
          allFixedPhotosAccepted: true,
          atLeastOneDamagePhotoAccepted: true,
          evidenceNotInsufficient: true,
          structuredDamageOutputPresent: true,
          noUnresolvedVinConflict: false,
          noBlockingOperationalFlags: true,
          confidenceThresholdsMet: false,
          noMandatoryManualReviewTrigger: true,
        },
      });

      const input = createFormatterInput({ decisionResult });
      const result = await service.formatResult(input);

      expect(result.decision_eligibility).toBe(false);
      expect(result.blocking_reasons).toEqual(['low_confidence', 'vin_mismatch']);
      expect(result.prerequisite_checks.noUnresolvedVinConflict).toBe(false);
      expect(result.prerequisite_checks.confidenceThresholdsMet).toBe(false);
    });

    it('should include all prerequisite check results', async () => {
      const input = createFormatterInput();
      const result = await service.formatResult(input);

      const checks = result.prerequisite_checks;
      expect(checks).toHaveProperty('consentCaptured');
      expect(checks).toHaveProperty('allFixedPhotosAccepted');
      expect(checks).toHaveProperty('atLeastOneDamagePhotoAccepted');
      expect(checks).toHaveProperty('evidenceNotInsufficient');
      expect(checks).toHaveProperty('structuredDamageOutputPresent');
      expect(checks).toHaveProperty('noUnresolvedVinConflict');
      expect(checks).toHaveProperty('noBlockingOperationalFlags');
      expect(checks).toHaveProperty('confidenceThresholdsMet');
      expect(checks).toHaveProperty('noMandatoryManualReviewTrigger');
    });
  });

  describe('Schema Validation', () => {
    it('should pass validation for a complete valid output', async () => {
      const input = createFormatterInput();
      // Should not throw
      const result = await service.formatResult(input);
      expect(result).toBeDefined();
    });

    it('should pass validation with null optional sections', async () => {
      const input: ResultFormatterInput = {
        claimId: 'claim-001',
        claimNumber: 'CLM-2024-001',
        internalStatus: 'decision_complete',
        decisionResult: createDecisionResult(),
      };

      const result = await service.formatResult(input);
      expect(result.vin_data).toBeNull();
      expect(result.damage_summary).toBeNull();
      expect(result.glass_type_summary).toBeNull();
    });

    it('should validate final_decision is a valid outcome', async () => {
      const input = createFormatterInput();
      const result = await service.formatResult(input);

      const validOutcomes = ['repair', 'replace', 'needs_manual_review', 'insufficient_evidence', 'unable_to_assess'];
      expect(validOutcomes).toContain(result.final_decision);
    });

    it('should validate final_decision_source is a valid source', async () => {
      const input = createFormatterInput();
      const result = await service.formatResult(input);

      const validSources = ['automated', 'manually_reviewed', 'hybrid'];
      expect(validSources).toContain(result.final_decision_source);
    });
  });

  describe('VIN Data Formatting', () => {
    it('should format VIN data with all fields', async () => {
      const input = createFormatterInput();
      const result = await service.formatResult(input);

      expect(result.vin_data).not.toBeNull();
      expect(result.vin_data!.vin_result_state).toBe('validated');
      expect(result.vin_data!.insurer_provided_vin).toBe('AAVZZZ6SZEU024494');
      expect(result.vin_data!.ocr_extracted_vin).toBe('AAVZZZ6SZEU024494');
      expect(result.vin_data!.ocr_confidence_score).toBe(0.95);
      expect(result.vin_data!.best_validated_vin).toBe('AAVZZZ6SZEU024494');
      expect(result.vin_data!.vin_mismatch_flag).toBe(false);
      expect(result.vin_data!.decoder_used).toBe('lightstone');
      expect(result.vin_data!.vehicle_data).toEqual({
        make: 'Volkswagen',
        model: 'Polo Vivo',
        year: 2014,
        color: 'White',
      });
      expect(result.vin_data!.adas_status).toBe('no');
    });

    it('should include ADAS features when present', async () => {
      const vinEnrichment = createVinEnrichment({
        adasStatus: 'yes',
        adasFeatures: ['Lane Departure Warning', 'Forward Collision Warning'],
      });

      const input = createFormatterInput({ vinEnrichment });
      const result = await service.formatResult(input);

      expect(result.vin_data!.adas_status).toBe('yes');
      expect(result.vin_data!.adas_features).toEqual([
        'Lane Departure Warning',
        'Forward Collision Warning',
      ]);
    });

    it('should handle VIN enrichment with minimal data', async () => {
      const vinEnrichment: VINEnrichmentResult = {
        claimId: 'claim-001',
        vinResultState: 'unavailable',
        vinMismatchFlag: false,
        adasStatus: 'unknown',
        enrichedAt: new Date('2024-01-15T09:55:00Z'),
      };

      const input = createFormatterInput({ vinEnrichment });
      const result = await service.formatResult(input);

      expect(result.vin_data!.vin_result_state).toBe('unavailable');
      expect(result.vin_data!.vin_mismatch_flag).toBe(false);
      expect(result.vin_data!.adas_status).toBe('unknown');
      expect(result.vin_data!.insurer_provided_vin).toBeUndefined();
      expect(result.vin_data!.vehicle_data).toBeUndefined();
    });
  });

  describe('Damage Summary Formatting', () => {
    it('should format damage summary with all fields', async () => {
      const input = createFormatterInput();
      const result = await service.formatResult(input);

      expect(result.damage_summary).not.toBeNull();
      expect(result.damage_summary!.damage_points).toHaveLength(1);
      expect(result.damage_summary!.damage_points[0]!.affected_region).toBe('passenger_side_upper');
      expect(result.damage_summary!.damage_points[0]!.severity_attributes).toEqual({
        damageType: 'bullseye',
        estimatedDiameterInches: 0.8,
        inDPVA: false,
        repairEligible: true,
        repairBlockingReasons: [],
      });
      expect(result.damage_summary!.damage_points[0]!.glass_observations).toEqual(['clean_outer_surface_damage']);
      expect(result.damage_summary!.overall_confidence).toBe(0.85);
      expect(result.damage_summary!.uncertainty_indicators).toEqual([]);
      expect(result.damage_summary!.insufficiency_flags).toEqual([]);
      expect(result.damage_summary!.evidence_sufficiency_assessment).toBe('sufficient');
      expect(result.damage_summary!.analysed_at).toBe('2024-01-15T09:58:00.000Z');
    });

    it('should format multiple damage points', async () => {
      const damageAnalysis = createDamageAnalysis({
        damagePoints: [
          {
            affectedRegion: 'passenger_side_upper',
            severityAttributes: { damageType: 'bullseye', repairEligible: true },
            glassObservations: ['clean_outer_surface_damage'],
          },
          {
            affectedRegion: 'center_lower',
            severityAttributes: { damageType: 'crack', repairEligible: false },
            glassObservations: ['penetrates_both_layers'],
          },
        ],
      });

      const input = createFormatterInput({ damageAnalysis });
      const result = await service.formatResult(input);

      expect(result.damage_summary!.damage_points).toHaveLength(2);
    });
  });

  describe('Glass Type Summary Formatting', () => {
    it('should format glass type summary with all fields', async () => {
      const input = createFormatterInput();
      const result = await service.formatResult(input);

      expect(result.glass_type_summary).not.toBeNull();
      expect(result.glass_type_summary!.glass_manufacturer).toBe('AGC');
      expect(result.glass_type_summary!.vehicle_manufacturer_logo).toBe('Volkswagen');
      expect(result.glass_type_summary!.glass_type).toBe('oem');
      expect(result.glass_type_summary!.confidence).toBe(0.92);
      expect(result.glass_type_summary!.uncertainty_indicators).toEqual([]);
      expect(result.glass_type_summary!.analysed_at).toBe('2024-01-15T09:57:00.000Z');
    });

    it('should handle glass type without manufacturer logos', async () => {
      const glassTypeAnalysis: GlassTypeAnalysisResult = {
        claimId: 'claim-001',
        glassType: 'unknown',
        confidence: 0.3,
        uncertaintyIndicators: ['poor_photo_quality', 'no_visible_branding'],
        analysedAt: new Date('2024-01-15T09:57:00Z'),
      };

      const input = createFormatterInput({ glassTypeAnalysis });
      const result = await service.formatResult(input);

      expect(result.glass_type_summary!.glass_manufacturer).toBeUndefined();
      expect(result.glass_type_summary!.vehicle_manufacturer_logo).toBeUndefined();
      expect(result.glass_type_summary!.glass_type).toBe('unknown');
      expect(result.glass_type_summary!.uncertainty_indicators).toEqual([
        'poor_photo_quality',
        'no_visible_branding',
      ]);
    });
  });

  describe('External Status Derivation', () => {
    it('should derive "Result Ready" for decision_complete', async () => {
      const input = createFormatterInput({ internalStatus: 'decision_complete' });
      const result = await service.formatResult(input);

      expect(result.external_status).toBe('Result Ready');
    });

    it('should derive "Result Ready" for result_delivered', async () => {
      const input = createFormatterInput({ internalStatus: 'result_delivered' });
      const result = await service.formatResult(input);

      expect(result.external_status).toBe('Result Ready');
    });
  });

  describe('Event Emission', () => {
    it('should emit result.delivered event on successful formatting', async () => {
      const input = createFormatterInput();
      await service.formatResult(input);

      expect(EventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'result.delivered',
          claimId: 'claim-001',
          sourceService: 'result-formatter-service',
          actorType: 'system',
          payload: expect.objectContaining({
            schemaVersion: '1.0.0',
            finalDecision: 'repair',
            finalDecisionSource: 'automated',
            manualReviewFlag: false,
          }),
        })
      );
    });

    it('should emit event with manual review details when applicable', async () => {
      const manualReview = createManualReview({
        overrideFlag: true,
        finalReviewedOutcome: 'replace',
      });

      const input = createFormatterInput({ manualReview });
      await service.formatResult(input);

      expect(EventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            finalDecision: 'replace',
            finalDecisionSource: 'manually_reviewed',
            manualReviewFlag: true,
          }),
        })
      );
    });
  });

  describe('Assessment Outcome', () => {
    it('should always reflect the machine assessment outcome', async () => {
      const decisionResult = createDecisionResult({ outcome: 'needs_manual_review' });
      const manualReview = createManualReview({
        overrideFlag: true,
        finalReviewedOutcome: 'repair',
      });

      const input = createFormatterInput({ decisionResult, manualReview });
      const result = await service.formatResult(input);

      // assessment_outcome is the machine's original decision
      expect(result.assessment_outcome).toBe('needs_manual_review');
      // final_decision is the reviewer's decision
      expect(result.final_decision).toBe('repair');
    });
  });
});
