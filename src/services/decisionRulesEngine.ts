/**
 * Decision Rules Engine
 * 
 * Deterministic rules engine that checks all prerequisites before issuing
 * repair or replace decisions. Never emits a binary decision when eligibility is blocked.
 * 
 * Hard Safety Rule: If decisionEligible is false, outcome MUST NOT be repair or replace.
 */

import { loggers } from '../utils/logger';
import { EventService, EVENT_TYPES } from './eventService';
import { DamageAnalysisResult, EvidenceSufficiency } from './damageAnalysisService';
import { GlassTypeAnalysisResult, GlassType } from './glassTypeAnalysisService';
import { VINEnrichmentResult, VINResultState, AdasStatus } from './vinEnrichmentService';
import { config } from '../config';

export type DecisionOutcome = 'repair' | 'replace' | 'needs_manual_review' | 'insufficient_evidence' | 'unable_to_assess';

export interface DecisionPrerequisiteChecks {
  consentCaptured: boolean;
  allFixedPhotosAccepted: boolean;       // all 5 slots
  atLeastOneDamagePhotoAccepted: boolean;
  evidenceNotInsufficient: boolean;
  structuredDamageOutputPresent: boolean;
  noUnresolvedVinConflict: boolean;
  noBlockingOperationalFlags: boolean;
  confidenceThresholdsMet: boolean;
  noMandatoryManualReviewTrigger: boolean;
}

export interface DecisionResult {
  claimId: string;
  outcome: DecisionOutcome;
  decisionEligible: boolean;
  prerequisiteChecks: DecisionPrerequisiteChecks;
  blockingReasons: string[];
  justification: string;
  confidenceSummary: Record<string, number>;
  rulesVersion: string;
  generatedAt: Date;
}

export interface DecisionInputs {
  claimId: string;
  consentCaptured: boolean;
  fixedPhotosAccepted: {
    front_vehicle: boolean;
    inside_driver: boolean;
    inside_passenger: boolean;
    vin_cutout: boolean;
    logo_silkscreen: boolean;
  };
  damagePhotosAccepted: number; // Count of accepted damage photos
  damageAnalysis?: DamageAnalysisResult;
  glassTypeAnalysis?: GlassTypeAnalysisResult;
  vinEnrichment?: VINEnrichmentResult;
  operationalFlags?: {
    systemError?: boolean;
    dataQualityIssue?: boolean;
    suspiciousActivity?: boolean;
  };
}

export class DecisionRulesEngine {
  private readonly rulesVersion: string;
  private readonly confidenceThreshold: number;

  constructor() {
    this.rulesVersion = config.assessment.rulesVersion || '1.0.0';
    this.confidenceThreshold = config.damageAnalysis.confidenceThreshold;
  }

  /**
   * Generate a deterministic decision based on all inputs
   * 
   * @param inputs - All decision inputs
   * @returns Decision result with outcome and justification
   */
  async generateDecision(inputs: DecisionInputs): Promise<DecisionResult> {
    const { claimId } = inputs;

    loggers.app.info('Starting decision generation', {
      claimId,
      consentCaptured: inputs.consentCaptured,
      damagePhotosAccepted: inputs.damagePhotosAccepted,
      hasDamageAnalysis: !!inputs.damageAnalysis,
      hasGlassTypeAnalysis: !!inputs.glassTypeAnalysis,
      hasVinEnrichment: !!inputs.vinEnrichment,
    });

    try {
      // Step 1: Check all prerequisites
      const prerequisiteChecks = this.checkPrerequisites(inputs);
      const blockingReasons = this.getBlockingReasons(prerequisiteChecks);
      const decisionEligible = blockingReasons.length === 0;

      // Step 2: Build confidence summary
      const confidenceSummary = this.buildConfidenceSummary(inputs);

      // Step 3: Determine outcome
      let outcome: DecisionOutcome;
      let justification: string;

      if (!decisionEligible) {
        // Prerequisites not met - cannot issue repair or replace
        outcome = this.determineNonEligibleOutcome(prerequisiteChecks, inputs);
        justification = this.buildNonEligibleJustification(blockingReasons, prerequisiteChecks);
      } else {
        // Prerequisites met - apply decision logic
        const decisionLogic = this.applyDecisionLogic(inputs);
        outcome = decisionLogic.outcome;
        justification = decisionLogic.justification;
      }

      // Hard safety check: Ensure repair/replace not issued when ineligible
      if (!decisionEligible && (outcome === 'repair' || outcome === 'replace')) {
        const safetyError = new Error('Safety violation: Cannot issue repair/replace when decision is ineligible');
        loggers.app.error('SAFETY VIOLATION: Attempted to issue repair/replace when ineligible', safetyError, {
          claimId,
          outcome,
          decisionEligible,
          blockingReasons,
        });
        throw safetyError;
      }

      const result: DecisionResult = {
        claimId,
        outcome,
        decisionEligible,
        prerequisiteChecks,
        blockingReasons,
        justification,
        confidenceSummary,
        rulesVersion: this.rulesVersion,
        generatedAt: new Date(),
      };

      // Emit decision event
      await EventService.emit({
        eventType: EVENT_TYPES.DECISION_GENERATED,
        claimId,
        sourceService: 'decision-rules-engine',
        actorType: 'system',
        payload: {
          outcome,
          decisionEligible,
          blockingReasons,
          rulesVersion: this.rulesVersion,
        },
      });

      loggers.app.info('Decision generated successfully', {
        claimId,
        outcome,
        decisionEligible,
        blockingReasons,
      });

      return result;
    } catch (error) {
      loggers.app.error('Decision generation failed', error as Error, { claimId });
      throw error;
    }
  }

