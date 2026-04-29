# Requirements Document

## Introduction

The Glass Claim Assessment System is a Phase 1 controlled pilot for windscreen-only insurance claims. It enables claimants to complete a guided evidence capture journey, validates photo evidence quality, enriches vehicle data, applies deterministic repair/replace rules, and routes uncertain cases to manual review. The system produces structured, explainable JSON outputs for eligible claims and is designed to be operationally manageable for risk-averse insurance carriers.

This document covers the full scope of the Phase 1 pilot: email intake, consent gating, photo capture and validation, VIN enrichment, damage analysis, decision rules, manual review, dual status model, event logging, security, persistence, and insurer output.

---

## Glossary

| Term | Definition |
|------|-----------|
| **System** | The Glass Claim Assessment System |
| **Claim** | An insurance claim for automotive windscreen damage |
| **Policyholder** | The insured individual whose vehicle has windscreen damage |
| **Insurer** | The insurance company submitting and receiving claim results |
| **Reviewer** | A human operator who performs manual review of claims |
| **PWA** | Progressive Web Application used for browser-based photo capture |
| **VIN** | Vehicle Identification Number |
| **ADAS** | Advanced Driver Assistance Systems |
| **OEM** | Original Equipment Manufacturer glass |
| **Aftermarket** | Non-OEM replacement glass |
| **Mailbox** | Dedicated email inbox that receives claim submission emails from Insurers |
| **CronJob** | Scheduled background process that polls the Mailbox every 15 minutes |
| **Journey** | The guided claimant experience for consent capture and photo submission |
| **Journey Token** | Signed, high-entropy, expiring token scoped to a single claim journey |
| **Consent** | Explicit claimant acceptance of the legal notice before any photo upload |
| **Fixed Photo** | One of the 5 required photos with a defined subject (front vehicle, VIN cutout, logo/silkscreen, inside driver side, inside passenger side) |
| **Damage Photo** | A photo of the windscreen damage; between 1 and 3 are required |
| **Photo Slot** | A named position in the photo set (5 fixed + up to 3 damage) |
| **Evidence Sufficiency** | Claim-level assessment of whether the photo set is adequate for decisioning |
| **VIN Result State** | One of: validated, ocr_only, insurer_only, mismatch, unavailable |
| **Decision Eligibility** | Whether all prerequisites for a final repair/replace decision have been met |
| **Assessment Outcome** | The structured result of damage analysis (not a final decision) |
| **Final Decision** | The deterministic repair/replace outcome, or needs_manual_review / insufficient_evidence / unable_to_assess |
| **Manual Review** | Human review of a claim that cannot be automatically decided |
| **Override** | A reviewer's decision that differs from the machine assessment |
| **External Status** | The insurer/claimant-facing claim status |
| **Internal Status** | The operational claim status used within the system |
| **Event** | An immutable, timestamped record of a material lifecycle transition |
| **Audit Trail** | The complete ordered sequence of events for a claim |
| **Intake Key** | Derived idempotency key combining email message ID and claim number |
| **Operating Mode** | System-level configuration controlling automation level: advisory_only, manual_review_required, automation_allowed_for_eligible_claims |
| **Rules Version** | The version identifier of the deterministic decision rules applied to a claim |
| **Schema Version** | The version identifier of the insurer JSON output contract |

---

## Requirements

### Requirement 1: Email Claim Intake

**User Story:** As an Insurer, I want to submit windscreen claims by sending a structured email to a dedicated mailbox, so that I can onboard quickly without API integration during the pilot phase.

#### Acceptance Criteria

1. WHEN the CronJob polls the Mailbox, THE System SHALL search for unread emails with subject "New Glass Claim" every 15 minutes
2. WHEN a matching email is found, THE System SHALL parse the email body for the following fields in key: value format: insurer name, insurer ID, claim number, policyholder name, policyholder mobile, and optionally policyholder email and insurer VIN
3. WHEN a claim email is successfully parsed, THE System SHALL validate that all required fields (insurer name, insurer ID, claim number, policyholder name, policyholder mobile) are present and non-empty
4. WHEN a valid claim email is parsed, THE System SHALL generate a unique claim identifier and store the claim with internal status intake_received
5. WHEN a claim is stored, THE System SHALL record the email message ID, claim number, and derived intake key for idempotency
6. WHEN an email is successfully processed, THE CronJob SHALL move it to the "Completed" folder and SHALL NOT process it again
7. WHEN an email has already been processed (intake key exists in storage), THE System SHALL skip it without creating a duplicate claim
8. WHEN required fields are missing or unparseable, THE System SHALL mark the claim as intake_failed, store the parse errors, emit a claim.intake_failed event, and move the email to a "Failed" folder
9. WHEN a claim is stored, THE System SHALL record the received timestamp and source email metadata

