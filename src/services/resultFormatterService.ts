/**
 * Result Formatter Service
 * 
 * Assembles the insurer JSON output contract, validates it against a Joi schema,
 * and delivers it. Tracks decision source (automated/manually_reviewed/hybrid)
 * and includes all blocking reasons and prerequisite check results.
 * 
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6
 */

import Joi from 'joi';
import { loggers } from '../utils/logger';
import { EventService, EVENT_TYPES } from './eventService';
import { DecisionResult, DecisionOutcome, DecisionPrerequisiteChecks } from './decisionRulesEngine';
import { ManualReviewRecord } from './manualReviewService';
import { VINEnrichmentResult } from './vinEnrichmentService';
import { DamageAnalysisResult } from './damageAnalysisService';
import { GlassTypeAnalysisResult } from './glassTypeAnalysisService';
import { StatusService } from './statusService';
import { InternalStatus } from '../types';

// Schema version for the output contract
const SCHEMA_VERSION = '1.0.0';

/**
 * Decision source indicates how the final decision was reached
 * - automated: No manual review, decision made entirely by the rules engine
 * - manually_reviewed: Reviewer made the final call (override)
 * - hybrid: Reviewer approved the machine assessment without overriding
 */
export type FinalDecisionSource = 'automated' | 'manually_reviewed' | 'hybrid';

/**
 * Complete insurer JSON output contract
 * Conforms to Requirement 12.2
 */
export interface InsurerJsonOutput {
  schema_version: string;
  claim_id: string;
  claim_number: string;
  external_status: string;
  internal_status: string;
  assessment_outcome: string;
  decision_eligibility: boolean;
  blocking_reasons: string[];
  final_decision: DecisionOutcome;
  final_decision_source: FinalDecisionSource;
  justification: string;
  confidence_summary: Record<string, number>;
  prerequisite_checks: DecisionPrerequisiteChecks;
  vin_data: VinDataOutput | null;
  damage_summary: DamageSummaryOutput | null;
  glass_type_summary: GlassTypeSummaryOutput | null;
  manual_review_flag: boolean;
  manual_review_reason_codes: string[];
  generated_at: string; // ISO 8601
  rules_version: string;
}

/**
 * VIN data subset for the output contract
 */
export interface VinDataOutput {
  vin_result_state: string;
  insurer_provided_vin?: string;
  ocr_extracted_vin?: string;
  ocr_confidence_score?: number;
  best_validated_vin?: string;
  vin_mismatch_flag: boolean;
  decoder_used?: string;
  vehicle_data?: {
    make: string;
    model: string;
    year?: number;
    body_type?: string;
    color?: string;
  };
  adas_status: string;
  adas_features?: string[];
}

/**
 * Damage summary subset for the output contract
 */
export interface DamageSummaryOutput {
  damage_points: Array<{
    affected_region: string;
    severity_attributes: Record<string, unknown>;
    glass_observations: string[];
  }>;
  overall_confidence: number;
  uncertainty_indicators: string[];
  insufficiency_flags: string[];
  evidence_sufficiency_assessment: string;
  analysed_at: string; // ISO 8601
}

/**
 * Glass type summary subset for the output contract
 */
export interface GlassTypeSummaryOutput {
  glass_manufacturer?: string;
  vehicle_manufacturer_logo?: string;
  glass_type: string;
  confidence: number;
  uncertainty_indicators: string[];
  analysed_at: string; // ISO 8601
}

/**
 * Input data required to format the insurer JSON output
 */
export interface ResultFormatterInput {
  claimId: string;
  claimNumber: string;
  internalStatus: InternalStatus;
  decisionResult: DecisionResult;
  vinEnrichment?: VINEnrichmentResult;
  damageAnalysis?: DamageAnalysisResult;
  glassTypeAnalysis?: GlassTypeAnalysisResult;
  manualReview?: ManualReviewRecord;
}

/**
 * Joi schema for validating the insurer JSON output contract
 * Ensures all required fields are present and correctly typed
 */