  /**
   * Check all 9 prerequisites for decision eligibility
   */
  private checkPrerequisites(inputs: DecisionInputs): DecisionPrerequisiteChecks {
    const {
      consentCaptured,
      fixedPhotosAccepted,
      damagePhotosAccepted,
      damageAnalysis,
      vinEnrichment,
      operationalFlags,
    } = inputs;

    // 1. Consent captured
    const consentCheck = consentCaptured;

    // 2. All 5 fixed photo slots accepted
    const allFixedPhotosCheck =
      fixedPhotosAccepted.front_vehicle &&
      fixedPhotosAccepted.inside_driver &&
      fixedPhotosAccepted.inside_passenger &&
      fixedPhotosAccepted.vin_cutout &&
      fixedPhotosAccepted.logo_silkscreen;

    // 3. At least 1 damage photo accepted
    const atLeastOneDamagePhotoCheck = damagePhotosAccepted >= 1;

    // 4. Claim-level evidence sufficiency is not insufficient
    const evidenceNotInsufficientCheck =
      !damageAnalysis || damageAnalysis.evidenceSufficiencyAssessment !== 'insufficient';

    // 5. Required structured damage analysis outputs present
    const structuredDamageOutputCheck =
      !!damageAnalysis &&
      Array.isArray(damageAnalysis.damagePoints) &&
      typeof damageAnalysis.overallConfidence === 'number' &&
      !!damageAnalysis.evidenceSufficiencyAssessment;

    // 6. No unresolved VIN conflict
    const noVinConflictCheck =
      !vinEnrichment ||
      vinEnrichment.vinResultState !== 'mismatch' ||
      !vinEnrichment.vinMismatchFlag;

    // 7. No blocking operational or data quality flags
    const noBlockingFlagsCheck =
      !operationalFlags?.systemError &&
      !operationalFlags?.dataQualityIssue &&
      !operationalFlags?.suspiciousActivity;

    // 8. Confidence thresholds met
    const confidenceThresholdsCheck = this.checkConfidenceThresholds(inputs);

    // 9. No mandatory manual review trigger has fired
    const noMandatoryManualReviewCheck = this.checkNoMandatoryManualReview(inputs);

    return {
      consentCaptured: consentCheck,
      allFixedPhotosAccepted: allFixedPhotosCheck,
      atLeastOneDamagePhotoAccepted: atLeastOneDamagePhotoCheck,
      evidenceNotInsufficient: evidenceNotInsufficientCheck,
      structuredDamageOutputPresent: structuredDamageOutputCheck,
      noUnresolvedVinConflict: noVinConflictCheck,
      noBlockingOperationalFlags: noBlockingFlagsCheck,
      confidenceThresholdsMet: confidenceThresholdsCheck,
      noMandatoryManualReviewTrigger: noMandatoryManualReviewCheck,
    };
  }

