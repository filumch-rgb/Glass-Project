/**
 * Decision Rules Engine Tests
 * 
 * Tests for deterministic decision logic including:
 * - Prerequisite checking
 * - Decision eligibility
 * - Repair/replace logic
 * - ADAS + glass type combinations
 * - Manual review triggers
 * - Safety rules enforcement
 */

import { DecisionRulesEngine, DecisionInputs, DecisionOutcome } from './decisionRulesEngine';
import { EventService } from './eventService';
import { DamageAnalysisResult } from './damageAnalysisService';
import { GlassTypeAnalysisResult } from './glassTypeAnalysisService';
import { VINEnrichmentResult } from './vinEnrichmentService';

// Mock EventService
jest.mock('./eventService', () => ({
  EventService: {
    emit: jest.fn(),
  },
  EVENT_TYPES: {
    DECISION_GENERATED: 'decision.generated',
    DECISION_MANUAL_REVIEW_TRIGGERED: 'decision.manual_review_triggered',
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

describe('DecisionRulesEngine', () => {
  let engine: DecisionRulesEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    engine = new DecisionRulesEngine();
  });

  // Helper function to create complete valid inputs
  const createValidInputs = (): DecisionInputs => ({
    claimId: 'test-claim-123',
    consentCaptured: true,
    fixedPhotosAccepted: {
      front_vehicle: true,
      inside_driver: true,
      inside_passenger: true,
      vin_cutout: true,
      logo_silkscreen: true,
    },
    damagePhotosAccepted: 2,
    damageAnalysis: {
      claimId: 'test-claim-123',
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
      analysedAt: new Date(),
    },
    glassTypeAnalysis: {
      claimId: 'test-claim-123',
      glassManufacturer: 'AGC',
      vehicleManufacturerLogo: 'Toyota',
      glassType: 'oem',
      confidence: 0.92,
      uncertaintyIndicators: [],
      analysedAt: new Date(),
    },
    vinEnrichment: {
      claimId: 'test-claim-123',
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
      enrichedAt: new Date(),
    },
  });

  describe('Prerequisite Checks', () => {
    it('should pass all prerequisites with valid inputs', async () => {
      const inputs = createValidInputs();
      const result = await engine.generateDecision(inputs);

      expect(result.decisionEligible).toBe(true);
      expect(result.prerequisiteChecks.consentCaptured).toBe(true);
      expect(result.prerequisiteChecks.allFixedPhotosAccepted).toBe(true);
      expect(result.prerequisiteChecks.atLeastOneDamagePhotoAccepted).toBe(true);
      expect(result.prerequisiteChecks.evidenceNotInsufficient).toBe(true);
      expect(result.prerequisiteChecks.structuredDamageOutputPresent).toBe(true);
      expect(result.prerequisiteChecks.noUnresolvedVinConflict).toBe(true);
      expect(result.prerequisiteChecks.noBlockingOperationalFlags).toBe(true);
      expect(result.prerequisiteChecks.confidenceThresholdsMet).toBe(true);
      expect(result.prerequisiteChecks.noMandatoryManualReviewTrigger).toBe(true);
      expect(result.blockingReasons).toHaveLength(0);
    });

    it('should fail when consent not captured', async () => {
      const inputs = createValidInputs();
      inputs.consentCaptured = false;

      const result = await engine.generateDecision(inputs);

      expect(result.decisionEligible).toBe(false);
      expect(result.prerequisiteChecks.consentCaptured).toBe(false);
      expect(result.blockingReasons).toContain('consent_not_captured');
      expect(result.outcome).not.toBe('repair');
      expect(result.outcome).not.toBe('replace');
    });

    it('should fail when missing fixed photos', async () => {
      const inputs = createValidInputs();
      inputs.fixedPhotosAccepted.vin_cutout = false;

      const result = await engine.generateDecision(inputs);

      expect(result.decisionEligible).toBe(false);
      expect(result.prerequisiteChecks.allFixedPhotosAccepted).toBe(false);
      expect(result.blockingReasons).toContain('missing_required_photos');
    });

    it('should fail when no damage photos accepted', async () => {
      const inputs = createValidInputs();
      inputs.damagePhotosAccepted = 0;

      const result = await engine.generateDecision(inputs);

      expect(result.decisionEligible).toBe(false);
      expect(result.prerequisiteChecks.atLeastOneDamagePhotoAccepted).toBe(false);
      expect(result.blockingReasons).toContain('no_damage_photos');
    });

    it('should fail when evidence is insufficient', async () => {
      const inputs = createValidInputs();
      inputs.damageAnalysis!.evidenceSufficiencyAssessment = 'insufficient';

      const result = await engine.generateDecision(inputs);

      expect(result.decisionEligible).toBe(false);
      expect(result.prerequisiteChecks.evidenceNotInsufficient).toBe(false);
      expect(result.blockingReasons).toContain('insufficient_evidence');
    });

    it('should fail when damage analysis missing', async () => {
      const inputs = createValidInputs();
      delete (inputs as any).damageAnalysis;

      const result = await engine.generateDecision(inputs);

      expect(result.decisionEligible).toBe(false);
      expect(result.prerequisiteChecks.structuredDamageOutputPresent).toBe(false);
      expect(result.blockingReasons).toContain('missing_damage_analysis');
    });

    it('should fail when VIN mismatch detected', async () => {
      const inputs = createValidInputs();
      inputs.vinEnrichment!.vinResultState = 'mismatch';
      inputs.vinEnrichment!.vinMismatchFlag = true;

      const result = await engine.generateDecision(inputs);

      expect(result.decisionEligible).toBe(false);
      expect(result.prerequisiteChecks.noUnresolvedVinConflict).toBe(false);
      expect(result.blockingReasons).toContain('vin_mismatch');
    });

    it('should fail when operational flags present', async () => {
      const inputs = createValidInputs();
      inputs.operationalFlags = {
        systemError: true,
      };

      const result = await engine.generateDecision(inputs);

      expect(result.decisionEligible).toBe(false);
      expect(result.prerequisiteChecks.noBlockingOperationalFlags).toBe(false);
      expect(result.blockingReasons).toContain('operational_flags');
    });

    it('should fail when confidence below threshold', async () => {
      const inputs = createValidInputs();
      inputs.damageAnalysis!.overallConfidence = 0.5; // Below 0.7 threshold

      const result = await engine.generateDecision(inputs);

      expect(result.decisionEligible).toBe(false);
      expect(result.prerequisiteChecks.confidenceThresholdsMet).toBe(false);
      expect(result.blockingReasons).toContain('low_confidence');
    });

    it('should fail when VIN unavailable triggers mandatory manual review', async () => {
      const inputs = createValidInputs();
      inputs.vinEnrichment!.vinResultState = 'unavailable';

      const result = await engine.generateDecision(inputs);

      expect(result.decisionEligible).toBe(false);
      expect(result.prerequisiteChecks.noMandatoryManualReviewTrigger).toBe(false);
      expect(result.blockingReasons).toContain('mandatory_manual_review');
    });
  });

  describe('Decision Logic - Repair', () => {
    it('should decide repair for repairable damage', async () => {
      const inputs = createValidInputs();

      const result = await engine.generateDecision(inputs);

      expect(result.outcome).toBe('repair');
      expect(result.decisionEligible).toBe(true);
      expect(result.justification).toContain('Repair eligible');
      expect(result.justification).toContain('bullseye');
    });

    it('should decide repair for multiple repairable damage points', async () => {
      const inputs = createValidInputs();
      inputs.damageAnalysis!.damagePoints.push({
        affectedRegion: 'driver_side_lower',
        severityAttributes: {
          damageType: 'crack',
          estimatedLengthInches: 8.0,
          inDPVA: false,
          repairEligible: true,
          repairBlockingReasons: [],
        },
        glassObservations: ['clean_outer_surface_damage'],
      });

      const result = await engine.generateDecision(inputs);

      expect(result.outcome).toBe('repair');
      expect(result.justification).toContain('bullseye');
      expect(result.justification).toContain('crack');
    });
  });

  describe('Decision Logic - Replace', () => {
    it('should decide replace for non-repairable damage', async () => {
      const inputs = createValidInputs();
      inputs.damageAnalysis!.damagePoints[0]!.severityAttributes = {
        damageType: 'star_break',
        estimatedDiameterInches: 4.0,
        inDPVA: true,
        repairEligible: false,
        repairBlockingReasons: ['damage_too_large', 'dpva_restriction'],
      };

      const result = await engine.generateDecision(inputs);

      expect(result.outcome).toBe('replace');
      expect(result.decisionEligible).toBe(true);
      expect(result.justification).toContain('Replacement required');
      expect(result.justification).toContain('damage_too_large');
    });

    it('should decide replace when any damage point is non-repairable', async () => {
      const inputs = createValidInputs();
      // First damage point is repairable
      inputs.damageAnalysis!.damagePoints[0]!.severityAttributes.repairEligible = true;
      // Add second damage point that is non-repairable
      inputs.damageAnalysis!.damagePoints.push({
        affectedRegion: 'center_upper',
        severityAttributes: {
          damageType: 'combination_break',
          estimatedDiameterInches: 3.0,
          inDPVA: false,
          repairEligible: false,
          repairBlockingReasons: ['penetrates_both_layers'],
        },
        glassObservations: ['penetrates_both_layers', 'interlayer_damage'],
      });

      const result = await engine.generateDecision(inputs);

      expect(result.outcome).toBe('replace');
      expect(result.justification).toContain('penetrates_both_layers');
    });
  });

  describe('Decision Logic - ADAS + Glass Type', () => {
    it('should allow repair for ADAS vehicle with OEM glass', async () => {
      const inputs = createValidInputs();
      inputs.vinEnrichment!.adasStatus = 'yes';
      inputs.vinEnrichment!.adasFeatures = ['Lane Departure Warning', 'Forward Collision Warning'];
      inputs.glassTypeAnalysis!.glassType = 'oem';

      const result = await engine.generateDecision(inputs);

      expect(result.outcome).toBe('repair');
      expect(result.decisionEligible).toBe(true);
    });

    it('should allow repair for ADAS vehicle with aftermarket glass', async () => {
      const inputs = createValidInputs();
      inputs.vinEnrichment!.adasStatus = 'yes';
      inputs.vinEnrichment!.adasFeatures = ['Lane Departure Warning'];
      inputs.glassTypeAnalysis!.glassType = 'aftermarket';
      delete (inputs.glassTypeAnalysis as any).vehicleManufacturerLogo;

      const result = await engine.generateDecision(inputs);

      // ADAS vehicles do NOT require OEM glass - both OEM and Aftermarket can have ADAS
      expect(result.outcome).toBe('repair');
      expect(result.decisionEligible).toBe(true);
    });

    it('should trigger manual review when ADAS status is unknown', async () => {
      const inputs = createValidInputs();
      inputs.vinEnrichment!.adasStatus = 'unknown';

      const result = await engine.generateDecision(inputs);

      expect(result.decisionEligible).toBe(false);
      expect(result.prerequisiteChecks.noMandatoryManualReviewTrigger).toBe(false);
      expect(result.blockingReasons).toContain('mandatory_manual_review');
    });
  });

  describe('Decision Logic - Manual Review', () => {
    it('should trigger manual review when no damage points identified', async () => {
      const inputs = createValidInputs();
      inputs.damageAnalysis!.damagePoints = [];

      const result = await engine.generateDecision(inputs);

      expect(result.outcome).toBe('needs_manual_review');
      expect(result.decisionEligible).toBe(true);
      expect(result.justification).toContain('No clear damage points identified');
    });

    it('should return insufficient_evidence when evidence is insufficient', async () => {
      const inputs = createValidInputs();
      inputs.damageAnalysis!.evidenceSufficiencyAssessment = 'insufficient';

      const result = await engine.generateDecision(inputs);

      expect(result.outcome).toBe('insufficient_evidence');
      expect(result.decisionEligible).toBe(false);
    });

    it('should return unable_to_assess when missing critical data', async () => {
      const inputs = createValidInputs();
      inputs.consentCaptured = false;

      const result = await engine.generateDecision(inputs);

      expect(result.outcome).toBe('unable_to_assess');
      expect(result.decisionEligible).toBe(false);
    });
  });

  describe('Determinism', () => {
    it('should produce identical results for identical inputs', async () => {
      const inputs1 = createValidInputs();
      const inputs2 = createValidInputs();

      const result1 = await engine.generateDecision(inputs1);
      const result2 = await engine.generateDecision(inputs2);

      expect(result1.outcome).toBe(result2.outcome);
      expect(result1.decisionEligible).toBe(result2.decisionEligible);
      expect(result1.blockingReasons).toEqual(result2.blockingReasons);
      expect(result1.prerequisiteChecks).toEqual(result2.prerequisiteChecks);
    });

    it('should produce different results for different inputs', async () => {
      const inputs1 = createValidInputs();
      const inputs2 = createValidInputs();
      inputs2.damageAnalysis!.damagePoints[0]!.severityAttributes.repairEligible = false;

      const result1 = await engine.generateDecision(inputs1);
      const result2 = await engine.generateDecision(inputs2);

      expect(result1.outcome).toBe('repair');
      expect(result2.outcome).toBe('replace');
    });
  });

  describe('Safety Rules', () => {
    it('should never issue repair when decision is ineligible', async () => {
      const inputs = createValidInputs();
      inputs.consentCaptured = false;

      const result = await engine.generateDecision(inputs);

      expect(result.decisionEligible).toBe(false);
      expect(result.outcome).not.toBe('repair');
      expect(result.outcome).not.toBe('replace');
    });

    it('should never issue replace when decision is ineligible', async () => {
      const inputs = createValidInputs();
      inputs.damageAnalysis!.evidenceSufficiencyAssessment = 'insufficient';

      const result = await engine.generateDecision(inputs);

      expect(result.decisionEligible).toBe(false);
      expect(result.outcome).not.toBe('repair');
      expect(result.outcome).not.toBe('replace');
    });
  });

  describe('Event Emission', () => {
    it('should emit decision.generated event on success', async () => {
      const inputs = createValidInputs();

      await engine.generateDecision(inputs);

      expect(EventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'decision.generated',
          claimId: 'test-claim-123',
          sourceService: 'decision-rules-engine',
          actorType: 'system',
          payload: expect.objectContaining({
            outcome: 'repair',
            decisionEligible: true,
            rulesVersion: '1.0.0',
          }),
        })
      );
    });

    it('should emit manual review triggered event', async () => {
      await engine.triggerManualReview('test-claim-456', ['low_confidence', 'unclear_damage']);

      expect(EventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'decision.manual_review_triggered',
          claimId: 'test-claim-456',
          sourceService: 'decision-rules-engine',
          actorType: 'system',
          payload: expect.objectContaining({
            triggerReasons: ['low_confidence', 'unclear_damage'],
          }),
        })
      );
    });
  });

  describe('Confidence Summary', () => {
    it('should include all confidence scores in summary', async () => {
      const inputs = createValidInputs();

      const result = await engine.generateDecision(inputs);

      expect(result.confidenceSummary).toHaveProperty('damageAnalysis', 0.85);
      expect(result.confidenceSummary).toHaveProperty('glassTypeAnalysis', 0.92);
      expect(result.confidenceSummary).toHaveProperty('vinOcr', 0.95);
    });

    it('should handle missing confidence scores', async () => {
      const inputs = createValidInputs();
      delete (inputs as any).glassTypeAnalysis;
      delete (inputs.vinEnrichment as any).ocrConfidenceScore;

      const result = await engine.generateDecision(inputs);

      expect(result.confidenceSummary).toHaveProperty('damageAnalysis', 0.85);
      expect(result.confidenceSummary).not.toHaveProperty('glassTypeAnalysis');
      expect(result.confidenceSummary).not.toHaveProperty('vinOcr');
    });
  });

  describe('Rules Version', () => {
    it('should include rules version in result', async () => {
      const inputs = createValidInputs();

      const result = await engine.generateDecision(inputs);

      expect(result.rulesVersion).toBe('1.0.0');
    });
  });

  describe('Justification', () => {
    it('should provide clear justification for repair decision', async () => {
      const inputs = createValidInputs();

      const result = await engine.generateDecision(inputs);

      expect(result.justification).toContain('Repair eligible');
      expect(result.justification).toContain('repairable');
    });

    it('should provide clear justification for replace decision', async () => {
      const inputs = createValidInputs();
      inputs.damageAnalysis!.damagePoints[0]!.severityAttributes.repairEligible = false;
      inputs.damageAnalysis!.damagePoints[0]!.severityAttributes.repairBlockingReasons = ['damage_too_large'];

      const result = await engine.generateDecision(inputs);

      expect(result.justification).toContain('Replacement required');
      expect(result.justification).toContain('damage_too_large');
    });

    it('should provide clear justification for blocked decision', async () => {
      const inputs = createValidInputs();
      inputs.consentCaptured = false;

      const result = await engine.generateDecision(inputs);

      expect(result.justification).toContain('Decision cannot be automated');
      expect(result.justification).toContain('Consent not captured');
    });
  });
});
