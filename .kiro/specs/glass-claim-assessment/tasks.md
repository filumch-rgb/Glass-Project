# Implementation Plan: Glass Claim Assessment System

## Overview

This implementation plan builds the Glass Claim Assessment System incrementally with improved sequencing: core infrastructure first, then email intake with immediate integration testing, journey services with incremental security, photo system with validation, processing services, decision engine with manual review UI, and comprehensive property-based testing. Security controls are implemented incrementally with each component rather than as a separate late-stage task.

## Tasks

- [x] 1. Set up project infrastructure and database with core security
  - Create TypeScript Node.js project structure with proper configuration
  - Set up PostgreSQL database connection and schema
  - Configure environment variables and secrets management
  - Set up logging framework with PII-safe output
  - Configure object storage for photo uploads with signed URLs
  - Implement TLS enforcement for all network traffic
  - _Requirements: 13.1, 13.2, 14.1, 14.6, 14.8, 14.9_

- [x] 2. Implement core data models and persistence layer
  - [x] 2.1 Create database schema and migration scripts
    - Implement claim_inspections table with JSONB inspection_data field
    - Create claim_events table for immutable event logging
    - Create journeys, uploaded_photos, manual_reviews, notification_deliveries tables
    - Add all required indexes for performance
    - _Requirements: 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8_

  - [x] 2.2 Implement event model and audit trail
    - Create EventEnvelope interface and event emission system
    - Implement immutable event storage in claim_events table
    - Add event correlation and idempotency handling
    - Add audit logging for sensitive data access
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 14.7_

- [x] 3. Implement email intake system with integration testing
  - [x] 3.1 Create IMAP mailbox poller with cron scheduling
    - Implement 15-minute polling schedule using node-cron
    - Add IMAP connection handling with imapflow
    - Create email parsing for "New Glass Claim" subject
    - Implement folder management (Completed/Failed)
    - _Requirements: 1.1, 1.6, 1.8_

  - [x] 3.2 Implement claim intake parser and validation
    - Parse key:value email body format for required fields
    - Validate insurer name, insurer ID, claim number, policyholder details
    - Generate UUID claim identifiers and intake keys
    - Store initial claim record with intake_received status
    - _Requirements: 1.2, 1.3, 1.4, 1.9_

  - [x] 3.3 Implement dual status model
    - Create internal status enumeration and transitions
    - Implement external status derivation logic
    - Ensure external status is never stored independently
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 3.4 Integration test - Email intake to database
    - Test complete email processing flow
    - Test idempotency and error handling
    - Test status transitions and event emission
    - _Requirements: 1.5, 1.7, 11.5_

- [x] 4. Implement notification and journey services with security
  - [x] 4.1 Create notification service with Twilio/WhatsApp integration
    - Implement SMS notification via Twilio
    - Add WhatsApp Business API integration
    - Create notification delivery tracking
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 4.2 Implement journey token management with security
    - Create signed JWT journey tokens with claim scoping
    - Add token expiration (24 hours default) and revocation
    - Implement rate limiting for journey endpoints
    - Handle journey abandonment after timeout
    - Add RBAC for journey access
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 14.4, 14.5, 14.11_

  - [x] 4.3 Integration test - Notification to journey creation
    - Test notification dispatch and journey token generation
    - Test token security and rate limiting
    - Test journey expiration and abandonment
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [ ] 5. Implement consent capture system
  - [ ] 5.1 Create legal notice presentation and consent recording
    - Implement legal notice with required content fields
    - Add consent capture for PWA and WhatsApp channels
    - Store consent metadata with timestamps and versions
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ] 5.2 Integration test - Consent gate enforcement
    - Test consent blocking of photo uploads
    - Test consent capture flow
    - _Requirements: 2.6, 2.7_

- [ ] 6. Implement photo upload and validation system with security
  - [ ] 6.1 Create photo upload service with slot management
    - Implement 5 fixed photo slots + up to 3 damage photo slots
    - Add photo upload with journey token authentication
    - Enforce consent gate before allowing uploads
    - Create photo storage with private object storage and signed URLs
    - Add file validation and security checks
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 14.2, 14.3_

  - [ ] 6.2 Implement photo validation with camera-only enforcement
    - Add MIME type, file size, and resolution validation
    - Implement sharpness, brightness, and framing checks
    - Add EXIF timestamp validation for recent capture (10 minutes)
    - Enforce camera-only capture with capture="environment"
    - Assign validation outcomes (accepted/rejected_retake_required)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11_

  - [ ] 6.3 Integration test - Photo upload to validation
    - Test complete photo upload and validation flow
    - Test photo set completion rules
    - Test evidence sufficiency derivation
    - Test camera-only enforcement
    - _Requirements: 3.6, 4.7_

