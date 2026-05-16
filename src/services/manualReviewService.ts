/**
 * Manual Review Service
 * 
 * Manages the manual review queue and reviewer actions.
 * Preserves immutable machine assessment snapshots and tracks all reviewer decisions.
 * 
 * Key Features:
 * - Automatic and insurer-initiated manual review triggers
 * - Immutable machine assessment snapshots
 * - Reviewer actions (approve/override/request_retake)
 * - Priority levels and trigger source tracking
 * - Complete audit trail
 */

import { loggers } from '../utils/logger';
import { EventService, EVENT_TYPES } from './eventService';
import { DecisionResult, DecisionOutcome } from './decisionRulesEngine';

export type TriggerSource = 'automatic' | 'insurer_initiated';

export type ReviewerAction =
  | 'approve_machine_result'
  | 'override_to_repair'
  | 'override_to_replace'
  | 'request_retake'
  | 'request_additional_damage_photo'
  | 'mark_insufficient_evidence'
  | 'reject_for_processing';

export type ReviewPriority = 'urgent' | 'normal' | 'training';

export interface ManualReviewRecord {
  reviewId: string;
  claimId: string;
  triggerReasons: string[];
  triggerSource: TriggerSource;
  priority: ReviewPriority;
  machineAssessmentSnapshot: DecisionResult; // immutable copy
  queuedAt: Date;
  reviewStartedAt?: Date | undefined;
  reviewCompletedAt?: Date | undefined;
  reviewerId?: string | undefined;
  reviewerAction?: ReviewerAction | undefined;
  finalReviewedOutcome?: DecisionOutcome | undefined;
  overrideFlag: boolean;
  overrideReasonCode?: string | undefined;
  reviewerNotes?: string | undefined;
  manualTriggerReason?: string | undefined; // reason if insurer-initiated
}

export interface CreateManualReviewInput {
  claimId: string;
  triggerReasons: string[];
  triggerSource: TriggerSource;
  priority?: ReviewPriority;
  machineAssessmentSnapshot: DecisionResult;
  manualTriggerReason?: string; // required if insurer-initiated
}

export interface ReviewerActionInput {
  reviewId: string;
  reviewerId: string;
  action: ReviewerAction;
  overrideReasonCode?: string;
  reviewerNotes?: string;
}

export interface ManualReviewQueueItem {
  reviewId: string;
  claimId: string;
  triggerReasons: string[];
  triggerSource: TriggerSource;
  priority: ReviewPriority;
  machineAssessmentSummary: {
    outcome: DecisionOutcome;
    decisionEligible: boolean;
    overallConfidence: number;
    blockingReasons: string[];
  };
  queuedAt: Date;
  reviewStartedAt?: Date | undefined;
}

export class ManualReviewService {
  // In-memory storage for POC (will be replaced with database in production)
  private reviews: Map<string, ManualReviewRecord> = new Map();