---

### Requirement 2: Consent — Hard Gate

**User Story:** As an Insurer, I want to ensure claimants explicitly consent to data processing before any photos are uploaded, so that the system complies with privacy obligations.

#### Acceptance Criteria

1. WHEN a Journey is created, THE System SHALL present the legal notice to the Policyholder before any photo upload interface is shown
2. THE legal notice SHALL include: a description of image and data processing, notification that automated analysis will be performed, notification that manual review may occur, a link to the privacy notice, and a support contact
3. WHEN using the PWA channel, THE System SHALL require the Policyholder to explicitly accept the notice before proceeding
4. WHEN using the WhatsApp channel, THE System SHALL require an affirmative text response before proceeding
5. WHEN consent is captured, THE System SHALL store: consent_captured (boolean), consent_captured_at (timestamp), consent_version, legal_notice_version, channel, and session metadata
6. THE System SHALL NOT allow any photo upload or downstream processing to begin until consent_captured is true for the claim
7. WHEN consent has not been captured, THE System SHALL reject any photo upload attempt and return an error

---

### Requirement 3: Photo Model

**User Story:** As a Policyholder, I want clear guidance on exactly which photos to submit, so that my claim can be assessed accurately.

#### Acceptance Criteria

1. THE System SHALL require exactly 5 fixed photos per claim: (1) front vehicle, (2) VIN cutout, (3) logo/silkscreen, (4) inside driver side, (5) inside passenger side
2. THE System SHALL require at least 1 damage photo and SHALL accept up to 3 damage photos per claim
3. WHEN the Policyholder accesses the photo capture interface, THE System SHALL display instructions and guidance for each required photo slot
4. THE System SHALL display a visual reference image for each photo slot showing the expected framing and subject matter
5. BEFORE the photo capture journey begins, THE System SHALL display a preparation checklist reminding the Policyholder to have their car keys available for interior photos
6. THE System SHALL track each fixed photo slot independently and SHALL NOT consider a slot filled until its photo is accepted
7. THE System SHALL track damage photo slots independently and SHALL allow replacement of a rejected damage photo
8. WHEN all 5 fixed photo slots are accepted AND at least 1 damage photo is accepted AND no more than 3 damage photos are present, THE System SHALL mark the photo set as complete

---

### Requirement 4: Photo Validation and Camera-Only Enforcement

**User Story:** As the System, I want to validate each uploaded photo before accepting it and ensure photos are taken live with the device camera (not uploaded from camera roll), so that only fresh, usable evidence is retained for assessment and fraud risk is minimized.

#### Acceptance Criteria

1. WHEN using the PWA channel, THE System SHALL enforce camera-only capture by using the `capture="environment"` attribute on file input elements to prevent gallery/camera roll access and ensure photos are taken live with the device camera
2. THE System SHALL provide clear, user-friendly error messages when photos are rejected, explaining what needs to be corrected and how to retake the photo
3. WHEN a photo is uploaded, THE System SHALL validate: supported MIME type, readable file, file size within configured limit, minimum resolution met, acceptable sharpness, acceptable brightness, likely correct framing for the slot type, likely not a duplicate of another photo in the same claim, and EXIF timestamp indicates recent capture (within last 10 minutes)
4. WHEN EXIF timestamp validation fails or indicates the photo was not recently captured, THE System SHALL assign it outcome rejected_retake_required with reason "photo_not_recently_captured"
5. WHEN a photo passes all validation checks including EXIF timestamp validation, THE System SHALL assign it outcome accepted
6. WHEN a photo passes validation but has quality warnings, THE System SHALL assign it outcome accepted_with_warning or accepted_low_quality as appropriate
7. WHEN a photo fails one or more validation checks, THE System SHALL assign it outcome rejected_retake_required
8. WHEN a fixed photo slot is rejected, THE System SHALL request a retake for that slot with clear guidance on what went wrong
9. WHEN a damage photo is rejected, THE System SHALL allow the Policyholder to submit a replacement damage photo with clear guidance
10. THE System SHALL assign a claim-level evidence sufficiency outcome of: in_progress (photo set not yet complete), sufficient (all slots accepted), sufficient_with_warnings (accepted with quality warnings), or insufficient (required slots rejected or missing)
11. THE System SHALL NOT issue a final assessment while claim-level evidence sufficiency is insufficient
12. WHEN photo validation completes for a photo, THE System SHALL emit a photo.validated or photo.rejected event