const insurerOutputSchema = Joi.object<InsurerJsonOutput>({
  schema_version: Joi.string().required(),
  claim_id: Joi.string().required(),
  claim_number: Joi.string().required(),
  external_status: Joi.string().required(),
  internal_status: Joi.string().required(),
  assessment_outcome: Joi.string().required(),
  decision_eligibility: Joi.boolean().required(),
  blocking_reasons: Joi.array().items(Joi.string()).required(),
  final_decision: Joi.string()
    .valid('repair', 'replace', 'needs_manual_review', 'insufficient_evidence', 'unable_to_assess')
    .required(),
  final_decision_source: Joi.string()
    .valid('automated', 'manually_reviewed', 'hybrid')
    .required(),
  justification: Joi.string().required(),
  confidence_summary: Joi.object().pattern(Joi.string(), Joi.number()).required(),
  prerequisite_checks: Joi.object({
    consentCaptured: Joi.boolean().required(),
    allFixedPhotosAccepted: Joi.boolean().required(),
    atLeastOneDamagePhotoAccepted: Joi.boolean().required(),
    evidenceNotInsufficient: Joi.boolean().required(),
    structuredDamageOutputPresent: Joi.boolean().required(),
    noUnresolvedVinConflict: Joi.boolean().required(),
    noBlockingOperationalFlags: Joi.boolean().required(),
    confidenceThresholdsMet: Joi.boolean().required(),
    noMandatoryManualReviewTrigger: Joi.boolean().required(),
  }).required(),
  vin_data: Joi.object({
    vin_result_state: Joi.string().required(),
    insurer_provided_vin: Joi.string().optional(),
    ocr_extracted_vin: Joi.string().optional(),
    ocr_confidence_score: Joi.number().optional(),
    best_validated_vin: Joi.string().optional(),
    vin_mismatch_flag: Joi.boolean().required(),
    decoder_used: Joi.string().optional(),
    vehicle_data: Joi.object({
      make: Joi.string().required(),
      model: Joi.string().required(),
      year: Joi.number().optional(),
      body_type: Joi.string().optional(),
      color: Joi.string().optional(),
    }).optional(),
    adas_status: Joi.string().required(),
    adas_features: Joi.array().items(Joi.string()).optional(),
  }).allow(null).required(),
  damage_summary: Joi.object({
    damage_points: Joi.array().items(
      Joi.object({
        affected_region: Joi.string().required(),
        severity_attributes: Joi.object().pattern(Joi.string(), Joi.any()).required(),
        glass_observations: Joi.array().items(Joi.string()).required(),
      })
    ).required(),
    overall_confidence: Joi.number().min(0).max(1).required(),
    uncertainty_indicators: Joi.array().items(Joi.string()).required(),
    insufficiency_flags: Joi.array().items(Joi.string()).required(),
    evidence_sufficiency_assessment: Joi.string().required(),
    analysed_at: Joi.string().isoDate().required(),
  }).allow(null).required(),
  glass_type_summary: Joi.object({
    glass_manufacturer: Joi.string().optional(),
    vehicle_manufacturer_logo: Joi.string().optional(),
    glass_type: Joi.string().required(),
    confidence: Joi.number().min(0).max(1).required(),
    uncertainty_indicators: Joi.array().items(Joi.string()).required(),
    analysed_at: Joi.string().isoDate().required(),
  }).allow(null).required(),
  manual_review_flag: Joi.boolean().required(),
  manual_review_reason_codes: Joi.array().items(Joi.string()).required(),
  generated_at: Joi.string().isoDate().required(),
  rules_version: Joi.string().required(),
}).required();