  /**
   * Create a new manual review record
   * 
   * @param input - Manual review creation input
   * @returns Created manual review record
   */
  async createManualReview(input: CreateManualReviewInput): Promise<ManualReviewRecord> {
    const {
      claimId,
      triggerReasons,
      triggerSource,
      priority = 'normal',
      machineAssessmentSnapshot,
      manualTriggerReason,
    } = input;

    loggers.app.info('Creating manual review', {
      claimId,
      triggerReasons,
      triggerSource,
      priority,
    });

    // Validate insurer-initiated reviews have a reason
    if (triggerSource === 'insurer_initiated' && !manualTriggerReason) {
      const error = new Error('Manual trigger reason required for insurer-initiated reviews');
      loggers.app.error('Manual review creation failed', error, { claimId });
      throw error;
    }

    try {
      const reviewId = `review-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const review: ManualReviewRecord = {
        reviewId,
        claimId,
        triggerReasons,
        triggerSource,
        priority,
        machineAssessmentSnapshot: { ...machineAssessmentSnapshot }, // immutable copy
        queuedAt: new Date(),
        overrideFlag: false,
        manualTriggerReason,
      };

      // Store review
      this.reviews.set(reviewId, review);

      // Emit event
      await EventService.emit({
        eventType: EVENT_TYPES.DECISION_MANUAL_REVIEW_TRIGGERED,
        claimId,
        sourceService: 'manual-review-service',
        actorType: triggerSource === 'insurer_initiated' ? 'insurer' : 'system',
        payload: {
          reviewId,
          triggerReasons,
          triggerSource,
          priority,
          manualTriggerReason,
        },
      });

      loggers.app.info('Manual review created successfully', {
        claimId,
        reviewId,
        triggerSource,
      });

      return review;
    } catch (error) {
      loggers.app.error('Manual review creation failed', error as Error, { claimId });
      throw error;
    }
  }

  /**
   * Get manual review by review ID
   * 
   * @param reviewId - Review identifier
   * @returns Manual review record or undefined
   */
  async getManualReview(reviewId: string): Promise<ManualReviewRecord | undefined> {
    return this.reviews.get(reviewId);
  }

  /**
   * Get manual review by claim ID
   * 
   * @param claimId - Claim identifier
   * @returns Manual review record or undefined
   */
  async getManualReviewByClaimId(claimId: string): Promise<ManualReviewRecord | undefined> {
    return Array.from(this.reviews.values()).find((review) => review.claimId === claimId);
  }

  /**
   * Get manual review queue
   * 
   * @param filters - Optional filters
   * @returns Array of manual review queue items
   */
  async getManualReviewQueue(filters?: {
    triggerSource?: TriggerSource;
    priority?: ReviewPriority;
    reviewerId?: string;
  }): Promise<ManualReviewQueueItem[]> {
    let reviews = Array.from(this.reviews.values());

    // Filter by trigger source
    if (filters?.triggerSource) {
      reviews = reviews.filter((r) => r.triggerSource === filters.triggerSource);
    }

    // Filter by priority
    if (filters?.priority) {
      reviews = reviews.filter((r) => r.priority === filters.priority);
    }

    // Filter by reviewer (only show reviews assigned to this reviewer or unassigned)
    if (filters?.reviewerId) {
      reviews = reviews.filter((r) => !r.reviewerId || r.reviewerId === filters.reviewerId);
    }

    // Only show pending reviews (not completed)
    reviews = reviews.filter((r) => !r.reviewCompletedAt);

    // Sort by priority (urgent first) then by queued time
    reviews.sort((a, b) => {
      if (a.priority === 'urgent' && b.priority !== 'urgent') return -1;
      if (a.priority !== 'urgent' && b.priority === 'urgent') return 1;
      return a.queuedAt.getTime() - b.queuedAt.getTime();
    });

    // Map to queue items
    return reviews.map((review) => ({
      reviewId: review.reviewId,
      claimId: review.claimId,
      triggerReasons: review.triggerReasons,
      triggerSource: review.triggerSource,
      priority: review.priority,
      machineAssessmentSummary: {
        outcome: review.machineAssessmentSnapshot.outcome,
        decisionEligible: review.machineAssessmentSnapshot.decisionEligible,
        overallConfidence: this.calculateOverallConfidence(review.machineAssessmentSnapshot),
        blockingReasons: review.machineAssessmentSnapshot.blockingReasons,
      },
      queuedAt: review.queuedAt,
      reviewStartedAt: review.reviewStartedAt,
    }));
  }

  /**
   * Start review (assign to reviewer)
   * 
   * @param reviewId - Review identifier
   * @param reviewerId - Reviewer identifier
   */
  async startReview(reviewId: string, reviewerId: string): Promise<void> {
    const review = this.reviews.get(reviewId);
    if (!review) {
      throw new Error(`Review not found: ${reviewId}`);
    }

    if (review.reviewStartedAt) {
      throw new Error(`Review already started: ${reviewId}`);
    }

    review.reviewerId = reviewerId;
    review.reviewStartedAt = new Date();

    loggers.app.info('Review started', {
      reviewId,
      reviewerId,
      claimId: review.claimId,
    });
  }

  /**
   * Process reviewer action
   * 
   * @param input - Reviewer action input
   * @returns Updated manual review record
   */
  async processReviewerAction(input: ReviewerActionInput): Promise<ManualReviewRecord> {
    const { reviewId, reviewerId, action, overrideReasonCode, reviewerNotes } = input;

    loggers.app.info('Processing reviewer action', {
      reviewId,
      reviewerId,
      action,
    });

    const review = this.reviews.get(reviewId);
    if (!review) {
      const error = new Error(`Review not found: ${reviewId}`);
      loggers.app.error('Reviewer action failed', error, { reviewId });
      throw error;
    }

    if (review.reviewCompletedAt) {
      const error = new Error(`Review already completed: ${reviewId}`);
      loggers.app.error('Reviewer action failed', error, { reviewId });
      throw error;
    }

    try {
      // Start review if not already started
      if (!review.reviewStartedAt) {
        review.reviewerId = reviewerId;
        review.reviewStartedAt = new Date();
      }

      // Validate reviewer matches
      if (review.reviewerId !== reviewerId) {
        throw new Error(`Review assigned to different reviewer: ${review.reviewerId}`);
      }

      // Process action
      review.reviewerAction = action;
      review.reviewCompletedAt = new Date();
      review.reviewerNotes = reviewerNotes;

      // Determine final outcome and override flag
      switch (action) {
        case 'approve_machine_result':
          // Use machine's original decision
          review.finalReviewedOutcome = review.machineAssessmentSnapshot.outcome;
          review.overrideFlag = false;
          break;

        case 'override_to_repair':
          review.finalReviewedOutcome = 'repair';
          review.overrideFlag = true;
          review.overrideReasonCode = overrideReasonCode;
          break;

        case 'override_to_replace':
          review.finalReviewedOutcome = 'replace';
          review.overrideFlag = true;
          review.overrideReasonCode = overrideReasonCode;
          break;

        case 'mark_insufficient_evidence':
          review.finalReviewedOutcome = 'insufficient_evidence';
          review.overrideFlag = true;
          review.overrideReasonCode = overrideReasonCode;
          break;

        case 'request_retake':
        case 'request_additional_damage_photo':
        case 'reject_for_processing':
          // These actions don't produce a final decision
          review.finalReviewedOutcome = 'needs_manual_review';
          review.overrideFlag = false;
          break;

        default:
          throw new Error(`Unknown reviewer action: ${action}`);
      }

      // Emit event
      const eventType = review.overrideFlag
        ? EVENT_TYPES.DECISION_OVERRIDDEN
        : EVENT_TYPES.DECISION_GENERATED;

      await EventService.emit({
        eventType,
        claimId: review.claimId,
        sourceService: 'manual-review-service',
        actorType: 'reviewer',
        actorId: reviewerId,
        payload: {
          reviewId,
          action,
          finalReviewedOutcome: review.finalReviewedOutcome,
          overrideFlag: review.overrideFlag,
          overrideReasonCode: review.overrideReasonCode,
          machineOutcome: review.machineAssessmentSnapshot.outcome,
        },
      });

      loggers.app.info('Reviewer action processed successfully', {
        reviewId,
        claimId: review.claimId,
        action,
        finalReviewedOutcome: review.finalReviewedOutcome,
        overrideFlag: review.overrideFlag,
      });

      return review;
    } catch (error) {
      loggers.app.error('Reviewer action processing failed', error as Error, { reviewId });
      throw error;
    }
  }

  /**
   * Get review statistics
   * 
   * @returns Review statistics
   */
  async getReviewStatistics(): Promise<{
    totalReviews: number;
    pendingReviews: number;
    completedReviews: number;
    overrideRate: number;
    averageReviewTimeMinutes: number;
  }> {
    const reviews = Array.from(this.reviews.values());
    const completedReviews = reviews.filter((r) => r.reviewCompletedAt);
    const pendingReviews = reviews.filter((r) => !r.reviewCompletedAt);
    const overriddenReviews = completedReviews.filter((r) => r.overrideFlag);

    const reviewTimes = completedReviews
      .filter((r) => r.reviewStartedAt && r.reviewCompletedAt)
      .map((r) => {
        const start = r.reviewStartedAt!.getTime();
        const end = r.reviewCompletedAt!.getTime();
        return (end - start) / 1000 / 60; // minutes
      });

    const averageReviewTimeMinutes =
      reviewTimes.length > 0 ? reviewTimes.reduce((a, b) => a + b, 0) / reviewTimes.length : 0;

    const overrideRate =
      completedReviews.length > 0 ? overriddenReviews.length / completedReviews.length : 0;

    return {
      totalReviews: reviews.length,
      pendingReviews: pendingReviews.length,
      completedReviews: completedReviews.length,
      overrideRate,
      averageReviewTimeMinutes,
    };
  }

  /**
   * Calculate overall confidence from machine assessment
   * 
   * @param assessment - Machine assessment
   * @returns Overall confidence score
   */
  private calculateOverallConfidence(assessment: DecisionResult): number {
    const confidenceScores = Object.values(assessment.confidenceSummary);
    if (confidenceScores.length === 0) return 0;
    return confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length;
  }

  /**
   * Clear all reviews (for testing only)
   */
  async clearAllReviews(): Promise<void> {
    this.reviews.clear();
    loggers.app.info('All reviews cleared');
  }
}

// Export singleton instance
export const manualReviewService = new ManualReviewService();