---

### Requirement 5: Journey and Token Management

**User Story:** As the System, I want to issue secure, expiring journey tokens to claimants, so that only authorised claimants can upload photos for their specific claim.

#### Acceptance Criteria

1. WHEN a Journey is created, THE System SHALL generate a signed, high-entropy, expiring Journey Token scoped to that claim only
2. THE Journey Token SHALL expire after 24 hours by default (configurable)
3. THE System SHALL support token revocation and reissue
4. WHEN a Journey Token is expired or revoked, THE System SHALL reject any requests using that token
5. THE System SHALL apply rate limiting to all journey endpoints
6. WHEN a Journey expires without completion, THE System SHALL mark the claim as abandoned after the configured abandonment threshold (24–48 hours, configurable)

---

### Requirement 6: VIN Enrichment

**User Story:** As the System, I want to enrich claim data with validated vehicle information, so that the decision engine has accurate vehicle context.

#### Acceptance Criteria

1. WHEN an insurer-provided VIN is present, THE System SHALL initiate VIN decode after intake validation completes
2. WHEN the VIN cutout photo is accepted, THE System SHALL perform OCR VIN extraction on that photo
3. WHEN both an insurer-provided VIN and an OCR-extracted VIN are available, THE System SHALL run mismatch detection and compare the two values
4. IF the insurer-provided VIN and OCR-extracted VIN do not match, THE System SHALL set VIN result state to mismatch and route the claim to manual review
5. THE System SHALL use only the best validated VIN for ADAS lookup
6. THE System SHALL assign a VIN result state to every claim: validated (both match), ocr_only (no insurer VIN), insurer_only (no OCR result), mismatch (both present but differ), or unavailable (neither available)
7. WHEN VIN result state is mismatch or unavailable, THE System SHALL either degrade decision eligibility or route to manual review
8. WHEN VIN enrichment completes, THE System SHALL emit a vin.enrichment_completed event

---

### Requirement 7: Damage Analysis

**User Story:** As the System, I want to analyse all accepted damage photos and produce structured damage findings, so that the decision engine has reliable inputs.

#### Acceptance Criteria

1. WHEN evidence sufficiency is sufficient or sufficient_with_warnings, THE System SHALL submit all accepted damage photos for damage analysis
2. THE damage analysis output SHALL include: damage points and affected regions, severity attributes, glass observations relevant to repair/replace logic, overall confidence score, and evidence sufficiency assessment
3. THE damage analysis output SHALL be structured (no free-form narrative as primary output)
4. THE damage analysis output SHALL include confidence and uncertainty indicators
5. THE damage analysis output SHALL include insufficiency flags when evidence is inadequate
6. WHEN damage analysis completes, THE System SHALL emit a damage.analysis_completed event
7. WHEN damage analysis fails, THE System SHALL emit a damage.analysis_failed event and route the claim to manual review

---

### Requirement 8: Decision Rules Engine

**User Story:** As an Insurer, I want deterministic, explainable repair/replace decisions, so that I can trust and audit automated outcomes.

#### Acceptance Criteria

1. THE Decision Rules Engine SHALL be deterministic: the same inputs SHALL always produce the same output
2. THE Decision Rules Engine SHALL produce one of the following outcomes: repair, replace, needs_manual_review, insufficient_evidence, or unable_to_assess
3. BEFORE issuing a repair or replace outcome, THE System SHALL verify ALL of the following prerequisites are met: (a) consent captured, (b) all 5 fixed photo slots accepted, (c) at least 1 damage photo accepted, (d) claim-level evidence sufficiency is not insufficient, (e) required structured damage analysis outputs are present, (f) no unresolved VIN conflict, (g) no blocking operational or data quality flags, (h) confidence thresholds met, (i) no mandatory manual review trigger has fired
4. IF any prerequisite in criterion 3 is not met, THE System SHALL NOT emit repair or replace and SHALL instead emit needs_manual_review, insufficient_evidence, or unable_to_assess as appropriate
5. WHEN a final decision is generated, THE System SHALL record the rules_version applied
6. WHEN a final decision is generated, THE System SHALL emit a decision.generated event