  /**
   * Check if confidence thresholds are met
   */
  private checkConfidenceThresholds(inputs: DecisionInputs): boolean {
    const { damageAnalysis, glassTypeAnalysis, vinEnrichment } = inputs;

    // Damage analysis confidence
    if (damageAnalysis && damageAnalysis.overallConfidence < this.confidenceThreshold) {
      return false;
    }

    // Glass type analysis confidence (if ADAS vehicle)
    if (
      vinEnrichment?.adasStatus === 'yes' &&
      glassTypeAnalysis &&
      glassTypeAnalysis.confidence < this.confidenceThreshold
    ) {
      return false;
    }

    // VIN OCR confidence (if OCR was used)
    if (
      vinEnrichment &&
      vinEnrichment.ocrConfidenceScore !== undefined &&
      vinEnrichment.ocrConfidenceScore < this.confidenceThreshold
    ) {
      return false;
    }

    return true;
  }

  /**
   * Check if any mandatory manual review triggers have fired
   */
  private checkNoMandatoryManualReview(inputs: DecisionInputs): boolean {
    const { damageAnalysis, vinEnrichment } = inputs;

    // Insufficient evidence triggers manual review
    if (damageAnalysis?.evidenceSufficiencyAssessment === 'insufficient') {
      return false;
    }

    // VIN unavailable triggers manual review
    if (vinEnrichment?.vinResultState === 'unavailable') {
      return false;
    }

    // ADAS unknown triggers manual review
    if (vinEnrichment?.adasStatus === 'unknown') {
      return false;
    }

    // Note: Glass type (OEM vs Aftermarket) does NOT trigger manual review
    // Both OEM and Aftermarket windscreens can have ADAS capabilities

    return true;
  }

  /**
   * Get list of blocking reasons from prerequisite checks
   */
  private getBlockingReasons(checks: DecisionPrerequisiteChecks): string[] {
    const reasons: string[] = [];

    if (!checks.consentCaptured) {
      reasons.push('consent_not_captured');
    }
    if (!checks.allFixedPhotosAccepted) {
      reasons.push('missing_required_photos');
    }
    if (!checks.atLeastOneDamagePhotoAccepted) {
      reasons.push('no_damage_photos');
    }
    if (!checks.evidenceNotInsufficient) {
      reasons.push('insufficient_evidence');
    }
    if (!checks.structuredDamageOutputPresent) {
      reasons.push('missing_damage_analysis');
    }
    if (!checks.noUnresolvedVinConflict) {
      reasons.push('vin_mismatch');
    }
    if (!checks.noBlockingOperationalFlags) {
      reasons.push('operational_flags');
    }
    if (!checks.confidenceThresholdsMet) {
      reasons.push('low_confidence');
    }
    if (!checks.noMandatoryManualReviewTrigger) {
      reasons.push('mandatory_manual_review');
    }

    return reasons;
  }

  /**
   * Build confidence summary from all inputs
   */
  private buildConfidenceSummary(inputs: DecisionInputs): Record<string, number> {
    const summary: Record<string, number> = {};

    if (inputs.damageAnalysis) {
      summary.damageAnalysis = inputs.damageAnalysis.overallConfidence;
    }

    if (inputs.glassTypeAnalysis) {
      summary.glassTypeAnalysis = inputs.glassTypeAnalysis.confidence;
    }

    if (inputs.vinEnrichment?.ocrConfidenceScore !== undefined) {
      summary.vinOcr = inputs.vinEnrichment.ocrConfidenceScore;
    }

    return summary;
  }

  /**
   * Determine outcome when prerequisites are not met
   */
  private determineNonEligibleOutcome(
    checks: DecisionPrerequisiteChecks,
    inputs: DecisionInputs
  ): DecisionOutcome {
    // Insufficient evidence
    if (!checks.evidenceNotInsufficient || !checks.structuredDamageOutputPresent) {
      return 'insufficient_evidence';
    }

    // Unable to assess (missing critical data)
    if (
      !checks.consentCaptured ||
      !checks.allFixedPhotosAccepted ||
      !checks.atLeastOneDamagePhotoAccepted
    ) {
      return 'unable_to_assess';
    }

    // Needs manual review (all other cases)
    return 'needs_manual_review';
  }

