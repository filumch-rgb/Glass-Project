# Services

This directory contains the core business logic services for the Glass Claim Assessment System.

## Email Intake Service

The Email Intake Service polls an IMAP inbox for new glass claim emails, parses them, validates the data, creates claim records, and moves emails to appropriate folders.

### Features

- **IMAP Polling**: Polls inbox every 15 minutes (configurable via `IMAP_POLL_INTERVAL_MINUTES`)
- **Email Parsing**: Parses key:value format email bodies
- **Validation**: Validates all required fields before creating claims
- **Idempotency**: Prevents duplicate claims using sha256(messageId + claimNumber)
- **Folder Management**: Moves processed emails to Completed or Failed folders
- **Event Emission**: Emits `claim.intake_received` or `claim.intake_failed` events
- **Status Management**: Uses dual status model (internal + derived external status)

### Email Format

Emails are processed from the dedicated inbox (any subject line accepted). Body must be in key:value format:

```
Insurer Name: ABC Insurance
Claim Number: CLM-2024-001234
Policyholder Name: John Doe
Policyholder Mobile: +1234567890
Policyholder Email: john@example.com
VIN: 1HGBH41JXMN109186
```

**Required Fields (all mandatory):**
- Insurer Name
- Claim Number
- Policyholder Name
- Policyholder Mobile
- Policyholder Email
- VIN (or "Insurer Provided VIN")

### Usage

```typescript
import { emailIntakeService } from './services/emailIntakeService';

// Start the poller (runs every 15 minutes)
emailIntakeService.start();

// Manually trigger a poll (for testing)
await emailIntakeService.triggerPoll();

// Stop the poller
emailIntakeService.stop();
```

### Configuration

Set these environment variables in `.env`:

```
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=your-email@gmail.com
IMAP_PASSWORD=your-app-password
IMAP_MAILBOX=INBOX
IMAP_COMPLETED_FOLDER=Completed
IMAP_FAILED_FOLDER=Failed
IMAP_POLL_INTERVAL_MINUTES=15
```

### Database Schema

Claims are stored in the `claim_inspections` table with:
- UUID claim identifier
- Internal status (`intake_received`)
- Derived external status (`Message Sent`)
- Policyholder details
- JSONB `inspection_data` field containing raw intake payload

### Events

The service emits these events to the `claim_events` table:
- `claim.intake_received` - Successful claim creation
- `claim.intake_failed` - Validation or processing failure

### Testing

Run integration tests:

```bash
npm test -- emailIntakeService.test.ts
```

Tests cover:
- Email body parsing (valid, missing fields, case-insensitive)
- Field validation
- Intake key generation and idempotency
- Claim creation and database storage
- Status derivation
- Event emission

## Status Service

The Status Service implements the dual status model where external status is ALWAYS derived from internal status and NEVER stored independently.

### Features

- **Status Mapping**: Maps internal status to user-friendly external status
- **Consistency**: Ensures external status is always derived, never stored
- **Validation**: Validates internal status values

### Usage

```typescript
import { StatusService } from './services/statusService';

// Derive external status from internal status
const externalStatus = StatusService.deriveExternalStatus('intake_received');
// Returns: 'Message Sent'

// Get all internal statuses that map to an external status
const internalStatuses = StatusService.getInternalStatusesForExternal('Message Sent');
// Returns: ['intake_received', 'intake_validated', 'journey_created', 'notification_sent']

// Validate internal status
const isValid = StatusService.isValidInternalStatus('intake_received');
// Returns: true
```

### Status Mapping

| Internal Status | External Status |
|----------------|-----------------|
| intake_received | Message Sent |
| intake_validated | Message Sent |
| intake_failed | Needs Action |
| journey_created | Message Sent |
| notification_sent | Message Sent |
| notification_opened | Message Opened |
| awaiting_consent | Message Opened |
| awaiting_photos | Photos In Progress |
| validating_photos | Photos In Progress |
| photos_validated | Photos Submitted |
| photos_insufficient | Needs Action |
| vin_enrichment_pending | Under Review |
| vin_enrichment_complete | Under Review |
| damage_analysis_pending | Under Review |
| damage_analysis_complete | Under Review |
| decision_pending | Under Review |
| manual_review_required | Under Review |
| decision_complete | Result Ready |
| result_delivered | Result Ready |
| failed_validation | Needs Action |
| failed_processing | Needs Action |
| abandoned | Abandoned |

## Event Service

The Event Service provides immutable event logging and audit trail functionality for all claim lifecycle transitions.

### Features

- **Immutable Events**: Events are never modified once stored
- **Idempotency**: Duplicate events are silently ignored
- **Event Correlation**: Track related events across services
- **Audit Trail**: PII-safe logging for sensitive data access

### Usage

See `eventService.ts` for detailed documentation.

## Next Steps

- Implement Notification Service (Task 4.1)
- Implement Journey Service (Task 4.2)
- Implement Consent Capture (Task 5)
- Implement Photo Upload and Validation (Task 6)
