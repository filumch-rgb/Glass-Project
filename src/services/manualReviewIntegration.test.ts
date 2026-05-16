/**
 * Manual Review Integration Tests
 *
 * Tests the manual review workflow including:
 * - Assessment preservation (immutable machine assessment snapshots)
 * - Reviewer action processing and override tracking
 * - Insurer-initiated manual review trigger functionality
 * - Trigger source tracking and reason code handling
 *
 * Requirements: 9.3, 9.4, 9.5, 9.6, 9.7, 9.9
 */

import {
  ManualReviewService,
  CreateManualReviewInput,
  ReviewerActionInput,
  ManualReviewRecord,
} from './manualReviewService';
import { EventService } from './eventService';
import { DecisionResult, DecisionOutcome } from './decisionRulesEngine';

// Mock EventService
jest.mock('./eventService', () => ({
  EventService: {
    emit: jest.fn().mockResolvedValue('event-id-123'),
  },
  EVENT_TYPES: {
    DECISION_MANUAL_REVIEW_TRIGGERED: 'decision.manual_review_triggered',
    DECISION_GENERATED: 'decision.generated',
    DECISION_OVERRIDDEN: 'decision.overridden',
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

// Mock database (not used directly by ManualReviewService in-memory, but required for imports)
jest.mock('../config/database', () => ({
  database: {
    query: jest.fn(),
  },
}));

/**
 * Helper: Create a realistic machine assessment snapshot
 */
function createMachineAssessment(
  outcome: DecisionOutcome = 'repair',
  overrides: Partial<DecisionResult> = {}
): DecisionResult {
  return {
    claimId: 'test-claim-001',
    outcome,
    decisionEligible: outcome === 'repair' || outcome === 'replace',
    prerequisiteChecks: {
      consentCaptured: true,
      allFixedPhotosAccepted: true,
      atLeastOneDamagePhotoAccepted: true,
      evidenceNotInsufficient: true,
      structuredDamageOutputPresent: true,
      noUnresolvedVinConflict: true,
      noBlockingOperationalFlags: true,
      confidenceThresholdsMet: outcome !== 'needs_manual_review',
      noMandatoryManualReviewTrigger: outcome !== 'needs_manual_review',
    },
    blockingReasons: outcome === 'needs_manual_review' ? ['low_confidence'] : [],
    justification:
      outcome === 'repair'
        ? 'Damage is repairable based on size and location'
        : outcome === 'replace'
          ? 'Damage requires full replacement'
          : 'Confidence below threshold, manual review required',
    confidenceSummary: {
      damageAnalysis: 0.85,
      glassTypeAnalysis: 0.90,
      vinEnrichment: 0.95,
    },
    rulesVersion: '1.0.0',
    generatedAt: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  };
}

describe('Manual Review Integration Tests', () => {
  let service: ManualReviewService;

  beforeEach(async () => {
    jest.clearAllMocks();
    service = new ManualReviewService();
    await service.clearAllReviews();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Assessment Preservation (Requirement 9.3, 9.8)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Assessment Preservation', () => {
    it('should store machineAssessmentSnapshot immutably when manual review is created', async () => {
      const machineAssessment = createMachineAssessment('repair');

      const review = await service.createManualReview({
        claimId: 'claim-preserve-001',
        triggerReasons: ['low_confidence'],
        triggerSource: 'automatic',
        machineAssessmentSnapshot: machineAssessment,
      });

      // Snapshot should contain the full DecisionResult
      expect(review.machineAssessmentSnapshot).toBeDefined();
      expect(review.machineAssessmentSnapshot.claimId).toBe('test-claim-001');
      expect(review.machineAssessmentSnapshot.outcome).toBe('repair');
      expect(review.machineAssessmentSnapshot.decisionEligible).toBe(true);
      expect(review.machineAssessmentSnapshot.prerequisiteChecks).toBeDefined();
      expect(review.machineAssessmentSnapshot.confidenceSummary).toBeDefined();
      expect(review.machineAssessmentSnapshot.blockingReasons).toEqual([]);
      expect(review.machineAssessmentSnapshot.justification).toBe(
        'Damage is repairable based on size and location'
      );
      expect(review.machineAssessmentSnapshot.rulesVersion).toBe('1.0.0');
    });

    it('should not allow modification of the snapshot after creation (top-level properties)', async () => {
      const machineAssessment = createMachineAssessment('repair');

      const review = await service.createManualReview({
        claimId: 'claim-preserve-002',
        triggerReasons: ['low_confidence'],
        triggerSource: 'automatic',
        machineAssessmentSnapshot: machineAssessment,
      });

      // Mutate top-level properties of the original assessment object
      machineAssessment.outcome = 'replace';
      machineAssessment.justification = 'MUTATED';
      machineAssessment.decisionEligible = false;

      // Retrieve the review and verify snapshot top-level properties are unchanged
      const retrieved = await service.getManualReview(review.reviewId);
      expect(retrieved!.machineAssessmentSnapshot.outcome).toBe('repair');
      expect(retrieved!.machineAssessmentSnapshot.justification).toBe(
        'Damage is repairable based on size and location'
      );
      expect(retrieved!.machineAssessmentSnapshot.decisionEligible).toBe(true);

      // Verify the snapshot is a different object reference
      expect(retrieved!.machineAssessmentSnapshot).not.toBe(machineAssessment);
    });

    it('should contain the full DecisionResult at time of trigger', async () => {
      const machineAssessment = createMachineAssessment('needs_manual_review', {
        claimId: 'claim-full-snapshot',
        blockingReasons: ['low_confidence', 'unclear_damage_pattern'],
        confidenceSummary: {
          damageAnalysis: 0.55,
          glassTypeAnalysis: 0.60,
          vinEnrichment: 0.92,
        },
      });

      const review = await service.createManualReview({
        claimId: 'claim-preserve-003',
        triggerReasons: ['low_confidence', 'unclear_damage_pattern'],
        triggerSource: 'automatic',
        machineAssessmentSnapshot: machineAssessment,
      });

      const snapshot = review.machineAssessmentSnapshot;

      // Verify all DecisionResult fields are present
      expect(snapshot.claimId).toBe('claim-full-snapshot');
      expect(snapshot.outcome).toBe('needs_manual_review');
      expect(snapshot.decisionEligible).toBe(false);
      expect(snapshot.prerequisiteChecks.consentCaptured).toBe(true);
      expect(snapshot.prerequisiteChecks.confidenceThresholdsMet).toBe(false);
      expect(snapshot.blockingReasons).toEqual(['low_confidence', 'unclear_damage_pattern']);
      expect(snapshot.confidenceSummary.damageAnalysis).toBe(0.55);
      expect(snapshot.confidenceSummary.glassTypeAnalysis).toBe(0.60);
      expect(snapshot.confidenceSummary.vinEnrichment).toBe(0.92);
      expect(snapshot.rulesVersion).toBe('1.0.0');
      expect(snapshot.generatedAt).toBeDefined();
    });

    it('should preserve snapshot unchanged after reviewer override', async () => {
      const machineAssessment = createMachineAssessment('repair');

      const review = await service.createManualReview({
        claimId: 'claim-preserve-004',
        triggerReasons: ['insurer_request'],
        triggerSource: 'insurer_initiated',
        machineAssessmentSnapshot: machineAssessment,
        manualTriggerReason: 'quality_audit',
      });

      // Override to replace
      await service.processReviewerAction({
        reviewId: review.reviewId,
        reviewerId: 'reviewer-001',
        action: 'override_to_replace',
        overrideReasonCode: 'damage_larger_than_detected',
      });

      // Verify snapshot is still the original machine assessment
      const updated = await service.getManualReview(review.reviewId);
      expect(updated!.machineAssessmentSnapshot.outcome).toBe('repair');
      expect(updated!.finalReviewedOutcome).toBe('replace');
      expect(updated!.machineAssessmentSnapshot.justification).toBe(
        'Damage is repairable based on size and location'
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Reviewer Action Processing (Requirements 9.5, 9.6, 9.7)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Reviewer Action Processing', () => {
    let reviewId: string;

    beforeEach(async () => {
      const review = await service.createManualReview({
        claimId: 'claim-action-001',
        triggerReasons: ['low_confidence'],
        triggerSource: 'automatic',
        machineAssessmentSnapshot: createMachineAssessment('repair'),
      });
      reviewId = review.reviewId;
    });

    it('approve_machine_result: sets finalReviewedOutcome to machine outcome, overrideFlag=false', async () => {
      const result = await service.processReviewerAction({
        reviewId,
        reviewerId: 'reviewer-001',
        action: 'approve_machine_result',
        reviewerNotes: 'Machine assessment is correct',
      });

      expect(result.finalReviewedOutcome).toBe('repair'); // matches machine outcome
      expect(result.overrideFlag).toBe(false);
      expect(result.reviewerAction).toBe('approve_machine_result');
      expect(result.reviewCompletedAt).toBeInstanceOf(Date);
      expect(result.reviewerId).toBe('reviewer-001');
    });

    it('override_to_replace: sets finalReviewedOutcome=replace, overrideFlag=true, records overrideReasonCode', async () => {
      const result = await service.processReviewerAction({
        reviewId,
        reviewerId: 'reviewer-002',
        action: 'override_to_replace',
        overrideReasonCode: 'damage_larger_than_detected',
        reviewerNotes: 'Crack extends beyond what AI detected',
      });

      expect(result.finalReviewedOutcome).toBe('replace');
      expect(result.overrideFlag).toBe(true);
      expect(result.overrideReasonCode).toBe('damage_larger_than_detected');
      expect(result.reviewerAction).toBe('override_to_replace');
      expect(result.reviewerNotes).toBe('Crack extends beyond what AI detected');
    });

    it('override_to_repair: sets finalReviewedOutcome=repair, overrideFlag=true', async () => {
      // Create a review with replace outcome to test override to repair
      const replaceReview = await service.createManualReview({
        claimId: 'claim-action-002',
        triggerReasons: ['low_confidence'],
        triggerSource: 'automatic',
        machineAssessmentSnapshot: createMachineAssessment('replace'),
      });

      const result = await service.processReviewerAction({
        reviewId: replaceReview.reviewId,
        reviewerId: 'reviewer-003',
        action: 'override_to_repair',
        overrideReasonCode: 'damage_smaller_than_detected',
        reviewerNotes: 'Damage is actually repairable',
      });

      expect(result.finalReviewedOutcome).toBe('repair');
      expect(result.overrideFlag).toBe(true);
      expect(result.overrideReasonCode).toBe('damage_smaller_than_detected');
      expect(result.reviewerAction).toBe('override_to_repair');
    });

    it('request_retake: does not set finalReviewedOutcome to a binary decision, marks review as needing retake', async () => {
      const result = await service.processReviewerAction({
        reviewId,
        reviewerId: 'reviewer-004',
        action: 'request_retake',
        reviewerNotes: 'Damage photo is too blurry to assess',
      });

      expect(result.reviewerAction).toBe('request_retake');
      // request_retake should NOT produce a final repair/replace decision
      expect(result.finalReviewedOutcome).not.toBe('repair');
      expect(result.finalReviewedOutcome).not.toBe('replace');
      expect(result.overrideFlag).toBe(false);
      expect(result.reviewerNotes).toBe('Damage photo is too blurry to assess');
    });

    it('should emit decision.overridden event when reviewer overrides', async () => {
      await service.processReviewerAction({
        reviewId,
        reviewerId: 'reviewer-005',
        action: 'override_to_replace',
        overrideReasonCode: 'structural_damage',
      });

      expect(EventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'decision.overridden',
          claimId: 'claim-action-001',
          actorType: 'reviewer',
          actorId: 'reviewer-005',
          payload: expect.objectContaining({
            action: 'override_to_replace',
            overrideFlag: true,
            overrideReasonCode: 'structural_damage',
            machineOutcome: 'repair',
          }),
        })
      );
    });

    it('should emit decision.generated event when reviewer approves', async () => {
      await service.processReviewerAction({
        reviewId,
        reviewerId: 'reviewer-006',
        action: 'approve_machine_result',
      });

      expect(EventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'decision.generated',
          claimId: 'claim-action-001',
          actorType: 'reviewer',
          actorId: 'reviewer-006',
          payload: expect.objectContaining({
            action: 'approve_machine_result',
            overrideFlag: false,
            finalReviewedOutcome: 'repair',
          }),
        })
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Insurer-Initiated Triggers (Requirements 9.1, 9.9)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Insurer-Initiated Triggers', () => {
    it('should create review with triggerSource=insurer_initiated', async () => {
      const review = await service.createManualReview({
        claimId: 'claim-insurer-001',
        triggerReasons: ['insurer_quality_check'],
        triggerSource: 'insurer_initiated',
        priority: 'normal',
        machineAssessmentSnapshot: createMachineAssessment('repair'),
        manualTriggerReason: 'Insurer wants second opinion on repair decision',
      });

      expect(review.triggerSource).toBe('insurer_initiated');
      expect(review.claimId).toBe('claim-insurer-001');
    });

    it('should record the manual trigger reason from the insurer', async () => {
      const review = await service.createManualReview({
        claimId: 'claim-insurer-002',
        triggerReasons: ['insurer_quality_audit'],
        triggerSource: 'insurer_initiated',
        machineAssessmentSnapshot: createMachineAssessment('replace'),
        manualTriggerReason: 'Random quality audit - high value claim',
      });

      expect(review.manualTriggerReason).toBe('Random quality audit - high value claim');
    });

    it('should set priority as specified by the insurer', async () => {
      const urgentReview = await service.createManualReview({
        claimId: 'claim-insurer-003',
        triggerReasons: ['insurer_escalation'],
        triggerSource: 'insurer_initiated',
        priority: 'urgent',
        machineAssessmentSnapshot: createMachineAssessment('repair'),
        manualTriggerReason: 'Customer complaint - needs urgent review',
      });

      expect(urgentReview.priority).toBe('urgent');

      const trainingReview = await service.createManualReview({
        claimId: 'claim-insurer-004',
        triggerReasons: ['insurer_training'],
        triggerSource: 'insurer_initiated',
        priority: 'training',
        machineAssessmentSnapshot: createMachineAssessment('repair'),
        manualTriggerReason: 'Training sample for new reviewers',
      });

      expect(trainingReview.priority).toBe('training');
    });

    it('should reject insurer-initiated review without a manual trigger reason', async () => {
      await expect(
        service.createManualReview({
          claimId: 'claim-insurer-005',
          triggerReasons: ['insurer_request'],
          triggerSource: 'insurer_initiated',
          machineAssessmentSnapshot: createMachineAssessment('repair'),
          // Missing manualTriggerReason
        })
      ).rejects.toThrow('Manual trigger reason required for insurer-initiated reviews');
    });

    it('should emit event with actorType=insurer for insurer-initiated reviews', async () => {
      await service.createManualReview({
        claimId: 'claim-insurer-006',
        triggerReasons: ['insurer_quality_check'],
        triggerSource: 'insurer_initiated',
        priority: 'normal',
        machineAssessmentSnapshot: createMachineAssessment('repair'),
        manualTriggerReason: 'Quality check requested',
      });

      expect(EventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'decision.manual_review_triggered',
          claimId: 'claim-insurer-006',
          actorType: 'insurer',
          payload: expect.objectContaining({
            triggerSource: 'insurer_initiated',
            manualTriggerReason: 'Quality check requested',
            priority: 'normal',
          }),
        })
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Trigger Source Tracking (Requirements 9.1, 9.9)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Trigger Source Tracking', () => {
    it('automatic triggers record triggerSource=automatic with system-generated reasons', async () => {
      const review = await service.createManualReview({
        claimId: 'claim-tracking-001',
        triggerReasons: ['low_confidence', 'unclear_damage_pattern', 'vin_mismatch'],
        triggerSource: 'automatic',
        machineAssessmentSnapshot: createMachineAssessment('needs_manual_review'),
      });

      expect(review.triggerSource).toBe('automatic');
      expect(review.triggerReasons).toEqual([
        'low_confidence',
        'unclear_damage_pattern',
        'vin_mismatch',
      ]);
      expect(review.manualTriggerReason).toBeUndefined();
    });

    it('insurer triggers record triggerSource=insurer_initiated with insurer-provided reason', async () => {
      const review = await service.createManualReview({
        claimId: 'claim-tracking-002',
        triggerReasons: ['insurer_quality_check'],
        triggerSource: 'insurer_initiated',
        machineAssessmentSnapshot: createMachineAssessment('repair'),
        manualTriggerReason: 'Policyholder disputed the repair decision',
      });

      expect(review.triggerSource).toBe('insurer_initiated');
      expect(review.triggerReasons).toEqual(['insurer_quality_check']);
      expect(review.manualTriggerReason).toBe('Policyholder disputed the repair decision');
    });

    it('both trigger types correctly store triggerReasons array', async () => {
      // Automatic with multiple reasons
      const autoReview = await service.createManualReview({
        claimId: 'claim-tracking-003',
        triggerReasons: ['dependency_failure', 'exhausted_retries'],
        triggerSource: 'automatic',
        machineAssessmentSnapshot: createMachineAssessment('needs_manual_review'),
      });

      expect(autoReview.triggerReasons).toHaveLength(2);
      expect(autoReview.triggerReasons).toContain('dependency_failure');
      expect(autoReview.triggerReasons).toContain('exhausted_retries');

      // Insurer with single reason
      const insurerReview = await service.createManualReview({
        claimId: 'claim-tracking-004',
        triggerReasons: ['insurer_escalation'],
        triggerSource: 'insurer_initiated',
        machineAssessmentSnapshot: createMachineAssessment('replace'),
        manualTriggerReason: 'Escalation from claims manager',
      });

      expect(insurerReview.triggerReasons).toHaveLength(1);
      expect(insurerReview.triggerReasons).toContain('insurer_escalation');
    });

    it('automatic trigger emits event with actorType=system', async () => {
      await service.createManualReview({
        claimId: 'claim-tracking-005',
        triggerReasons: ['suspicious_signals'],
        triggerSource: 'automatic',
        machineAssessmentSnapshot: createMachineAssessment('needs_manual_review'),
      });

      expect(EventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'decision.manual_review_triggered',
          claimId: 'claim-tracking-005',
          actorType: 'system',
          payload: expect.objectContaining({
            triggerSource: 'automatic',
            triggerReasons: ['suspicious_signals'],
          }),
        })
      );
    });

    it('insurer trigger emits event with actorType=insurer', async () => {
      await service.createManualReview({
        claimId: 'claim-tracking-006',
        triggerReasons: ['insurer_dispute'],
        triggerSource: 'insurer_initiated',
        machineAssessmentSnapshot: createMachineAssessment('repair'),
        manualTriggerReason: 'Customer dispute',
      });

      expect(EventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'decision.manual_review_triggered',
          claimId: 'claim-tracking-006',
          actorType: 'insurer',
          payload: expect.objectContaining({
            triggerSource: 'insurer_initiated',
            triggerReasons: ['insurer_dispute'],
            manualTriggerReason: 'Customer dispute',
          }),
        })
      );
    });

    it('queue correctly filters by trigger source', async () => {
      // Create automatic reviews
      await service.createManualReview({
        claimId: 'claim-filter-001',
        triggerReasons: ['low_confidence'],
        triggerSource: 'automatic',
        machineAssessmentSnapshot: createMachineAssessment('needs_manual_review'),
      });

      await service.createManualReview({
        claimId: 'claim-filter-002',
        triggerReasons: ['vin_mismatch'],
        triggerSource: 'automatic',
        machineAssessmentSnapshot: createMachineAssessment('needs_manual_review'),
      });

      // Create insurer-initiated review
      await service.createManualReview({
        claimId: 'claim-filter-003',
        triggerReasons: ['insurer_request'],
        triggerSource: 'insurer_initiated',
        machineAssessmentSnapshot: createMachineAssessment('repair'),
        manualTriggerReason: 'Quality check',
      });

      // Filter by automatic
      const autoQueue = await service.getManualReviewQueue({ triggerSource: 'automatic' });
      expect(autoQueue).toHaveLength(2);
      expect(autoQueue.every((item) => item.triggerSource === 'automatic')).toBe(true);

      // Filter by insurer_initiated
      const insurerQueue = await service.getManualReviewQueue({
        triggerSource: 'insurer_initiated',
      });
      expect(insurerQueue).toHaveLength(1);
      expect(insurerQueue[0]!.triggerSource).toBe('insurer_initiated');
    });
  });
});
