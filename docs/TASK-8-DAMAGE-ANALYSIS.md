# Task 8: Damage Analysis Service

## Overview

Task 8 implements the damage analysis service using Google Gemini 1.5 Pro Vision (multimodal LLM) to analyze windscreen damage photos and determine repair eligibility based on ROLAGS/NAGS guidelines.

## Implementation Summary

### Task 8.1: Create Damage Analysis Service ✅

**File Created:** `src/services/damageAnalysisService.ts`

**Key Features:**
1. **Gemini 1.5 Pro Vision Integration**
   - Uses Google Vertex AI Gemini API for multimodal image analysis
   - Same service account as OCR: `vertexairunner@fils-glass-project.iam.gserviceaccount.com`
   - Same API key as OCR: `GOOGLE_CLOUD_VISION_API_KEY`
   - Model: `gemini-1.5-pro` (configurable via `.env`)

2. **ROLAGS/NAGS Guidelines Embedded in LLM Prompt**
   - Complete ROLAGS/NAGS repair criteria embedded in system prompt
   - Repairable damage types: Bullseye (≤1"), Star Break (≤3"), Combination Break (≤2"), Half-Moon (≤1"), Crack (≤14"), Surface Pit (≥1/8")
   - Repair limitations: Penetration, multiple cracks, inside layer damage, contamination, etc.
   - DPVA (Driver's Primary Viewing Area) restrictions: 12" wide, centered on driver
   - LLM estimates damage dimensions using visual context (steering wheel, windscreen frame, etc.)

3. **Structured JSON Output**
   - Returns `DamageAnalysisResult` interface matching design spec
   - Damage points with affected regions, severity attributes, glass observations
   - Overall confidence score (0-1)
   - Uncertainty indicators and insufficiency flags
   - Evidence sufficiency assessment (sufficient/sufficient_with_warnings/insufficient)

4. **Photo Processing**
   - Accepts 1-3 damage photos (required)
   - Accepts inside vehicle photos (driver + passenger) for scale context (optional)
   - Converts photos to base64 for Gemini API
   - Sends all photos in single API call for comprehensive context

5. **Retry Logic**
   - Implements exponential backoff retry (max 3 retries: 1s, 2s, 4s)
   - Uses same retry pattern as OCR service via `withRetry` utility

6. **Event Emission**
   - Emits `damage.analysis_started` event when analysis begins
   - Emits `damage.analysis_completed` event on success
   - Emits `damage.analysis_failed` event on failure

7. **Configuration**
   - Added to `src/config/index.ts`:
     - `damageAnalysis.confidenceThreshold` (default: 0.7)
     - `damageAnalysis.model` (default: 'gemini-1.5-pro')
     - `damageAnalysis.maxRetries` (default: 3)
   - Updated `.env` and `.env.example` with new config variables

### Task 8.2: Integration Testing ✅

**File Created:** `src/services/damageAnalysisService.test.ts`

**Test Coverage:**
- ✅ 16 tests, all passing
- ✅ Unit tests for structured output parsing
- ✅ Unit tests for confidence scoring logic
- ✅ Unit tests for ROLAGS criteria application
- ✅ Unit tests for error handling
- ✅ Unit tests for event emission
- ✅ Unit tests for photo context handling
- ✅ Mock tests for all code paths

**Test Categories:**

1. **Structured Output Parsing (3 tests)**
   - Valid Gemini JSON response parsing
   - Multiple damage points handling
   - Insufficient evidence handling

2. **Confidence Scoring (1 test)**
   - Warning when confidence below threshold

3. **ROLAGS Criteria Application (3 tests)**
   - Repairable bullseye damage identification
   - Non-repairable damage in DPVA identification
   - Damage with penetration blocking repair

4. **Error Handling (5 tests)**
   - No damage photos provided
   - Gemini API error response
   - Invalid JSON response
   - Missing required fields in response
   - Retry logic on network failure

5. **Event Emission (3 tests)**
   - Analysis started event
   - Analysis completed event on success
   - Analysis failed event on error

6. **Photo Context (1 test)**
   - Inside vehicle photos for scale context

## Configuration

### Environment Variables

Added to `.env` and `.env.example`:

```bash
# Damage Analysis Configuration
DAMAGE_ANALYSIS_CONFIDENCE_THRESHOLD=0.7
DAMAGE_ANALYSIS_MODEL=gemini-1.5-pro
DAMAGE_ANALYSIS_MAX_RETRIES=3
```

### Config Interface

Added to `src/config/index.ts`:

```typescript
damageAnalysis: {
  confidenceThreshold: number;
  model: string;
  maxRetries: number;
}
```

## API Usage

### Basic Usage

```typescript
import { damageAnalysisService } from './services/damageAnalysisService';

const result = await damageAnalysisService.analyze({
  claimId: 'claim-123',
  damagePhotos: [damagePhoto1Buffer, damagePhoto2Buffer],
  insideDriverPhoto: driverPhotoBuffer,
  insidePassengerPhoto: passengerPhotoBuffer,
});

console.log(result.damagePoints);
console.log(result.overallConfidence);
console.log(result.evidenceSufficiencyAssessment);
```

### Response Structure

```typescript
interface DamageAnalysisResult {
  claimId: string;
  damagePoints: Array<{
    affectedRegion: string;
    severityAttributes: Record<string, unknown>;
    glassObservations: string[];
  }>;
  overallConfidence: number; // 0–1
  uncertaintyIndicators: string[];
  insufficiencyFlags: string[];
  evidenceSufficiencyAssessment: EvidenceSufficiency;
  analysedAt: Date;
}
```

## ROLAGS/NAGS Guidelines

### Repairable Damage Types

| Damage Type | Maximum Size | Notes |
|-------------|--------------|-------|
| Bullseye | ≤ 1 inch (25mm) diameter | Circular damage |
| Star Break | ≤ 3 inches (75mm) diameter | Radial cracks from central point |
| Combination Break | ≤ 2 inches (50mm) diameter | Body only, excluding legs |
| Half-Moon | ≤ 1 inch (25mm) diameter | Partial circular damage |
| Crack | ≤ 14 inches (350mm) long | Linear crack |
| Surface Pit | ≥ 1/8 inch (3mm) diameter | Shallow impact |

### Repair Limitations (DO NOT REPAIR)

- Damage penetrating both glass layers
- 3 or more long cracks from single impact point
- Damage on inside glass layer (not outer surface)
- Contaminated damage (dirt, debris embedded)
- Plastic interlayer damage visible
- Pit size > 3/8 inch (9mm) diameter
- Edge cracks intersecting more than 1 edge
- Stress cracks (not from impact)

### DPVA (Driver's Primary Viewing Area) Restrictions

- **Definition:** 12 inches (300mm) wide, centered on driver, extending from top to bottom of wiper sweep
- **Rules:**
  - Damage > 1 inch in DPVA → DO NOT REPAIR
  - Finished pit > 3/16 inch in DPVA → DO NOT REPAIR
  - Repair within 4 inches of another repair in DPVA → DO NOT REPAIR

## Damage Size Estimation

The LLM uses visual context clues to estimate damage dimensions:

- **Steering wheel diameter:** ~14-15 inches (350-380mm)
- **Windscreen frame width:** ~50-60 inches (1270-1520mm)
- **Typical windscreen height:** ~30-35 inches (760-890mm)
- **Human hand width:** ~3-4 inches (75-100mm)
- **Credit card:** 3.37 x 2.125 inches (85.6 x 54mm)

Multiple photos provide scale triangulation for more accurate estimates.

## Confidence Scoring

The LLM provides confidence scores based on:

- **0.9-1.0:** Clear damage, good photo quality, confident size estimate
- **0.7-0.89:** Visible damage, acceptable quality, reasonable size estimate
- **0.5-0.69:** Damage visible but quality/scale issues affect confidence
- **0.0-0.49:** Poor quality, unclear damage, unreliable assessment

**Threshold:** Configurable via `DAMAGE_ANALYSIS_CONFIDENCE_THRESHOLD` (default: 0.7)

When confidence is below threshold, the service logs a warning and the claim should be routed to manual review.

## Evidence Sufficiency Assessment

- **sufficient:** Clear damage photos with scale context, confident assessment possible
- **sufficient_with_warnings:** Damage visible but some uncertainty (noted in uncertaintyIndicators)
- **insufficient:** Cannot make reliable assessment (specific issues noted in insufficiencyFlags)

## Event Emission

The service emits the following events:

1. **damage.analysis_started**
   - Emitted when analysis begins
   - Payload: `{ damagePhotoCount, hasScaleContext }`

2. **damage.analysis_completed**
   - Emitted on successful analysis
   - Payload: `{ damagePointCount, overallConfidence, evidenceSufficiency, hasUncertainty, hasInsufficiency }`

3. **damage.analysis_failed**
   - Emitted on analysis failure
   - Payload: `{ error }`

## Error Handling

The service handles the following error scenarios:

1. **No damage photos provided:** Throws error immediately
2. **API key not configured:** Throws error immediately
3. **Gemini API error:** Logs error, emits failure event, throws error
4. **Invalid JSON response:** Logs error, emits failure event, throws error
5. **Missing required fields:** Validates response structure, throws error if invalid
6. **Network failure:** Implements retry logic with exponential backoff (max 3 retries)

## Testing

Run tests:

```bash
npm test -- src/services/damageAnalysisService.test.ts
```

All 16 tests should pass:
- ✅ Structured output parsing
- ✅ Confidence scoring
- ✅ ROLAGS criteria application
- ✅ Error handling
- ✅ Event emission
- ✅ Photo context handling

## Requirements Satisfied

### Requirement 7: Damage Analysis

1. ✅ **7.1:** WHEN evidence sufficiency is sufficient or sufficient_with_warnings, THE System SHALL submit all accepted damage photos for damage analysis
2. ✅ **7.2:** THE damage analysis output SHALL include: damage points and affected regions, severity attributes, glass observations relevant to repair/replace logic, overall confidence score, and evidence sufficiency assessment
3. ✅ **7.3:** THE damage analysis output SHALL be structured (no free-form narrative as primary output)
4. ✅ **7.4:** THE damage analysis output SHALL include confidence and uncertainty indicators
5. ✅ **7.5:** THE damage analysis output SHALL include insufficiency flags when evidence is inadequate
6. ✅ **7.6:** WHEN damage analysis completes, THE System SHALL emit a damage.analysis_completed event
7. ✅ **7.7:** WHEN damage analysis fails, THE System SHALL emit a damage.analysis_failed event and route the claim to manual review

## Design Interface Compliance

The implementation matches the design spec interface exactly:

```typescript
interface DamageAnalysisResult {
  claimId: string;
  damagePoints: Array<{
    affectedRegion: string;
    severityAttributes: Record<string, unknown>;
    glassObservations: string[];
  }>;
  overallConfidence: number;       // 0–1
  uncertaintyIndicators: string[];
  insufficiencyFlags: string[];
  evidenceSufficiencyAssessment: EvidenceSufficiency;
  analysedAt: Date;
}
```

## Next Steps

Task 8 is complete. The damage analysis service is ready for integration with the claim processing workflow.

**Next Task:** Task 9 - Implement Decision Rules Engine

The decision rules engine will use the damage analysis results to determine repair/replace eligibility based on ROLAGS/NAGS criteria and other prerequisite checks.

---

### Task 8.3: Glass Type and Brand Analysis Service ✅

**File Created:** `src/services/glassTypeAnalysisService.ts`

**Key Features:**
1. **Gemini 1.5 Pro Vision Integration**
   - Uses Google Vertex AI Gemini API for multimodal image analysis
   - Same service account as OCR and damage analysis: `vertexairunner@fils-glass-project.iam.gserviceaccount.com`
   - Same API key: `GOOGLE_CLOUD_VISION_API_KEY`
   - Model: `gemini-1.5-pro` (configurable via `.env`)

2. **OEM vs Aftermarket Classification**
   - **OEM Glass:** Vehicle manufacturer logo/name visible (e.g., Toyota, Honda, BMW, Mercedes, Ford)
   - **Aftermarket Glass:** Only glass manufacturer branding visible (AGC, Pilkington, Saint-Gobain, Fuyao, Xinyi)
   - **Unknown:** Cannot determine due to poor photo quality or no visible branding
   - **Key Rule:** Glass manufacturers like AGC, Pilkington, Saint-Gobain, Fuyao, Xinyi manufacture BOTH OEM and Aftermarket glass. The presence of a vehicle manufacturer logo/name is what distinguishes OEM from Aftermarket.

3. **Glass Manufacturer Detection**
   - Identifies common glass manufacturers: AGC, Pilkington, Saint-Gobain, Fuyao, Xinyi, Guardian, Vitro, Shatterprufe, PPG, Safelite
   - Returns manufacturer name if detected

4. **Vehicle Manufacturer Logo Detection**
   - Identifies vehicle manufacturer logos/names from major brands
   - Includes: Toyota, Lexus, Honda, Acura, Ford, Lincoln, GM brands, VW Group, BMW, Mercedes-Benz, Nissan, Infiniti, Hyundai, Kia, Genesis, Mazda, Subaru, Volvo, Jaguar, Land Rover, Tesla, Stellantis brands
   - Returns vehicle manufacturer name if detected

5. **Structured JSON Output**
   - Returns `GlassTypeAnalysisResult` interface
   - Glass manufacturer (if detected)
   - Vehicle manufacturer logo (if detected)
   - Glass type classification (oem/aftermarket/unknown)
   - Confidence score (0-1)
   - Uncertainty indicators

6. **Photo Processing**
   - Accepts single logo/silkscreen photo (one of the 5 required fixed photos)
   - Converts photo to base64 for Gemini API
   - Analyzes branding and logos in single API call

7. **Retry Logic**
   - Implements exponential backoff retry (max 3 retries: 1s, 2s, 4s)
   - Uses same retry pattern as damage analysis via `withRetry` utility

8. **Event Emission**
   - Emits `damage.analysis_started` event when analysis begins (reusing damage analysis events)
   - Emits `damage.analysis_completed` event on success
   - Emits `damage.analysis_failed` event on failure
   - Payload includes `analysisType: 'glass_type'` to distinguish from damage analysis

9. **Configuration**
   - Uses existing `damageAnalysis.confidenceThreshold` (default: 0.7)
   - Uses existing `damageAnalysis.model` (default: 'gemini-1.5-pro')
   - Uses existing `damageAnalysis.maxRetries` (default: 3)
   - No new configuration needed

### Task 8.3: Integration Testing ✅

**File Created:** `src/services/glassTypeAnalysisService.test.ts`

**Test Coverage:**
- ✅ 17 tests, all passing
- ✅ Unit tests for OEM glass detection
- ✅ Unit tests for Aftermarket glass detection
- ✅ Unit tests for Unknown classification
- ✅ Unit tests for multiple glass manufacturers
- ✅ Unit tests for error handling
- ✅ Unit tests for event emission
- ✅ Unit tests for retry logic
- ✅ Unit tests for confidence scoring

**Test Categories:**

1. **Basic Analysis (11 tests)**
   - OEM glass with vehicle logo detection
   - Aftermarket glass without vehicle logo
   - Unknown glass type with uncertainty indicators
   - Multiple glass manufacturers handling
   - Empty photo buffer error
   - Gemini API error handling
   - Invalid JSON response handling
   - Missing required fields handling
   - Invalid glassType value handling
   - Base64 photo encoding verification
   - Success event emission verification

2. **OEM vs Aftermarket Classification (2 tests)**
   - OEM classification with vehicle logo + glass manufacturer
   - Aftermarket classification with only glass manufacturer

3. **Error Handling and Retry Logic (2 tests)**
   - Retry on network errors and succeed
   - Fail after max retries

4. **Confidence Scoring (2 tests)**
   - Low confidence results handling
   - High confidence results handling

## Glass Type Analysis API Usage

### Basic Usage

```typescript
import { glassTypeAnalysisService } from './services/glassTypeAnalysisService';

const result = await glassTypeAnalysisService.analyze(
  'claim-123',
  logoSilkscreenPhotoBuffer
);

console.log(result.glassType); // 'oem' | 'aftermarket' | 'unknown'
console.log(result.glassManufacturer); // e.g., 'AGC', 'Pilkington'
console.log(result.vehicleManufacturerLogo); // e.g., 'Toyota', 'Honda'
console.log(result.confidence); // 0-1
```

### Response Structure

```typescript
interface GlassTypeAnalysisResult {
  claimId: string;
  glassManufacturer?: string; // e.g., "AGC", "Pilkington", "Saint-Gobain"
  vehicleManufacturerLogo?: string; // e.g., "Toyota", "Honda", "BMW"
  glassType: 'oem' | 'aftermarket' | 'unknown';
  confidence: number; // 0-1
  uncertaintyIndicators: string[];
  analysedAt: Date;
}
```

## OEM vs Aftermarket Classification Rules

### OEM Glass Indicators
- Vehicle manufacturer logo or name is visible
- Examples: Toyota logo, Honda logo, BMW logo, Mercedes-Benz logo, Ford logo
- May also have glass manufacturer branding (AGC, Pilkington, etc.)
- **Classification:** `glassType: 'oem'`

### Aftermarket Glass Indicators
- Only glass manufacturer branding visible
- No vehicle manufacturer logo or name present
- Examples: AGC only, Pilkington only, Saint-Gobain only, Fuyao only, Xinyi only
- **Classification:** `glassType: 'aftermarket'`

### Unknown Classification
- Poor photo quality prevents identification
- No visible branding of any kind
- Photo does not show logo/silkscreen area clearly
- **Classification:** `glassType: 'unknown'`

### Important Note
Glass manufacturers like AGC, Pilkington, Saint-Gobain, Fuyao, and Xinyi manufacture **BOTH** OEM and Aftermarket glass. The presence of a vehicle manufacturer logo/name is the **ONLY** indicator of OEM glass.

## Common Glass Manufacturers

The service can identify these glass manufacturers:
- AGC (Asahi Glass Company)
- Pilkington
- Saint-Gobain (Sekurit)
- Fuyao
- Xinyi
- Guardian
- Vitro
- Shatterprufe
- PPG
- Safelite

## Common Vehicle Manufacturers (OEM Indicators)

The service can identify these vehicle manufacturer logos/names:
- **Japanese:** Toyota, Lexus, Honda, Acura, Nissan, Infiniti, Mazda, Subaru
- **American:** Ford, Lincoln, GM (Chevrolet, GMC, Cadillac, Buick), Tesla
- **German:** Volkswagen, Audi, Porsche, BMW, Mini, Mercedes-Benz
- **Korean:** Hyundai, Kia, Genesis
- **European:** Volvo, Jaguar, Land Rover
- **Stellantis:** Jeep, Ram, Dodge, Chrysler, Fiat, Peugeot, Citroën

## Integration with Claim Processing

The glass type analysis service runs in parallel with damage analysis:

1. **Trigger:** When logo/silkscreen photo is accepted
2. **Execution:** Runs concurrently with damage analysis
3. **Output:** Glass type classification (OEM/Aftermarket/Unknown)
4. **Usage:** Informs decision engine, especially for ADAS vehicles

### ADAS Vehicle Requirement

Per Requirement 6.32, ADAS vehicles require OEM glass with recalibration. The glass type analysis service provides the OEM/Aftermarket classification needed for this decision:

- **ADAS + OEM Glass:** Proceed with replacement + recalibration
- **ADAS + Aftermarket Glass:** May require manual review or rejection
- **ADAS + Unknown Glass:** Route to manual review

## Confidence Scoring

The LLM provides confidence scores based on:

- **0.9-1.0:** Clear branding visible, confident classification
- **0.7-0.89:** Branding visible, reasonable classification
- **0.5-0.69:** Some branding visible but quality issues affect confidence
- **0.0-0.49:** Poor quality, unclear branding, unreliable classification

**Threshold:** Uses existing `DAMAGE_ANALYSIS_CONFIDENCE_THRESHOLD` (default: 0.7)

When confidence is below threshold, the service logs a warning and the claim should be routed to manual review.

## Uncertainty Indicators

The service may include these uncertainty indicators:

- `poor_photo_quality` - Photo quality is insufficient for reliable analysis
- `no_visible_branding` - No branding visible in the photo
- `unclear_logo` - Logo is present but unclear or partially obscured
- `lighting_issues` - Lighting conditions affect visibility
- `angle_obscures_branding` - Camera angle obscures branding
- `partial_branding_visible` - Only partial branding visible

## Event Emission

The service emits the following events (reusing damage analysis event types):

1. **damage.analysis_started**
   - Emitted when glass type analysis begins
   - Payload: `{ analysisType: 'glass_type' }`

2. **damage.analysis_completed**
   - Emitted on successful analysis
   - Payload: `{ analysisType: 'glass_type', glassType, glassManufacturer, vehicleManufacturerLogo, confidence, hasUncertainty }`

3. **damage.analysis_failed**
   - Emitted on analysis failure
   - Payload: `{ analysisType: 'glass_type', error }`

## Error Handling

The service handles the following error scenarios:

1. **No photo provided:** Throws error immediately
2. **Empty photo buffer:** Throws error immediately
3. **API key not configured:** Throws error immediately
4. **Gemini API error:** Logs error, emits failure event, throws error
5. **Invalid JSON response:** Logs error, emits failure event, throws error
6. **Missing required fields:** Validates response structure, throws error if invalid
7. **Invalid glassType value:** Validates glassType is one of: oem, aftermarket, unknown
8. **Network failure:** Implements retry logic with exponential backoff (max 3 retries)

## Testing

Run tests:

```bash
npm test src/services/glassTypeAnalysisService.test.ts
```

All 17 tests should pass:
- ✅ OEM glass detection
- ✅ Aftermarket glass detection
- ✅ Unknown classification
- ✅ Multiple glass manufacturers
- ✅ Error handling
- ✅ Event emission
- ✅ Retry logic
- ✅ Confidence scoring

## Requirements Satisfied

### Requirement 3.1: Photo Model
- ✅ Uses logo/silkscreen photo (one of the 5 required fixed photos)

### Requirement 6.32: ADAS Lookup
- ✅ Provides OEM/Aftermarket classification for ADAS vehicles
- ✅ ADAS vehicles require OEM glass - this service provides that information

### Requirement 7: Damage Analysis (Extended)
- ✅ Structured output with confidence and uncertainty indicators
- ✅ Event emission on success and failure
- ✅ Retry logic with exponential backoff

## Design Interface Compliance

The implementation provides a new interface for glass type analysis:

```typescript
interface GlassTypeAnalysisResult {
  claimId: string;
  glassManufacturer?: string;
  vehicleManufacturerLogo?: string;
  glassType: 'oem' | 'aftermarket' | 'unknown';
  confidence: number; // 0-1
  uncertaintyIndicators: string[];
  analysedAt: Date;
}
```

## Example Scenarios

### Scenario 1: OEM Glass (Toyota + AGC)
```json
{
  "claimId": "claim-123",
  "glassManufacturer": "AGC",
  "vehicleManufacturerLogo": "Toyota",
  "glassType": "oem",
  "confidence": 0.95,
  "uncertaintyIndicators": [],
  "analysedAt": "2024-01-15T10:30:00Z"
}
```

### Scenario 2: Aftermarket Glass (Pilkington only)
```json
{
  "claimId": "claim-456",
  "glassManufacturer": "Pilkington",
  "glassType": "aftermarket",
  "confidence": 0.88,
  "uncertaintyIndicators": [],
  "analysedAt": "2024-01-15T10:35:00Z"
}
```

### Scenario 3: Unknown (Poor Quality)
```json
{
  "claimId": "claim-789",
  "glassType": "unknown",
  "confidence": 0.45,
  "uncertaintyIndicators": ["poor_photo_quality", "no_visible_branding"],
  "analysedAt": "2024-01-15T10:40:00Z"
}
```

## Notes

- The service uses the same Vertex AI service account and API key as OCR and damage analysis
- Confidence threshold is shared with damage analysis service (configurable via `.env`)
- Claims with confidence below threshold should be routed to manual review
- The service is designed to be conservative - when uncertain, it flags for manual review
- Glass manufacturers like AGC, Pilkington, Saint-Gobain, Fuyao, Xinyi manufacture BOTH OEM and Aftermarket glass
- The presence of a vehicle manufacturer logo/name is the ONLY indicator of OEM glass
- This service runs in parallel with damage analysis for efficient processing
- Results are used by the decision engine, especially for ADAS vehicle requirements



## Notes

- The service uses the same Vertex AI service account and API key as the OCR service
- Confidence threshold is configurable via `.env` for easy adjustment
- Claims with confidence below threshold should be routed to manual review
- The LLM estimates damage size using visual context from multiple photos
- Borderline cases (damage near thresholds) should have lower confidence scores
- The service is designed to be conservative - when uncertain, it flags for manual review