---

### Requirement 9: Manual Review

**User Story:** As a Reviewer, I want a first-class manual review workflow that preserves the original machine assessment as an immutable snapshot, so that I can handle claims that cannot be automatically decided while maintaining full audit trail.

#### Acceptance Criteria

1. THE System SHALL route a claim to manual review when any of the following triggers fire: low confidence, insufficient evidence, VIN mismatch, blocking rule conflict, dependency failure, unclear damage outcome, suspicious signals, exhausted retries, or insurer-initiated manual review request
2. WHEN a claim enters manual review, THE System SHALL emit a decision.manual_review_triggered event
3. WHEN a claim enters manual review, THE System SHALL create an immutable snapshot of the machine assessment (including all prerequisite checks, confidence scores, damage analysis results, and decision reasoning) and store it permanently in the manual_reviews collection
4. THE System SHALL provide a manual review queue showing all claims pending review with trigger reasons and machine assessment summary
5. A Reviewer SHALL be able to perform the following actions on a queued claim: approve machine result (if machine suggested repair/replace), override to repair, override to replace, request retake, request additional damage photo, mark insufficient evidence, or reject for processing
6. WHEN a Reviewer approves the machine result, THE System SHALL use the machine's original decision as the final decision and set override_flag to false
7. WHEN a Reviewer overrides the machine assessment, THE System SHALL store the override_flag as true, override_reason_code, and reviewer_notes, while preserving the original machine assessment snapshot unchanged
8. THE original machine assessment snapshot SHALL remain immutable and retrievable after any reviewer action - it SHALL NOT be modified or deleted
9. THE System SHALL record: queue_time, review_start_time, review_completion_time, reviewer_id, trigger_reasons, machine_assessment_snapshot (immutable), final_reviewed_outcome, override_flag, override_reason_code, reviewer_notes, and manual_trigger_reason (if insurer-initiated)
10. WHEN a manual review decision is recorded, THE System SHALL emit a decision.overridden event (if overridden) or decision.generated event (if approved)
11. THE System SHALL provide audit trail showing both the original machine assessment and the final reviewer decision for every manually reviewed claim

---

### Requirement 10: Dual Status Model

**User Story:** As the System, I want to maintain both an external and an internal status for every claim, so that insurer-facing communications are clear while internal operations have full detail.

#### Acceptance Criteria

1. THE System SHALL maintain an internal status for every claim using the following states: intake_received, intake_validated, intake_failed, journey_created, notification_sent, notification_opened, awaiting_consent, awaiting_photos, validating_photos, photos_validated, photos_insufficient, vin_enrichment_pending, vin_enrichment_complete, damage_analysis_pending, damage_analysis_complete, decision_pending, manual_review_required, decision_complete, result_delivered, failed_validation, failed_processing, abandoned
2. THE System SHALL derive the external status from the internal status; external status SHALL NOT be stored independently
3. THE external status SHALL use the following values: Message Sent, Message Opened, Photos In Progress, Photos Submitted, Under Review, Result Ready, Needs Action, Abandoned
4. WHEN the internal status transitions, THE System SHALL update the derived external status accordingly
5. THE System SHALL never store only the external status without the corresponding internal status

---

### Requirement 11: Event Model and Audit Trail

**User Story:** As an Insurer and as a Reviewer, I want a complete, immutable audit trail of every material claim event, so that I can investigate issues and demonstrate compliance.

#### Acceptance Criteria