  /**
   * Build justification for non-eligible outcome
   */
  private buildNonEligibleJustification(
    blockingReasons: string[],
    checks: DecisionPrerequisiteChecks
  ): string {
    const reasons = blockingReasons.map((reason) => {
      switch (reason) {
        case 'consent_not_captured':
          return 'Consent not captured';
        case 'missing_required_photos':
          return 'Missing required photos';
        case 'no_damage_photos':
          return 'No damage photos accepted';
        case 'insufficient_evidence':
          return 'Evidence sufficiency is insufficient';
        case 'missing_damage_analysis':
          return 'Damage analysis output missing or incomplete';
        case 'vin_mismatch':
          return 'Unresolved VIN mismatch';
        case 'operational_flags':
          return 'Blocking operational or data quality flags';
        case 'low_confidence':
          return 'Confidence thresholds not met';
        case 'mandatory_manual_review':
          return 'Mandatory manual review trigger fired';
        default:
          return reason;
      }
    });

    return `Decision cannot be automated. Blocking reasons: ${reasons.join(', ')}`;
  }

  /**
   * Apply decision logic when prerequisites are met
   */
  private applyDecisionLogic(inputs: DecisionInputs): { outcome: DecisionOutcome; justification: string } {
    const { damageAnalysis } = inputs;

    // Safety check: Should not reach here if prerequisites not met
    if (!damageAnalysis) {
      return {
        outcome: 'unable_to_assess',
        justification: 'Damage analysis missing',
      };
    }

    // Note: ADAS vehicles do NOT require OEM glass
    // Both OEM and Aftermarket windscreens can have ADAS capabilities
    // Glass type (OEM vs Aftermarket) does not affect repair/replace decision

    // Analyze damage points for repair eligibility
    const repairEligibleDamage = damageAnalysis.damagePoints.filter((point) => {
      const attrs = point.severityAttributes as {
        repairEligible?: boolean;
        damageType?: string;
        inDPVA?: boolean;
      };
      return attrs.repairEligible === true;
    });

    const nonRepairableDamage = damageAnalysis.damagePoints.filter((point) => {
      const attrs = point.severityAttributes as {
        repairEligible?: boolean;
        damageType?: string;
        inDPVA?: boolean;
      };
      return attrs.repairEligible === false;
    });

    // Decision logic
    if (nonRepairableDamage.length > 0) {
      // Has non-repairable damage → Replace
      const reasons = nonRepairableDamage.map((point) => {
        const attrs = point.severityAttributes as {
          repairBlockingReasons?: string[];
          damageType?: string;
        };
        return attrs.repairBlockingReasons?.join(', ') || 'damage not repairable';
      });

      return {
        outcome: 'replace',
        justification: `Replacement required. Non-repairable damage detected: ${reasons.join('; ')}`,
      };
    } else if (repairEligibleDamage.length > 0) {
      // All damage is repairable → Repair
      const damageTypes = repairEligibleDamage.map((point) => {
        const attrs = point.severityAttributes as { damageType?: string };
        return attrs.damageType || 'unknown';
      });

      return {
        outcome: 'repair',
        justification: `Repair eligible. All damage points are repairable: ${damageTypes.join(', ')}`,
      };
    } else {
      // No damage points or unclear damage → Manual review
      return {
        outcome: 'needs_manual_review',
        justification: 'No clear damage points identified. Manual review required.',
      };
    }
  }

  /**
   * Trigger manual review for a claim
   * 
   * @param claimId - Claim identifier
   * @param triggerReasons - Reasons for manual review
   * @param machineAssessment - Machine assessment snapshot (optional)
   */
  async triggerManualReview(
    claimId: string,
    triggerReasons: string[],
    machineAssessment?: DecisionResult
  ): Promise<void> {
    loggers.app.info('Triggering manual review', {
      claimId,
      triggerReasons,
      hasMachineAssessment: !!machineAssessment,
    });

    await EventService.emit({
      eventType: EVENT_TYPES.DECISION_MANUAL_REVIEW_TRIGGERED,
      claimId,
      sourceService: 'decision-rules-engine',
      actorType: 'system',
      payload: {
        triggerReasons,
        machineAssessment: machineAssessment || null,
      },
    });

    loggers.app.info('Manual review triggered successfully', { claimId });
  }
}

// Export singleton instance
export const decisionRulesEngine = new DecisionRulesEngine();