- [ ] 7. Implement VIN enrichment service
  - [ ] 7.1 Create VIN decode and OCR extraction with retry logic
    - Implement external VIN Decoder API integration with retry logic
    - Add OCR VIN extraction from VIN cutout photos
    - Implement VIN mismatch detection between sources
    - Add ADAS lookup functionality
    - Add exponential backoff for external API calls
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.8_

  - [ ] 7.2 Integration test - VIN enrichment
    - Test VIN result state derivation
    - Test retry logic and error handling
    - Test mismatch detection scenarios
    - _Requirements: 6.3, 6.6_

- [ ] 8. Implement damage analysis service
  - [ ] 8.1 Create structured damage analysis
    - Implement damage analysis for accepted damage photos
    - Return structured damage findings with confidence scores
    - Add evidence sufficiency assessment
    - Include uncertainty and insufficiency indicators
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [ ] 8.2 Integration test - Damage analysis
    - Test structured output format and confidence scoring
    - Test evidence sufficiency assessment logic
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [ ] 9. Implement decision rules engine
  - [ ] 9.1 Create deterministic decision engine
    - Implement prerequisite checks for all decision criteria
    - Add deterministic repair/replace/manual_review logic
    - Ensure blocked prerequisites prevent repair/replace outcomes
    - Include structured justification and confidence summary
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [ ] 9.2 Integration test - Decision engine
    - Test prerequisite blocking of repair/replace decisions
    - Test decision engine determinism
    - Test prerequisite check evaluation
    - _Requirements: 4.8, 8.1, 8.3, 8.4_

- [ ] 10. Implement manual review workflow and basic UI
  - [ ] 10.1 Create manual review queue and reviewer actions
    - Implement manual review triggers (both automatic and insurer-initiated)
    - Create immutable machine assessment snapshots
    - Add reviewer action handling (approve/override/request_retake)
    - Preserve original assessments after reviewer decisions
    - Add support for insurer-initiated manual review with reason tracking
    - Implement priority levels and trigger source tracking
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11_

  - [ ] 10.2 Create basic manual review interface
    - Implement simple web interface for manual review queue
    - Add reviewer action buttons and forms
    - Display machine assessment snapshots
    - Add basic authentication for reviewers
    - _Requirements: 9.4, 9.5, 14.4, 14.5_

  - [ ] 10.3 Integration test - Manual review workflow
    - Test manual review assessment preservation
    - Test reviewer action processing and override tracking
    - Test insurer-initiated manual review trigger functionality
    - Test trigger source tracking and reason code handling
    - _Requirements: 9.3, 9.4, 9.5, 9.6, 9.7, 9.9_

- [ ] 11. Implement insurer JSON output and delivery
  - [ ] 11.1 Create result formatter and JSON output contract
    - Implement complete insurer JSON output with all required fields
    - Add schema validation for output contract
    - Include decision source tracking (automated/manually_reviewed/hybrid)
    - Add blocking reasons and prerequisite check results
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [ ] 11.2 Integration test - JSON output
    - Test output contract completeness and decision source
    - Test schema validation and required field presence
    - Test decision source derivation logic
    - _Requirements: 12.2, 12.4_

- [ ] 12. End-to-end integration testing
  - [ ] 12.1 Complete claim lifecycle integration test
    - Test end-to-end flow from email intake to JSON output
    - Test manual review workflow integration
    - Test error scenarios and recovery paths
    - Test all security controls and audit logging
    - _Requirements: Complete system integration_

- [ ] 13. Implement comprehensive insurer dashboard
  - [ ] 13.1 Create insurer dashboard frontend with authentication
    - Implement React/TypeScript dashboard with claims overview
    - Add manual review trigger functionality for any completed assessment
    - Create integrated manual review queue and reviewer actions interface
    - Add real-time status updates and filtering capabilities
    - Implement JWT-based authentication and RBAC
    - Add session management with automatic logout
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.12, 14.4, 14.5_

  - [ ] 13.2 Add analytics and reporting features
    - Implement downloadable reports and analytics
    - Add bulk operations for multiple claims
    - Add real-time notifications for claim progress
    - _Requirements: 17.9, 17.10, 17.11_

  - [ ] 13.3 Create RESTful APIs for insurer dashboard
    - Implement claims listing and filtering endpoints
    - Add manual review trigger API endpoints
    - Create reviewer action processing endpoints
    - Add real-time status update WebSocket connections
    - Implement analytics and reporting endpoints
    - Add API authentication and authorization
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 14.4, 14.5_