1. THE System SHALL emit the following events at the appropriate lifecycle points: claim.intake_received, claim.intake_validated, claim.intake_failed, journey.created, notification.sent, notification.delivered, notification.opened, consent.captured, photo.uploaded, photo.validated, photo.rejected, photo.set_completed, photo.set_insufficient, vin.enrichment_started, vin.enrichment_completed, vin.enrichment_failed, damage.analysis_started, damage.analysis_completed, damage.analysis_failed, decision.manual_review_triggered, decision.generated, decision.overridden, result.delivered, claim.abandoned
2. EVERY event SHALL include the following envelope fields: event_id, event_type, claim_id, timestamp, source_service, actor_type, actor_id, correlation_id, idempotency_key, payload
3. Events SHALL be stored in an immutable event log (claim_events table) and SHALL NOT be updated or deleted
4. THE System SHALL be able to reconstruct the full claim lifecycle from the event log
5. WHEN any material lifecycle transition occurs, THE System SHALL emit the corresponding event before the transition is considered complete

---

### Requirement 12: Insurer JSON Output

**User Story:** As an Insurer, I want to receive a structured, schema-validated JSON result for every decided claim, so that I can integrate it into my claims processing system.

#### Acceptance Criteria

1. WHEN a claim reaches decision_complete or result_delivered internal status, THE System SHALL produce a JSON output conforming to the insurer output contract
2. THE JSON output SHALL include all of the following fields: schema_version, claim_id, claim_number, external_status, internal_status, assessment_outcome, decision_eligibility, blocking_reasons, final_decision, final_decision_source, justification, confidence_summary, prerequisite_checks, vin_data, damage_summary, manual_review_flag, manual_review_reason_codes, generated_at, rules_version
3. THE System SHALL validate the JSON output against the schema before delivery
4. THE JSON output SHALL clearly indicate whether the final decision was automated, manually reviewed, or hybrid
5. THE JSON output SHALL clearly expose any blocked outcomes and their reasons
6. WHEN the JSON output is delivered, THE System SHALL emit a result.delivered event

---

### Requirement 13: Persistence and Database Design

**User Story:** As the System, I want to persist all claim data in a structured relational schema with JSONB for flexible payloads, so that data is durable, queryable, and supports future migration.

#### Acceptance Criteria

1. THE System SHALL use PostgreSQL 17 database glass_claims_db with user glass_user
2. THE System SHALL persist claims in a claim_inspections table with the following columns: id, customer_id, claim_number, insurer_id, external_status, internal_status, policyholder_name, policyholder_mobile, policyholder_email, insurer_provided_vin, intake_message_id, received_at, consent_captured, decision_eligibility, assessment_outcome, final_decision, rules_version, output_schema_version, created_at, updated_at, inspection_data (JSONB)
3. THE inspection_data JSONB field SHALL store: raw intake payload, validation details, VIN enrichment payload, damage analysis payload, decision prerequisite checks, and manual review metadata snapshot
4. THE System SHALL persist events in an immutable claim_events table
5. THE System SHALL persist journey records in a journeys table
6. THE System SHALL persist photo records in an uploaded_photos table
7. THE System SHALL persist manual review records in a manual_reviews table
8. THE System SHALL persist notification delivery records in a notification_deliveries table
9. WHEN a claim is updated, THE System SHALL update the updated_at timestamp atomically with the data change

---

### Requirement 14: Security Controls

**User Story:** As an Insurer and as the System operator, I want robust security controls, so that claimant data and system integrity are protected.

#### Acceptance Criteria

1. THE System SHALL use TLS for all network traffic
2. THE System SHALL store photos in private object storage with no public URLs; all photo access SHALL use signed, expiring URLs
3. WHEN a file is uploaded, THE System SHALL validate MIME type, file extension, maximum upload size, and reject corrupt or unreadable files
4. THE System SHALL authenticate all insurer-facing access
5. THE System SHALL enforce RBAC for reviewer and admin roles
6. THE System SHALL use least-privilege service credentials and SHALL NOT store secrets in source code
7. THE System SHALL produce audit logs for all reads and writes to sensitive data
8. THE System SHALL ensure all log output is PII-safe (no raw PII in log lines)
9. THE System SHALL encrypt data in transit and at rest
10. THE System SHALL enforce a retention policy for photos and claim data
11. THE System SHALL apply rate limiting to all journey endpoints

---

### Requirement 15: SLA and Operating Targets

**User Story:** As an Insurer, I want the system to meet defined processing time targets, so that claimants receive timely responses during the pilot.

#### Acceptance Criteria

