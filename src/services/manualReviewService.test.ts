/**
 * Manual Review Service Tests
 * 
 * Tests for manual review queue and reviewer actions including:
 * - Manual review creation (automatic and insurer-initiated)
 * - Immutable machine assessment snapshots
 * - Reviewer actions (approve/override/request_retake)
 * - Priority levels and trigger source tracking
 * - Queue filtering and sorting
 * - Review statistics
 */

import {
  ManualReviewService,
  CreateManualReviewInput,
  ReviewerActionInput,
  TriggerSource,
  ReviewPriority,
} from './manualReviewService';
import { EventService } from './eventService';
import { DecisionResult, DecisionOutcome } from './decisionRulesEngine';

// Mock EventService
jest.mock('./eventService', () => ({
  EventService: {
    emit: jest.fn(),
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

describe('ManualReviewService', () => {
  let service: ManualReviewService;

  beforeEach(async () => {
    jest.clearAllMocks();
    service = new ManualReviewService();
    await service.clearAllReviews();
  });

  // Helper function to create a machine assessment
  const createMachineAssessment = (outcome: DecisionOutcome = 'needs_manual_review'): DecisionResult => ({
    claimId: 'test-claim-123',
    outcome,
    decisionEligible: false,
    prerequisiteChecks: {
      consentCaptured: true,
      allFixedPhotosAccepted: true,
      atLeastOneDamagePhotoAccepted: true,
      evidenceNotInsufficient: true,
      structuredDamageOutputPresent: true,
      noUnresolvedVinConflict: true,
      noBlockingOperationalFlags: true,
      confidenceThresholdsMet: false,
      noMandatoryManualReviewTrigger: false,
    },
    blockingReasons: ['low_confidence'],
    justification: 'Confidence below threshold',
    confidenceSummary: {
      damageAnalysis: 0.65,
      glassTypeAnalysis: 0.70,
    },
    rulesVersion: '1.0.0',
    generatedAt: new Date(),
  });

  describe('Create Manual Review', () => {
    it('should create automatic manual review', async () => {
      const input: CreateManualReviewInput = {
        claimId: 'claim-123',
        triggerReasons: ['low_confidence', 'unclear_damage'],
        triggerSource: 'automatic',
        priority: 'normal',
        machineAssessmentSnapshot: createMachineAssessment(),
      };

      const review = await service.createManualReview(input);

      expect(review.reviewId).toBeDefined();
      expect(review.claimId).toBe('claim-123');
      expect(review.triggerReasons).toEqual(['low_confidence', 'unclear_damage']);
      expect(review.triggerSource).toBe('automatic');
      expect(review.priority).toBe('normal');
      expect(review.machineAssessmentSnapshot).toBeDefined();
      expect(review.queuedAt).toBeInstanceOf(Date);
      expect(review.overrideFlag).toBe(false);
      expect(review.reviewCompletedAt).toBeUndefined();
    });

    it('should create insurer-initiated manual review with reason', async () => {
      const input: CreateManualReviewInput = {
        claimId: 'claim-456',
        triggerReasons: ['insurer_request'],
        triggerSource: 'insurer_initiated',
        priority: 'urgent',
        machineAssessmentSnapshot: createMachineAssessment('repair'),
        manualTriggerReason: 'quality_check',
      };

      const review = await service.createManualReview(input);

      expect(review.triggerSource).toBe('insurer_initiated');
      expect(review.priority).toBe('urgent');
      expect(review.manualTriggerReason).toBe('quality_check');
    });

    it('should fail insurer-initiated review without manual trigger reason', async () => {
      const input: CreateManualReviewInput = {
        claimId: 'claim-789',
        triggerReasons: ['insurer_request'],
        triggerSource: 'insurer_initiated',
        machineAssessmentSnapshot: createMachineAssessment(),
        // Missing manualTriggerReason
      };

      await expect(service.createManualReview(input)).rejects.toThrow(
        'Manual trigger reason required for insurer-initiated reviews'
      );
    });

    it('should emit decision.manual_review_triggered event', async () => {
      const input: CreateManualReviewInput = {
        claimId: 'claim-123',
        triggerReasons: ['low_confidence'],
        triggerSource: 'automatic',
        machineAssessmentSnapshot: createMachineAssessment(),
      };

      await service.createManualReview(input);

      expect(EventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'decision.manual_review_triggered',
          claimId: 'claim-123',
          sourceService: 'manual-review-service',
          actorType: 'system',
          payload: expect.objectContaining({
            triggerReasons: ['low_confidence'],
            triggerSource: 'automatic',
          }),
        })
      );
    });

    it('should preserve immutable machine assessment snapshot', async () => {
      const machineAssessment = createMachineAssessment();
      const input: CreateManualReviewInput = {
        claimId: 'claim-123',
        triggerReasons: ['low_confidence'],
        triggerSource: 'automatic',
        machineAssessmentSnapshot: machineAssessment,
      };

      const review = await service.createManualReview(input);

      // Verify snapshot is a copy, not a reference
      expect(review.machineAssessmentSnapshot).not.toBe(machineAssessment);
      expect(review.machineAssessmentSnapshot).toEqual(machineAssessment);
    });
  });

  describe('Get Manual Review', () => {
    it('should get manual review by review ID', async () => {
      const input: CreateManualReviewInput = {
        claimId: 'claim-123',
        triggerReasons: ['low_confidence'],
        triggerSource: 'automatic',
        machineAssessmentSnapshot: createMachineAssessment(),
      };

      const created = await service.createManualReview(input);
      const retrieved = await service.getManualReview(created.reviewId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.reviewId).toBe(created.reviewId);
      expect(retrieved?.claimId).toBe('claim-123');
    });

    it('should return undefined for non-existent review', async () => {
      const retrieved = await service.getManualReview('non-existent-id');
      expect(retrieved).toBeUndefined();
    });

    it('should get manual review by claim ID', async () => {
      const input: CreateManualReviewInput = {
        claimId: 'claim-123',
        triggerReasons: ['low_confidence'],
        triggerSource: 'automatic',
        machineAssessmentSnapshot: createMachineAssessment(),
      };

      await service.createManualReview(input);
      const retrieved = await service.getManualReviewByClaimId('claim-123');

      expect(retrieved).toBeDefined();
      expect(retrieved?.claimId).toBe('claim-123');
    });
  });

  describe('Manual Review Queue', () => {
    beforeEach(async () => {
      // Create multiple reviews with different properties
      await service.createManualReview({
        claimId: 'claim-1',
        triggerReasons: ['low_confidence'],
        triggerSource: 'automatic',
        priority: 'normal',
        machineAssessmentSnapshot: createMachineAssessment(),
      });

      await service.createManualReview({
        claimId: 'claim-2',
        triggerReasons: ['insurer_request'],
        triggerSource: 'insurer_initiated',
        priority: 'urgent',
        machineAssessmentSnapshot: createMachineAssessment(),
        manualTriggerReason: 'quality_check',
      });

      await service.createManualReview({
        claimId: 'claim-3',
        triggerReasons: ['unclear_damage'],
        triggerSource: 'automatic',
        priority: 'training',
        machineAssessmentSnapshot: createMachineAssessment(),
      });
    });

    it('should get all pending reviews', async () => {
      const queue = await service.getManualReviewQueue();

      expect(queue).toHaveLength(3);
      expect(queue.every((item) => !item.reviewStartedAt)).toBe(true);
    });

    it('should sort by priority (urgent first) then by queued time', async () => {
      const queue = await service.getManualReviewQueue();

      expect(queue[0]!.priority).toBe('urgent');
      expect(queue[0]!.claimId).toBe('claim-2');
    });

    it('should filter by trigger source', async () => {
      const queue = await service.getManualReviewQueue({
        triggerSource: 'insurer_initiated',
      });

      expect(queue).toHaveLength(1);
      expect(queue[0]!.claimId).toBe('claim-2');
    });

    it('should filter by priority', async () => {
      const queue = await service.getManualReviewQueue({
        priority: 'training',
      });

      expect(queue).toHaveLength(1);
      expect(queue[0]!.claimId).toBe('claim-3');
    });

    it('should include machine assessment summary', async () => {
      const queue = await service.getManualReviewQueue();

      expect(queue[0]!.machineAssessmentSummary).toBeDefined();
      expect(queue[0]!.machineAssessmentSummary.outcome).toBe('needs_manual_review');
      expect(queue[0]!.machineAssessmentSummary.decisionEligible).toBe(false);
      expect(queue[0]!.machineAssessmentSummary.blockingReasons).toEqual(['low_confidence']);
    });

    it('should exclude completed reviews from queue', async () => {
      const review = await service.getManualReviewByClaimId('claim-1');
      await service.processReviewerAction({
        reviewId: review!.reviewId,
        reviewerId: 'reviewer-1',
        action: 'approve_machine_result',
      });

      const queue = await service.getManualReviewQueue();

      expect(queue).toHaveLength(2);
      expect(queue.every((item) => item.claimId !== 'claim-1')).toBe(true);
    });
  });

  describe('Start Review', () => {
    it('should start review and assign to reviewer', async () => {
      const review = await service.createManualReview({
        claimId: 'claim-123',
        triggerReasons: ['low_confidence'],
        triggerSource: 'automatic',
        machineAssessmentSnapshot: createMachineAssessment(),
      });

      await service.startReview(review.reviewId, 'reviewer-1');

      const updated = await service.getManualReview(review.reviewId);
      expect(updated?.reviewerId).toBe('reviewer-1');
      expect(updated?.reviewStartedAt).toBeInstanceOf(Date);
    });

    it('should fail to start already started review', async () => {
      const review = await service.createManualReview({
        claimId: 'claim-123',
        triggerReasons: ['low_confidence'],
        triggerSource: 'automatic',
        machineAssessmentSnapshot: createMachineAssessment(),
      });

      await service.startReview(review.reviewId, 'reviewer-1');

      await expect(service.startReview(review.reviewId, 'reviewer-2')).rejects.toThrow(
        'Review already started'
      );
    });
  });

  describe('Reviewer Actions', () => {
    let reviewId: string;

    beforeEach(async () => {
      const review = await service.createManualReview({
        claimId: 'claim-123',
        triggerReasons: ['low_confidence'],
        triggerSource: 'automatic',
        machineAssessmentSnapshot: createMachineAssessment('repair'),
      });
      reviewId = review.reviewId;
    });

    it('should approve machine result', async () => {
      const input: ReviewerActionInput = {
        reviewId,
        reviewerId: 'reviewer-1',
        action: 'approve_machine_result',
        reviewerNotes: 'Machine assessment looks correct',
      };

      const result = await service.processReviewerAction(input);

      expect(result.reviewerAction).toBe('approve_machine_result');
      expect(result.finalReviewedOutcome).toBe('repair');
      expect(result.overrideFlag).toBe(false);
      expect(result.reviewCompletedAt).toBeInstanceOf(Date);
      expect(result.reviewerNotes).toBe('Machine assessment looks correct');
    });

    it('should override to repair', async () => {
      const input: ReviewerActionInput = {
        reviewId,
        reviewerId: 'reviewer-1',
        action: 'override_to_repair',
        overrideReasonCode: 'damage_smaller_than_detected',
        reviewerNotes: 'Damage is actually repairable',
      };

      const result = await service.processReviewerAction(input);

      expect(result.reviewerAction).toBe('override_to_repair');
      expect(result.finalReviewedOutcome).toBe('repair');
      expect(result.overrideFlag).toBe(true);
      expect(result.overrideReasonCode).toBe('damage_smaller_than_detected');
    });

    it('should override to replace', async () => {
      const input: ReviewerActionInput = {
        reviewId,
        reviewerId: 'reviewer-1',
        action: 'override_to_replace',
        overrideReasonCode: 'damage_larger_than_detected',
        reviewerNotes: 'Replacement required',
      };

      const result = await service.processReviewerAction(input);

      expect(result.reviewerAction).toBe('override_to_replace');
      expect(result.finalReviewedOutcome).toBe('replace');
      expect(result.overrideFlag).toBe(true);
    });

    it('should mark insufficient evidence', async () => {
      const input: ReviewerActionInput = {
        reviewId,
        reviewerId: 'reviewer-1',
        action: 'mark_insufficient_evidence',
        overrideReasonCode: 'photos_unclear',
      };

      const result = await service.processReviewerAction(input);

      expect(result.finalReviewedOutcome).toBe('insufficient_evidence');
      expect(result.overrideFlag).toBe(true);
    });

    it('should request retake', async () => {
      const input: ReviewerActionInput = {
        reviewId,
        reviewerId: 'reviewer-1',
        action: 'request_retake',
        reviewerNotes: 'Please retake damage photo',
      };

      const result = await service.processReviewerAction(input);

      expect(result.reviewerAction).toBe('request_retake');
      expect(result.finalReviewedOutcome).toBe('needs_manual_review');
      expect(result.overrideFlag).toBe(false);
    });

    it('should emit decision.generated event when approving', async () => {
      await service.processReviewerAction({
        reviewId,
        reviewerId: 'reviewer-1',
        action: 'approve_machine_result',
      });

      expect(EventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'decision.generated',
          claimId: 'claim-123',
          sourceService: 'manual-review-service',
          actorType: 'reviewer',
          actorId: 'reviewer-1',
        })
      );
    });

    it('should emit decision.overridden event when overriding', async () => {
      await service.processReviewerAction({
        reviewId,
        reviewerId: 'reviewer-1',
        action: 'override_to_replace',
        overrideReasonCode: 'damage_larger',
      });

      expect(EventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'decision.overridden',
          claimId: 'claim-123',
          sourceService: 'manual-review-service',
          actorType: 'reviewer',
          actorId: 'reviewer-1',
          payload: expect.objectContaining({
            overrideFlag: true,
            overrideReasonCode: 'damage_larger',
          }),
        })
      );
    });

    it('should fail to process action on completed review', async () => {
      await service.processReviewerAction({
        reviewId,
        reviewerId: 'reviewer-1',
        action: 'approve_machine_result',
      });

      await expect(
        service.processReviewerAction({
          reviewId,
          reviewerId: 'reviewer-1',
          action: 'override_to_repair',
        })
      ).rejects.toThrow('Review already completed');
    });

    it('should auto-start review if not started', async () => {
      const result = await service.processReviewerAction({
        reviewId,
        reviewerId: 'reviewer-1',
        action: 'approve_machine_result',
      });

      expect(result.reviewerId).toBe('reviewer-1');
      expect(result.reviewStartedAt).toBeInstanceOf(Date);
    });
  });

  describe('Machine Assessment Preservation', () => {
    it('should preserve original machine assessment after approval', async () => {
      const machineAssessment = createMachineAssessment('repair');
      const review = await service.createManualReview({
        claimId: 'claim-123',
        triggerReasons: ['low_confidence'],
        triggerSource: 'automatic',
        machineAssessmentSnapshot: machineAssessment,
      });

      await service.processReviewerAction({
        reviewId: review.reviewId,
        reviewerId: 'reviewer-1',
        action: 'approve_machine_result',
      });

      const updated = await service.getManualReview(review.reviewId);
      expect(updated?.machineAssessmentSnapshot).toEqual(machineAssessment);
    });

    it('should preserve original machine assessment after override', async () => {
      const machineAssessment = createMachineAssessment('repair');
      const review = await service.createManualReview({
        claimId: 'claim-123',
        triggerReasons: ['low_confidence'],
        triggerSource: 'automatic',
        machineAssessmentSnapshot: machineAssessment,
      });

      await service.processReviewerAction({
        reviewId: review.reviewId,
        reviewerId: 'reviewer-1',
        action: 'override_to_replace',
        overrideReasonCode: 'damage_larger',
      });

      const updated = await service.getManualReview(review.reviewId);
      expect(updated?.machineAssessmentSnapshot).toEqual(machineAssessment);
      expect(updated?.machineAssessmentSnapshot.outcome).toBe('repair'); // Original
      expect(updated?.finalReviewedOutcome).toBe('replace'); // Overridden
    });
  });

  describe('Review Statistics', () => {
    it('should calculate review statistics', async () => {
      // Create 3 reviews
      const review1 = await service.createManualReview({
        claimId: 'claim-1',
        triggerReasons: ['low_confidence'],
        triggerSource: 'automatic',
        machineAssessmentSnapshot: createMachineAssessment(),
      });

      const review2 = await service.createManualReview({
        claimId: 'claim-2',
        triggerReasons: ['unclear_damage'],
        triggerSource: 'automatic',
        machineAssessmentSnapshot: createMachineAssessment(),
      });

      const review3 = await service.createManualReview({
        claimId: 'claim-3',
        triggerReasons: ['insurer_request'],
        triggerSource: 'insurer_initiated',
        machineAssessmentSnapshot: createMachineAssessment(),
        manualTriggerReason: 'quality_check',
      });

      // Complete 2 reviews (1 approved, 1 overridden)
      await service.processReviewerAction({
        reviewId: review1.reviewId,
        reviewerId: 'reviewer-1',
        action: 'approve_machine_result',
      });

      await service.processReviewerAction({
        reviewId: review2.reviewId,
        reviewerId: 'reviewer-1',
        action: 'override_to_repair',
        overrideReasonCode: 'damage_smaller',
      });

      const stats = await service.getReviewStatistics();

      expect(stats.totalReviews).toBe(3);
      expect(stats.pendingReviews).toBe(1);
      expect(stats.completedReviews).toBe(2);
      expect(stats.overrideRate).toBe(0.5); // 1 out of 2 completed
    });
  });
});