- [ ] 14. Implement internal admin interface
  - [ ] 14.1 Create internal admin interface with multi-tenant security
    - Implement multi-customer dashboard with health monitoring
    - Add customer onboarding and configuration management
    - Create global manual review oversight (read-only view)
    - Implement system performance monitoring and alerting
    - Add multi-tenant data isolation and RBAC
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.12, 14.5_

  - [ ] 14.2 Add admin analytics and management tools
    - Add analytics and reporting across all customers
    - Create audit trail access and compliance tools
    - Add manual intervention tools for stuck claims
    - Implement customer support tools
    - _Requirements: 18.6, 18.7, 18.8, 18.9, 18.10, 18.11_

  - [ ] 14.3 Create admin API endpoints
    - Implement multi-customer management endpoints
    - Add system monitoring and health check APIs
    - Create customer onboarding and configuration endpoints
    - Add global analytics and reporting endpoints
    - Implement audit trail access endpoints
    - Add comprehensive API security and audit logging
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9, 18.10, 14.7_

- [ ] 15. Comprehensive testing and validation
  - [ ] 15.1 Property-based testing suite
    - **Property 1: Claim ID Uniqueness** - _Requirements: 1.4_
    - **Property 2: Intake Idempotency** - _Requirements: 1.5, 1.7_
    - **Property 3: Consent Gate Blocks Photo Upload** - _Requirements: 2.6, 2.7_
    - **Property 4: Photo Set Completion Rule** - _Requirements: 3.6_
    - **Property 5: Evidence Sufficiency Derivation** - _Requirements: 4.7_
    - **Property 6: Prerequisites Block Repair/Replace** - _Requirements: 4.8, 8.3, 8.4_
    - **Property 7: Decision Engine Determinism** - _Requirements: 8.1_
    - **Property 8: VIN Result State Derivation** - _Requirements: 6.3, 6.6_
    - **Property 9: Manual Review Preserves Machine Assessment** - _Requirements: 9.6_
    - **Property 10: Output Contract Completeness and Decision Source** - _Requirements: 12.2, 12.4_
    - **Property 11: State Transition Emits Event** - _Requirements: 11.5_

  - [ ] 15.2 Security and performance testing
    - Test signed URL generation and expiration
    - Test RBAC enforcement across all interfaces
    - Test multi-customer data isolation
    - Test rate limiting and DDoS protection
    - Test data encryption in transit and at rest
    - Performance test all API endpoints
    - _Requirements: 14.1, 14.2, 14.3, 14.5, 14.7, 14.9, 14.11, 18.12_

  - [ ] 15.3 UI and API integration testing
    - Test manual review trigger API workflows
    - Test authentication and authorization on all endpoints
    - Test real-time status updates and WebSocket connections
    - Test claims filtering and search capabilities
    - Test bulk operations and analytics
    - _Requirements: 17.5, 17.6, 17.10, 18.12_

- [ ] 16. Final system validation and deployment preparation
  - [ ] 16.1 Complete system validation
    - Run all property-based tests with 100+ iterations
    - Validate all security controls and audit logging
    - Test error handling and recovery scenarios
    - Validate SLA targets and performance requirements
    - _Requirements: 15.1-15.11_

  - [ ] 16.2 Deployment readiness
    - Configure production environment variables
    - Set up monitoring and alerting
    - Prepare deployment scripts and documentation
    - Validate backup and recovery procedures
    - _Requirements: System operational readiness_

## Notes

- Each task includes integration testing to catch issues early
- Security controls are implemented incrementally with each component
- Manual review UI is built alongside the backend workflow (Task 10)
- Property-based tests are consolidated into a dedicated validation phase (Task 15)
- UI components are built after core system is stable but before final validation
- The system uses TypeScript/Node.js with PostgreSQL database and React frontend
- All photo storage uses private object storage with signed URLs
- The implementation follows the four-layer architecture with UI components from the design document
- Insurer dashboard includes integrated manual review interface with trigger capabilities
- Internal admin interface provides multi-customer management and system oversight