1. THE System SHALL poll the mailbox every 15 minutes
2. THE System SHALL create a claim record within 1 minute of successful email parse
3. THE System SHALL dispatch the claimant notification within 1 minute of claim creation
4. THE System SHALL complete photo validation within 30 seconds of upload
5. THE System SHALL complete VIN enrichment within 30 seconds of trigger
6. THE System SHALL complete damage analysis within 60 seconds of trigger
7. THE System SHALL complete rules engine decision within 10 seconds of trigger
8. THE System SHALL complete automated turnaround within 5 minutes of the last valid photo being accepted
9. THE System SHALL target manual review turnaround within 30 minutes during supported hours
10. THE System SHALL expire journeys after 24 hours by default
11. THE System SHALL mark claims as abandoned after 24–48 hours of inactivity (configurable)

---

### Requirement 17: Insurer Dashboard and Portal

**User Story:** As an Insurer, I want a comprehensive web dashboard to view all my submitted claims, track their progress, initiate manual reviews, and manage my account, so that I have full visibility and control over my claims processing.

#### Acceptance Criteria

1. THE System SHALL provide a web-based insurer dashboard accessible via secure authentication
2. THE dashboard SHALL display all claims submitted by the insurer with current status, submission date, and progress indicators
3. THE dashboard SHALL allow filtering and searching claims by claim number, status, date range, and policyholder details
4. THE dashboard SHALL display detailed claim information including photos, damage analysis, VIN data, and machine assessment results
5. THE dashboard SHALL provide a "Send to Manual Review" button for any completed automated assessment, regardless of confidence level
6. WHEN an insurer initiates manual review, THE System SHALL require selection of a reason (Quality Check, High Value, Suspicious Activity, Training, Customer Request, Other)
7. THE dashboard SHALL display a manual review queue showing all claims pending review with trigger reasons and priority levels
8. THE dashboard SHALL allow reviewers to approve machine results, override decisions, request retakes, or mark claims as insufficient evidence
9. THE dashboard SHALL provide downloadable reports and analytics including processing times, override rates, and decision accuracy
10. THE dashboard SHALL allow bulk operations for sending multiple claims to manual review
11. THE dashboard SHALL provide real-time status updates and notifications for claim progress
12. THE dashboard SHALL maintain session security with automatic logout and audit logging of all user actions

---

### Requirement 18: Internal Admin Interface

**User Story:** As a System Administrator, I want a comprehensive admin interface to manage multiple insurance customers, monitor system performance, oversee manual reviews, and configure system settings, so that I can efficiently operate and scale the platform.

#### Acceptance Criteria

1. THE System SHALL provide a web-based admin interface accessible via secure authentication with role-based access control
2. THE admin interface SHALL display a multi-customer dashboard showing all insurers, their claim volumes, processing statistics, and system health metrics
3. THE admin interface SHALL allow customer management including onboarding new insurers, configuring their settings, and managing their access
4. THE admin interface SHALL provide system monitoring including database performance, API response times, error rates, and processing queue status
5. THE admin interface SHALL display a global manual review oversight view showing all pending reviews across all customers (read-only)
6. THE admin interface SHALL provide analytics and reporting across all customers including processing volumes, accuracy metrics, and system utilization
7. THE admin interface SHALL allow system configuration including operating modes, confidence thresholds, retry limits, and notification settings
8. THE admin interface SHALL provide audit trail access for compliance and troubleshooting across all customers and system operations
9. THE admin interface SHALL allow manual intervention for stuck claims, system maintenance, and emergency overrides
10. THE admin interface SHALL provide customer support tools including claim lookup, status tracking, and issue resolution
11. THE admin interface SHALL maintain comprehensive audit logging of all admin actions and system changes
12. THE admin interface SHALL support multi-tenant data isolation ensuring customers cannot access each other's data

---

### Requirement 19: Operating Modes

**User Story:** As a System operator, I want to configure the level of automation, so that I can control risk during the pilot.

#### Acceptance Criteria

1. THE System SHALL support the following operating modes: advisory_only, manual_review_required, automation_allowed_for_eligible_claims
2. WHEN operating in advisory_only mode, THE System SHALL generate assessments but SHALL NOT deliver automated final decisions
3. WHEN operating in manual_review_required mode, THE System SHALL route all claims to manual review regardless of eligibility
4. WHEN operating in automation_allowed_for_eligible_claims mode, THE System SHALL deliver automated final decisions only for claims that meet all decision eligibility prerequisites
5. THE operating mode SHALL be configurable without a code deployment
