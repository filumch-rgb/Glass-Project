/**
 * Decision Rules Engine Integration Tests
 * 
 * Integration tests that verify:
 * - Prerequisite blocking of repair/replace decisions
 * - Decision engine determinism
 * - Prerequisite check evaluation
 * - End-to-end decision flow with all services
 */

import { DecisionRulesEngine, DecisionInputs } from './decisionRulesEngine';
import { damageAnalysisService, DamageAnalysisResult } from './damageAnalysisService';
import { glassTypeAnalysisService, GlassTypeAnalysisResult } from './glassTypeAnalysisService';
import { VINEnrichmentService, VINEnrichmentResult } from './vinEnrichmentService';

// Mock external services
jest.mock('./damageAnalysisService');
jest.mock('./glassTypeAnalysisService');
jest.mock('./vinEnrichmentService');
jest.mock('./eventService');
jest.mock('../config');
jest.mock('../utils/logger');

describe('Decision Rules Engine - Integration Tests', () => {
  let engine: DecisionRulesEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    engine = new DecisionRulesEngine();
  });

  describe('Property 6: Prerequisites Block Repair/Replace', () => {
    it('should block repair when consent not captured', async () => {
      const inputs: DecisionInputs = {
        claimId: 'test-claim-001',
        consentCaptured: false, // Blocking prerequisite
        fixedPhotosAccepted: {
          front_vehicle: true,
          inside_driver: true,
          inside_passenger: true,
          vin_cutout: true,
          logo_silkscreen: true,
        },
        damagePhotosAccepted: 2,
        damageAnalysis: {
          claimId: 'test-claim-001',
          damagePoints: [
            {
              affectedRegion: 'passenger_side_upper',
              severityAttributes: {
                damageType: 'bullseye',
                repairEligible: true,
                repairBlockingReasons: [],
              },
              glassObservations: ['clean_outer_surface_damage'],
            },
          ],
          overallConfidence: 0.9,
          uncertaintyIndicators: [],
          insufficiencyFlags: [],
          evidenceSufficiencyAssessment: 'sufficient',
          analysedAt: new Date(),
        },
      };

      const result = await engine.generateDecision(inputs);

      // Verify repair is blocked
      expect(result.outcome).not.toBe('repair');
      expect(result.outcome).not.toBe('replace');
      expect(result.decisionEligible).toBe(false);
      expect(result.blockingReasons).toContain('consent_not_captured');
      expect(result.prerequisiteChecks.consentCaptured).toBe(false);
    });

    it('should block replace when missing required photos', async () => {
      const inputs: DecisionInputs = {
        claimId: 'test-claim-002',
        consentCaptured: true,
        fixedPhotosAccepted: {
          front_vehicle: true,
          inside_driver: true,
          inside_passenger: false, // Missing photo
          vin_cutout: true,
          logo_silkscreen: true,
        },
        damagePhotosAccepted: 2,
        damageAnalysis: {
          claimId: 'test-claim-002',
          damagePoints: [
            {
              affectedRegion: 'center_upper',
              severityAttributes: {
                damageType: 'star_break',
                repairEligible: false,
                repairBlockingReasons: ['damage_too_large'],
              },
              glassObservations: ['damage_too_large'],
            },
          ],
          overallConfidence: 0.85,
          uncertaintyIndicators: [],
          insufficiencyFlags: [],
          evidenceSufficiencyAssessment: 'sufficient',
          analysedAt: new Date(),
        },
      };

      const result = await engine.generateDecision(inputs);

      // Verify replace is blocked
      expect(result.outcome).not.toBe('repair');
      expect(result.outcome).not.toBe('replace');
      expect(result.decisionEligible).toBe(false);
      expect(result.blockingReasons).toContain('missing_required_photos');
      expect(result.prerequisiteChecks.allFixedPhotosAccepted).toBe(false);
    });

    it('should block repair when confidence below threshold', async () => {
      const inputs: DecisionInputs = {
        claimId: 'test-claim-003',
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
          claimId: 'test-claim-003',
          damagePoints: [
            {
              affectedRegion: 'driver_side_upper',
              severityAttributes: {
                damageType: 'bullseye',
                repairEligible: true,
                repairBlockingReasons: [],
              },
              glassObservations: ['clean_outer_surface_damage'],
            },
          ],
          overallConfidence: 0.5, // Below 0.7 threshold
          uncertaintyIndicators: ['poor_photo_quality'],
          insufficiencyFlags: [],
          evidenceSufficiencyAssessment: 'sufficient_with_warnings',
          analysedAt: new Date(),
        },
      };

      const result = await engine.generateDecision(inputs);

      // Verify repair is blocked
      expect(result.outcome).not.toBe('repair');
      expect(result.outcome).not.toBe('replace');
      expect(result.decisionEligible).toBe(false);
      expect(result.blockingReasons).toContain('low_confidence');
      expect(result.prerequisiteChecks.confidenceThresholdsMet).toBe(false);
    });

    it('should block repair when evidence is insufficient', async () => {
      const inputs: DecisionInputs = {
        claimId: 'test-claim-004',
        consentCaptured: true,
        fixedPhotosAccepted: {
          front_vehicle: true,
          inside_driver: true,
          inside_passenger: true,
          vin_cutout: true,
          logo_silkscreen: true,
        },
        damagePhotosAccepted: 1,
        damageAnalysis: {
          claimId: 'test-claim-004',
          damagePoints: [],
          overallConfidence: 0.3,
          uncertaintyIndicators: ['poor_photo_quality', 'damage_not_in_frame'],
          insufficiencyFlags: ['photo_too_blurry', 'need_closer_photo'],
          evidenceSufficiencyAssessment: 'insufficient', // Blocking prerequisite
          analysedAt: new Date(),
        },
      };

      const result = await engine.generateDecision(inputs);

      // Verify repair is blocked
      expect(result.outcome).toBe('insufficient_evidence');
      expect(result.decisionEligible).toBe(false);
      expect(result.blockingReasons).toContain('insufficient_evidence');
      expect(result.prerequisiteChecks.evidenceNotInsufficient).toBe(false);
    });
  });

  describe('Property 7: Decision Engine Determinism', () => {
    it('should produce identical results for identical inputs (run 1)', async () => {
      const inputs: DecisionInputs = {
        claimId: 'test-claim-determinism',
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
          claimId: 'test-claim-determinism',
          damagePoints: [
            {
              affectedRegion: 'passenger_side_upper',
              severityAttributes: {
                damageType: 'bullseye',
                estimatedDiameterInches: 0.8,
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
          analysedAt: new Date('2024-01-15T10:00:00Z'),
        },
        vinEnrichment: {
          claimId: 'test-claim-determinism',
          vinResultState: 'validated',
          bestValidatedVin: 'AAVZZZ6SZEU024494',
          vinMismatchFlag: false,
          adasStatus: 'no',
          enrichedAt: new Date('2024-01-15T10:00:00Z'),
        },
      };

      const result1 = await engine.generateDecision(inputs);
      const result2 = await engine.generateDecision(inputs);
      const result3 = await engine.generateDecision(inputs);

      // Verify all results are identical
      expect(result1.outcome).toBe(result2.outcome);
      expect(result2.outcome).toBe(result3.outcome);
      expect(result1.decisionEligible).toBe(result2.decisionEligible);
      expect(result2.decisionEligible).toBe(result3.decisionEligible);
      expect(result1.blockingReasons).toEqual(result2.blockingReasons);
      expect(result2.blockingReasons).toEqual(result3.blockingReasons);
      expect(result1.prerequisiteChecks).toEqual(result2.prerequisiteChecks);
      expect(result2.prerequisiteChecks).toEqual(result3.prerequisiteChecks);

      // Verify specific outcome
      expect(result1.outcome).toBe('repair');
      expect(result1.decisionEligible).toBe(true);
    });

    it('should produce identical results for identical inputs (run 2 - different damage)', async () => {
      const inputs: DecisionInputs = {
        claimId: 'test-claim-determinism-2',
        consentCaptured: true,
        fixedPhotosAccepted: {
          front_vehicle: true,
          inside_driver: true,
          inside_passenger: true,
          vin_cutout: true,
          logo_silkscreen: true,
        },
        damagePhotosAccepted: 3,
        damageAnalysis: {
          claimId: 'test-claim-determinism-2',
          damagePoints: [
            {
              affectedRegion: 'dpva',
              severityAttributes: {
                damageType: 'star_break',
                estimatedDiameterInches: 2.5,
                inDPVA: true,
                repairEligible: false,
                repairBlockingReasons: ['damage_too_large', 'dpva_restriction'],
              },
              glassObservations: ['clean_outer_surface_damage'],
            },
          ],
          overallConfidence: 0.92,
          uncertaintyIndicators: [],
          insufficiencyFlags: [],
          evidenceSufficiencyAssessment: 'sufficient',
          analysedAt: new Date('2024-01-15T11:00:00Z'),
        },
        vinEnrichment: {
          claimId: 'test-claim-determinism-2',
          vinResultState: 'validated',
          bestValidatedVin: 'JN3MS37A9PW202929',
          vinMismatchFlag: false,
          adasStatus: 'no',
          enrichedAt: new Date('2024-01-15T11:00:00Z'),
        },
      };

      const result1 = await engine.generateDecision(inputs);
      const result2 = await engine.generateDecision(inputs);
      const result3 = await engine.generateDecision(inputs);

      // Verify all results are identical
      expect(result1.outcome).toBe(result2.outcome);
      expect(result2.outcome).toBe(result3.outcome);
      expect(result1.decisionEligible).toBe(result2.decisionEligible);
      expect(result2.decisionEligible).toBe(result3.decisionEligible);

      // Verify specific outcome
      expect(result1.outcome).toBe('replace');
      expect(result1.decisionEligible).toBe(true);
    });
  });

  describe('Property 8: Prerequisite Check Evaluation', () => {
    it('should correctly evaluate all 9 prerequisites', async () => {
      const inputs: DecisionInputs = {
        claimId: 'test-claim-prerequisites',
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
          claimId: 'test-claim-prerequisites',
          damagePoints: [
            {
              affectedRegion: 'passenger_side_lower',
              severityAttributes: {
                damageType: 'crack',
                estimatedLengthInches: 10.0,
                repairEligible: true,
                repairBlockingReasons: [],
              },
              glassObservations: ['clean_outer_surface_damage'],
            },
          ],
          overallConfidence: 0.88,
          uncertaintyIndicators: [],
          insufficiencyFlags: [],
          evidenceSufficiencyAssessment: 'sufficient',
          analysedAt: new Date(),
        },
        glassTypeAnalysis: {
          claimId: 'test-claim-prerequisites',
          glassManufacturer: 'Pilkington',
          glassType: 'aftermarket',
          confidence: 0.85,
          uncertaintyIndicators: [],
          analysedAt: new Date(),
        },
        vinEnrichment: {
          claimId: 'test-claim-prerequisites',
          vinResultState: 'validated',
          insurerProvidedVin: 'AAVZZZ6SZEU024494',
          ocrExtractedVin: 'AAVZZZ6SZEU024494',
          ocrConfidenceScore: 0.95,
          bestValidatedVin: 'AAVZZZ6SZEU024494',
          vinMismatchFlag: false,
          adasStatus: 'no',
          enrichedAt: new Date(),
        },
      };

      const result = await engine.generateDecision(inputs);

      // Verify all prerequisites pass
      expect(result.prerequisiteChecks.consentCaptured).toBe(true);
      expect(result.prerequisiteChecks.allFixedPhotosAccepted).toBe(true);
      expect(result.prerequisiteChecks.atLeastOneDamagePhotoAccepted).toBe(true);
      expect(result.prerequisiteChecks.evidenceNotInsufficient).toBe(true);
      expect(result.prerequisiteChecks.structuredDamageOutputPresent).toBe(true);
      expect(result.prerequisiteChecks.noUnresolvedVinConflict).toBe(true);
      expect(result.prerequisiteChecks.noBlockingOperationalFlags).toBe(true);
      expect(result.prerequisiteChecks.confidenceThresholdsMet).toBe(true);
      expect(result.prerequisiteChecks.noMandatoryManualReviewTrigger).toBe(true);

      // Verify decision is eligible
      expect(result.decisionEligible).toBe(true);
      expect(result.blockingReasons).toHaveLength(0);
      expect(result.outcome).toBe('repair');
    });

    it('should correctly identify multiple failing prerequisites', async () => {
      const inputs: DecisionInputs = {
        claimId: 'test-claim-multiple-failures',
        consentCaptured: false, // Fail 1
        fixedPhotosAccepted: {
          front_vehicle: true,
          inside_driver: false, // Fail 2
          inside_passenger: true,
          vin_cutout: true,
          logo_silkscreen: true,
        },
        damagePhotosAccepted: 0, // Fail 3
        damageAnalysis: {
          claimId: 'test-claim-multiple-failures',
          damagePoints: [],
          overallConfidence: 0.4, // Fail 4
          uncertaintyIndicators: ['poor_photo_quality'],
          insufficiencyFlags: ['photo_too_blurry'],
          evidenceSufficiencyAssessment: 'insufficient', // Fail 5
          analysedAt: new Date(),
        },
      };

      const result = await engine.generateDecision(inputs);

      // Verify multiple prerequisites fail
      expect(result.prerequisiteChecks.consentCaptured).toBe(false);
      expect(result.prerequisiteChecks.allFixedPhotosAccepted).toBe(false);
      expect(result.prerequisiteChecks.atLeastOneDamagePhotoAccepted).toBe(false);
      expect(result.prerequisiteChecks.evidenceNotInsufficient).toBe(false);
      expect(result.prerequisiteChecks.confidenceThresholdsMet).toBe(false);

      // Verify decision is ineligible
      expect(result.decisionEligible).toBe(false);
      expect(result.blockingReasons.length).toBeGreaterThan(1);
      expect(result.blockingReasons).toContain('consent_not_captured');
      expect(result.blockingReasons).toContain('missing_required_photos');
      expect(result.blockingReasons).toContain('no_damage_photos');
      expect(result.blockingReasons).toContain('insufficient_evidence');
      expect(result.blockingReasons).toContain('low_confidence');

      // Verify outcome is not repair or replace
      expect(result.outcome).not.toBe('repair');
      expect(result.outcome).not.toBe('replace');
    });
  });

  describe('End-to-End Decision Flow', () => {
    it('should handle complete claim with repair outcome', async () => {
      const inputs: DecisionInputs = {
        claimId: 'test-claim-e2e-repair',
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
          claimId: 'test-claim-e2e-repair',
          damagePoints: [
            {
              affectedRegion: 'passenger_side_upper',
              severityAttributes: {
                damageType: 'bullseye',
                estimatedDiameterInches: 0.9,
                inDPVA: false,
                repairEligible: true,
                repairBlockingReasons: [],
              },
              glassObservations: ['clean_outer_surface_damage'],
            },
          ],
          overallConfidence: 0.92,
          uncertaintyIndicators: [],
          insufficiencyFlags: [],
          evidenceSufficiencyAssessment: 'sufficient',
          analysedAt: new Date(),
        },
        glassTypeAnalysis: {
          claimId: 'test-claim-e2e-repair',
          glassManufacturer: 'AGC',
          vehicleManufacturerLogo: 'Toyota',
          glassType: 'oem',
          confidence: 0.95,
          uncertaintyIndicators: [],
          analysedAt: new Date(),
        },
        vinEnrichment: {
          claimId: 'test-claim-e2e-repair',
          vinResultState: 'validated',
          insurerProvidedVin: 'AAVZZZ6SZEU024494',
          ocrExtractedVin: 'AAVZZZ6SZEU024494',
          ocrConfidenceScore: 0.98,
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
      };

      const result = await engine.generateDecision(inputs);

      expect(result.outcome).toBe('repair');
      expect(result.decisionEligible).toBe(true);
      expect(result.blockingReasons).toHaveLength(0);
      expect(result.justification).toContain('Repair');
      expect(result.confidenceSummary.damageAnalysis).toBe(0.92);
      expect(result.confidenceSummary.glassTypeAnalysis).toBe(0.95);
      expect(result.confidenceSummary.vinOcr).toBe(0.98);
    });

    it('should handle complete claim with replace outcome', async () => {
      const inputs: DecisionInputs = {
        claimId: 'test-claim-e2e-replace',
        consentCaptured: true,
        fixedPhotosAccepted: {
          front_vehicle: true,
          inside_driver: true,
          inside_passenger: true,
          vin_cutout: true,
          logo_silkscreen: true,
        },
        damagePhotosAccepted: 3,
        damageAnalysis: {
          claimId: 'test-claim-e2e-replace',
          damagePoints: [
            {
              affectedRegion: 'center_upper',
              severityAttributes: {
                damageType: 'combination_break',
                estimatedDiameterInches: 3.5,
                inDPVA: false,
                repairEligible: false,
                repairBlockingReasons: ['penetrates_both_layers', 'interlayer_damage'],
              },
              glassObservations: ['penetrates_both_layers', 'interlayer_damage'],
            },
          ],
          overallConfidence: 0.89,
          uncertaintyIndicators: [],
          insufficiencyFlags: [],
          evidenceSufficiencyAssessment: 'sufficient',
          analysedAt: new Date(),
        },
        glassTypeAnalysis: {
          claimId: 'test-claim-e2e-replace',
          glassManufacturer: 'Pilkington',
          glassType: 'aftermarket',
          confidence: 0.87,
          uncertaintyIndicators: [],
          analysedAt: new Date(),
        },
        vinEnrichment: {
          claimId: 'test-claim-e2e-replace',
          vinResultState: 'validated',
          insurerProvidedVin: 'JN3MS37A9PW202929',
          ocrExtractedVin: 'JN3MS37A9PW202929',
          ocrConfidenceScore: 0.93,
          bestValidatedVin: 'JN3MS37A9PW202929',
          vinMismatchFlag: false,
          decoderUsed: 'nhtsa',
          vehicleData: {
            make: 'Nissan',
            model: '240SX',
            year: 1993,
          },
          adasStatus: 'no',
          enrichedAt: new Date(),
        },
      };

      const result = await engine.generateDecision(inputs);

      expect(result.outcome).toBe('replace');
      expect(result.decisionEligible).toBe(true);
      expect(result.blockingReasons).toHaveLength(0);
      expect(result.justification).toContain('Replace');
      expect(result.justification).toContain('penetrates both layers');
    });
  });
});