export class ResultFormatterService {
  /**
   * Format the complete insurer JSON output for a claim
   * 
   * Collects all assessment data, determines decision source,
   * formats into the output contract, and validates against schema.
   * 
   * @param input - All assessment data for the claim
   * @returns Validated insurer JSON output
   * @throws Error if schema validation fails
   */
  async formatResult(input: ResultFormatterInput): Promise<InsurerJsonOutput> {
    const {
      claimId,
      claimNumber,
      internalStatus,
      decisionResult,
      vinEnrichment,
      damageAnalysis,
      glassTypeAnalysis,
      manualReview,
    } = input;

    loggers.app.info('Formatting insurer JSON output', {
      claimId,
      claimNumber,
      internalStatus,
      hasManualReview: !!manualReview,
    });

    try {
      // Derive external status from internal status
      const externalStatus = StatusService.deriveExternalStatus(internalStatus);

      // Determine final decision and source
      const { finalDecision, finalDecisionSource, justification } = this.determineFinalDecision(
        decisionResult,
        manualReview
      );

      // Determine assessment outcome
      const assessmentOutcome = this.determineAssessmentOutcome(decisionResult, manualReview);

      // Format VIN data
      const vinData = this.formatVinData(vinEnrichment);

      // Format damage summary
      const damageSummary = this.formatDamageSummary(damageAnalysis);

      // Format glass type summary
      const glassTypeSummary = this.formatGlassTypeSummary(glassTypeAnalysis);

      // Determine manual review flag and reason codes
      const manualReviewFlag = !!manualReview;
      const manualReviewReasonCodes = manualReview?.triggerReasons || [];

      // Assemble the output
      const output: InsurerJsonOutput = {
        schema_version: SCHEMA_VERSION,
        claim_id: claimId,
        claim_number: claimNumber,
        external_status: externalStatus,
        internal_status: internalStatus,
        assessment_outcome: assessmentOutcome,
        decision_eligibility: decisionResult.decisionEligible,
        blocking_reasons: decisionResult.blockingReasons,
        final_decision: finalDecision,
        final_decision_source: finalDecisionSource,
        justification,
        confidence_summary: decisionResult.confidenceSummary,
        prerequisite_checks: decisionResult.prerequisiteChecks,
        vin_data: vinData,
        damage_summary: damageSummary,
        glass_type_summary: glassTypeSummary,
        manual_review_flag: manualReviewFlag,
        manual_review_reason_codes: manualReviewReasonCodes,
        generated_at: new Date().toISOString(),
        rules_version: decisionResult.rulesVersion,
      };

      // Validate against schema (Requirement 12.3)
      const validatedOutput = this.validateOutput(output);

      // Emit result.delivered event (Requirement 12.6)
      await EventService.emit({
        eventType: EVENT_TYPES.RESULT_DELIVERED,
        claimId,
        sourceService: 'result-formatter-service',
        actorType: 'system',
        payload: {
          schemaVersion: SCHEMA_VERSION,
          finalDecision,
          finalDecisionSource,
          manualReviewFlag,
        },
      });

      loggers.app.info('Insurer JSON output formatted and validated successfully', {
        claimId,
        claimNumber,
        finalDecision,
        finalDecisionSource,
        schemaVersion: SCHEMA_VERSION,
      });

      return validatedOutput;
    } catch (error) {
      loggers.app.error('Failed to format insurer JSON output', error as Error, {
        claimId,
        claimNumber,
      });
      throw error;
    }
  }

  /**
   * Determine the final decision and its source
   * 
   * Decision source logic (Requirement 12.4):
   * - "automated": No manual review occurred, decision from rules engine
   * - "manually_reviewed": Reviewer overrode the machine assessment
   * - "hybrid": Reviewer approved the machine assessment without overriding
   */
  private determineFinalDecision(
    decisionResult: DecisionResult,
    manualReview?: ManualReviewRecord
  ): {
    finalDecision: DecisionOutcome;
    finalDecisionSource: FinalDecisionSource;
    justification: string;
  } {
    if (!manualReview || !manualReview.reviewCompletedAt) {
      // No manual review — fully automated
      return {
        finalDecision: decisionResult.outcome,
        finalDecisionSource: 'automated',
        justification: decisionResult.justification,
      };
    }

    if (manualReview.overrideFlag) {
      // Reviewer overrode the machine assessment
      return {
        finalDecision: manualReview.finalReviewedOutcome || decisionResult.outcome,
        finalDecisionSource: 'manually_reviewed',
        justification: manualReview.reviewerNotes
          ? `Reviewer override: ${manualReview.reviewerNotes}`
          : `Reviewer override (reason: ${manualReview.overrideReasonCode || 'not specified'})`,
      };
    }

    // Reviewer approved the machine assessment (hybrid)
    return {
      finalDecision: manualReview.finalReviewedOutcome || decisionResult.outcome,
      finalDecisionSource: 'hybrid',
      justification: decisionResult.justification,
    };
  }

  /**
   * Determine the assessment outcome string
   * This represents the machine's original assessment regardless of manual review
   */
  private determineAssessmentOutcome(
    decisionResult: DecisionResult,
    manualReview?: ManualReviewRecord
  ): string {
    // The assessment outcome is always the machine's original decision
    return decisionResult.outcome;
  }

