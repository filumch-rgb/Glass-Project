// Core domain types for the Glass Claim Assessment System

export interface ClaimInspection {
  id: number;
  customerId?: string;
  claimNumber: string;
  insurerId: string;
  externalStatus: string;
  internalStatus: InternalStatus;
  policyholderName: string;
  policyholderMobile: string;
  policyholderEmail?: string;
  insurerProvidedVin?: string;
  intakeMessageId: string;
  receivedAt: Date;
  consentCaptured: boolean;
  decisionEligibility?: boolean;
  assessmentOutcome?: string;
  finalDecision?: string;
  rulesVersion?: string;
  outputSchemaVersion?: string;
  createdAt: Date;
  updatedAt: Date;
  inspectionData: InspectionData;
}

export type InternalStatus = 
  | 'intake_received'
  | 'intake_validated'
  | 'intake_failed'
  | 'journey_created'
  | 'notification_sent'
  | 'notification_opened'
  | 'awaiting_consent'
  | 'awaiting_photos'
  | 'validating_photos'
  | 'photos_validated'
  | 'photos_insufficient'
  | 'vin_enrichment_pending'
  | 'vin_enrichment_complete'
  | 'damage_analysis_pending'
  | 'damage_analysis_complete'
  | 'decision_pending'
  | 'manual_review_required'
  | 'decision_complete'
  | 'result_delivered'
  | 'failed_validation'
  | 'failed_processing'
  | 'abandoned';

export type ExternalStatus = 
  | 'Message Sent'
  | 'Message Opened'
  | 'Photos In Progress'
  | 'Photos Submitted'
  | 'Under Review'
  | 'Result Ready'
  | 'Needs Action'
  | 'Abandoned';

export interface InspectionData {
  rawIntakePayload: Record<string, string>;
  validationDetails: {
    intakeKey: string;
    parseErrors?: string[];
    validatedAt?: string;
  };
  vinEnrichmentPayload?: VINEnrichmentResult;
  damageAnalysisPayload?: DamageAnalysisResult;
  decisionPrerequisiteChecks?: DecisionPrerequisiteChecks;
  manualReviewMetadataSnapshot?: {
    reviewId: string;
    triggerReasons: string[];
    machineAssessmentSnapshot: DecisionResult;
  };
}

export interface Journey {
  id: number;
  journeyId: string;
  claimId: string;
  channel: 'pwa' | 'whatsapp';
  tokenJti: string;
  expiresAt: Date;
  revoked: boolean;
  consentCaptured: boolean;
  consentCapturedAt?: Date;
  consentVersion?: string;
  legalNoticeVersion?: string;
  sessionMetadata: Record<string, unknown>;
  createdAt: Date;
}

export type FixedPhotoSlot = 'front_vehicle' | 'vin_cutout' | 'logo_silkscreen' | 'inside_driver' | 'inside_passenger';
export type DamagePhotoSlot = 'damage_1' | 'damage_2' | 'damage_3';
export type PhotoSlot = FixedPhotoSlot | DamagePhotoSlot;

export type PhotoValidationOutcome =
  | 'accepted'
  | 'accepted_with_warning'
  | 'accepted_low_quality'
  | 'rejected_retake_required';

export interface UploadedPhoto {
  id: number;
  photoId: string;
  claimId: string;
  journeyId: string;
  slot: PhotoSlot;
  storageKey: string;
  mimeType: string;
  fileSizeBytes: number;
  uploadedAt: Date;
  validationOutcome: PhotoValidationOutcome;
  validationDetails: Record<string, unknown>;
}

export type VINResultState = 'validated' | 'ocr_only' | 'insurer_only' | 'mismatch' | 'unavailable';

export interface VINEnrichmentResult {
  claimId: string;
  vinResultState: VINResultState;
  insurerProvidedVin?: string;
  ocrExtractedVin?: string;
  bestValidatedVin?: string;
  vehicleData?: {
    make: string;
    model: string;
    year: number;
    bodyType: string;
  };
  adasStatus: 'yes' | 'no' | 'unknown';
  mismatchDetected: boolean;
  enrichedAt: Date;
}

export type EvidenceSufficiency = 'in_progress' | 'sufficient' | 'sufficient_with_warnings' | 'insufficient';

export interface DamageAnalysisResult {
  claimId: string;
  damagePoints: Array<{
    affectedRegion: string;
    severityAttributes: Record<string, unknown>;
    glassObservations: string[];
  }>;
  overallConfidence: number;
  uncertaintyIndicators: string[];
  insufficiencyFlags: string[];
  evidenceSufficiencyAssessment: EvidenceSufficiency;
  analysedAt: Date;
}

export type DecisionOutcome = 'repair' | 'replace' | 'needs_manual_review' | 'insufficient_evidence' | 'unable_to_assess';

export interface DecisionPrerequisiteChecks {
  consentCaptured: boolean;
  allFixedPhotosAccepted: boolean;
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

export type ReviewerAction =
  | 'approve_machine_result'
  | 'override_to_repair'
  | 'override_to_replace'
  | 'request_retake'
  | 'request_additional_damage_photo'
  | 'mark_insufficient_evidence'
  | 'reject_for_processing';

export interface ManualReviewRecord {
  id: number;
  reviewId: string;
  claimId: string;
  triggerReasons: string[];
  machineAssessmentSnapshot: DecisionResult;
  queuedAt: Date;
  reviewStartedAt?: Date;
  reviewCompletedAt?: Date;
  reviewerId?: string;
  reviewerAction?: ReviewerAction;
  finalReviewedOutcome?: DecisionOutcome;
  overrideFlag: boolean;
  overrideReasonCode?: string;
  reviewerNotes?: string;
  manualTriggerReason?: string;
  triggerSource: 'automatic' | 'insurer_initiated';
}

export interface EventEnvelope {
  id: number;
  eventId: string;
  eventType: string;
  claimId: string;
  timestamp: Date;
  sourceService: string;
  actorType: 'system' | 'claimant' | 'reviewer' | 'insurer';
  actorId?: string;
  correlationId?: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

export interface NotificationDelivery {
  id: number;
  claimId: string;
  channel: 'sms' | 'whatsapp';
  providerMessageId?: string;
  sentAt?: Date;
  deliveredAt?: Date;
  openedAt?: Date;
  status: string;
  errorDetails?: Record<string, unknown>;
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
    details?: unknown;
  };
  timestamp: string;
  requestId?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Configuration types
export interface DatabaseConfig {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
  url: string;
}