  /**
   * Format VIN enrichment data for the output contract
   */
  private formatVinData(vinEnrichment?: VINEnrichmentResult): VinDataOutput | null {
    if (!vinEnrichment) {
      return null;
    }

    const vinData: VinDataOutput = {
      vin_result_state: vinEnrichment.vinResultState,
      vin_mismatch_flag: vinEnrichment.vinMismatchFlag,
      adas_status: vinEnrichment.adasStatus,
    };

    if (vinEnrichment.insurerProvidedVin) {
      vinData.insurer_provided_vin = vinEnrichment.insurerProvidedVin;
    }

    if (vinEnrichment.ocrExtractedVin) {
      vinData.ocr_extracted_vin = vinEnrichment.ocrExtractedVin;
    }

    if (vinEnrichment.ocrConfidenceScore !== undefined) {
      vinData.ocr_confidence_score = vinEnrichment.ocrConfidenceScore;
    }

    if (vinEnrichment.bestValidatedVin) {
      vinData.best_validated_vin = vinEnrichment.bestValidatedVin;
    }

    if (vinEnrichment.decoderUsed) {
      vinData.decoder_used = vinEnrichment.decoderUsed;
    }

    if (vinEnrichment.vehicleData) {
      vinData.vehicle_data = {
        make: vinEnrichment.vehicleData.make,
        model: vinEnrichment.vehicleData.model,
        ...(vinEnrichment.vehicleData.year !== undefined && { year: vinEnrichment.vehicleData.year }),
        ...(vinEnrichment.vehicleData.bodyType && { body_type: vinEnrichment.vehicleData.bodyType }),
        ...(vinEnrichment.vehicleData.color && { color: vinEnrichment.vehicleData.color }),
      };
    }

    if (vinEnrichment.adasFeatures && vinEnrichment.adasFeatures.length > 0) {
      vinData.adas_features = vinEnrichment.adasFeatures;
    }

    return vinData;
  }

  /**
   * Format damage analysis data for the output contract
   */
  private formatDamageSummary(damageAnalysis?: DamageAnalysisResult): DamageSummaryOutput | null {
    if (!damageAnalysis) {
      return null;
    }

    return {
      damage_points: damageAnalysis.damagePoints.map((point) => ({
        affected_region: point.affectedRegion,
        severity_attributes: point.severityAttributes,
        glass_observations: point.glassObservations,
      })),
      overall_confidence: damageAnalysis.overallConfidence,
      uncertainty_indicators: damageAnalysis.uncertaintyIndicators,
      insufficiency_flags: damageAnalysis.insufficiencyFlags,
      evidence_sufficiency_assessment: damageAnalysis.evidenceSufficiencyAssessment,
      analysed_at: damageAnalysis.analysedAt.toISOString(),
    };
  }

  /**
   * Format glass type analysis data for the output contract
   */
  private formatGlassTypeSummary(glassTypeAnalysis?: GlassTypeAnalysisResult): GlassTypeSummaryOutput | null {
    if (!glassTypeAnalysis) {
      return null;
    }

    const summary: GlassTypeSummaryOutput = {
      glass_type: glassTypeAnalysis.glassType,
      confidence: glassTypeAnalysis.confidence,
      uncertainty_indicators: glassTypeAnalysis.uncertaintyIndicators,
      analysed_at: glassTypeAnalysis.analysedAt.toISOString(),
    };

    if (glassTypeAnalysis.glassManufacturer) {
      summary.glass_manufacturer = glassTypeAnalysis.glassManufacturer;
    }

    if (glassTypeAnalysis.vehicleManufacturerLogo) {
      summary.vehicle_manufacturer_logo = glassTypeAnalysis.vehicleManufacturerLogo;
    }

    return summary;
  }

  /**
   * Validate the output against the Joi schema (Requirement 12.3)
   * 
   * @param output - The assembled output to validate
   * @returns The validated output
   * @throws Error if validation fails
   */
  private validateOutput(output: InsurerJsonOutput): InsurerJsonOutput {
    const { error, value } = insurerOutputSchema.validate(output, {
      abortEarly: false,
      stripUnknown: false,
    });

    if (error) {
      const validationErrors = error.details.map((d) => d.message).join('; ');
      const validationError = new Error(
        `Insurer JSON output schema validation failed: ${validationErrors}`
      );
      loggers.app.error('Schema validation failed', validationError, {
        claimId: output.claim_id,
        errors: error.details.map((d) => ({
          path: d.path.join('.'),
          message: d.message,
        })),
      });
      throw validationError;
    }

    return value as InsurerJsonOutput;
  }
}

// Export singleton instance
export const resultFormatterService = new ResultFormatterService();

// Export the schema for external use (e.g., API documentation)
export { insurerOutputSchema };
