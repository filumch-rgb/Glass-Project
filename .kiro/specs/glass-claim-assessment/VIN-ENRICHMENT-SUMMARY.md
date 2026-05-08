# VIN Enrichment Implementation Summary

## Overview
The VIN Enrichment service integrates three external APIs to provide comprehensive vehicle data and ADAS information with geography-based routing and fallback strategies.

---

## Architecture

### **Flow Diagram**
```
Step 1: OCR VIN Extraction
  └── Google Cloud Vision API
      └── Extract VIN from VIN cutout photo
      └── Validate format (17 chars, no I/O/Q)
      └── Compare with insurer-provided VIN

Step 2: Geography-Based Vehicle Data Lookup
  ├── IF South Africa:
  │   ├── Try Lightstone API (primary)
  │   └── If null/fail → Try Bayanaty API (fallback)
  └── IF Non-South Africa:
      ├── Try Bayanaty API (primary)
      └── If null/fail → Try NHTSA API (fallback)

Step 3: ADAS Lookup (Always Bayanaty - Global)
  └── Extract HasAdasValues + AdasValues from Bayanaty
```

---

## API Integration Details

### **1. Google Cloud Vision API (OCR)**
**Purpose:** Extract VIN from VIN cutout photo

**Credentials:**
- API Key: `<stored in .env as GOOGLE_CLOUD_VISION_API_KEY>`
- Service Account: `vertexairunner@fils-glass-project.iam.gserviceaccount.com`

**Process:**
1. Send VIN cutout photo to Google Cloud Vision API
2. Extract text using OCR
3. Validate VIN format (17 characters, excluding I, O, Q)
4. Return confidence score
5. Compare with insurer-provided VIN
6. If mismatch → use insurer VIN, set mismatch flag

**Retry:** 3 attempts with exponential backoff (1s, 2s, 4s)

---

### **2. Lightstone API (South Africa - Vehicle Data)**
**Purpose:** Primary vehicle data provider for South African customers

**Authentication:**
- Endpoint: `POST https://liveapi.lightstoneauto.co.za/services/token`
- Method: Basic Auth
- Username: `nicholas@scans.ai`
- Password: `tiP86H6vvwb@9CA`
- Returns: Bearer JWT token

**⚠️ IMPORTANT - Response Format:**
The Lightstone API returns **PascalCase** fields, not snake_case:
```json
{
  "Token": "eyJhbGci..."
}
```
**NOT** `access_token`, `token_type`, `expires_in`

**Token Expiration:** Tokens are valid for 24 hours (default assumption)

**VIN Decode:**
- Endpoint: `POST https://liveapi.lightstoneauto.co.za/api/gateway`
- Method: POST with Bearer token
- Request Body:
```json
{
  "ClientPackageId": "1e5d9f35-f29c-4aa8-bcc7-0b60733eeb9f",
  "VinNumber": "MALAN51BLEM575556"
}
```

**Response Format:**
- Array of objects with `Description` and `Value` fields
- Extract by matching Description values:
  - Make: `Description: "Make"`
  - Model: `Description: "Model"`
  - Year: `Description: "Warranty Year"` or `"Introduction Date"`
  - Color: `Description: "Colour"`
  - Body Type: `Description: "Body shape"`

**Sample Response Fields:**
```json
[
  {"Description": "Make", "Value": "HYUNDAI"},
  {"Description": "Model", "Value": "i10 1.1 Motion 5-dr [2011-2018]"},
  {"Description": "Warranty Year", "Value": 2014},
  {"Description": "Colour", "Value": "STANDARD WHITE"},
  {"Description": "Body shape", "Value": "Hatch (5-dr)"}
]
```

**Retry:** 3 attempts with exponential backoff (1s, 2s, 4s)

---

### **3. Bayanaty API (Global - Vehicle Data + ADAS)**
**Purpose:** 
- Primary vehicle data provider for non-South African customers
- Fallback vehicle data provider for South African customers
- Primary ADAS provider for ALL customers (global)

**Authentication:**
- Endpoint: `POST https://capi1.bayanaty.com/api/v1/Token`
- Method: Form-urlencoded
- Username: `Apollotest`
- Password: `Apollo#9876`
- Returns: Bearer JWT token

**⚠️ CRITICAL - Password Handling:**
The password contains a `#` character which is treated as a comment delimiter in `.env` files. 
**MUST quote the password in `.env`:**
```bash
BAYANATY_PASSWORD="Apollo#9876"
```

**⚠️ IMPORTANT - Response Format:**
The Bayanaty API returns **PascalCase** fields, not snake_case:
```json
{
  "AccessToken": "eyJhbGci...",
  "IssuedAt": "2026-05-08T12:00:00Z",
  "ExpiresAt": "2026-05-08T12:20:00Z",
  "ExpiresIn": 1200
}
```
**NOT** `access_token`, `token_type`, `expires_in`

**VIN Decode + ADAS:**
- Endpoint: `POST https://capi1.bayanaty.com/api/v1/vehicles`
- Method: POST with Bearer token
- Request Body:
```json
{
  "transactionId": "<uuid-generated-per-request>",
  "agentId": "string",
  "vin": "MALAN51BLEM575556"
}
```

**Response Format:**
```json
{
  "VehicleInfo": {
    "Vin": "MALAN51BLEM575556",
    "MakeName": "HYUNDAI",
    "ModelName": "I10",
    "BuildDate": "2014-06-10",
    "PaintInfo": {
      "Code": "PJW",
      "Value": "PURE WHITE"
    },
    "HeadlampType": null,
    "HeadlampValues": [],
    "HasAdasValues": false,
    "AdasValues": []
  },
  "TransactionId": "string",
  "StatusCode": 200
}
```

**Extract:**
- Make: `VehicleInfo.MakeName`
- Model: `VehicleInfo.ModelName`
- Year: Parse from `VehicleInfo.BuildDate` (e.g., "2014-06-10" → 2014)
- Color: `VehicleInfo.PaintInfo.Value`
- ADAS Status: `VehicleInfo.HasAdasValues` (boolean)
- ADAS Features: `VehicleInfo.AdasValues` (array)

**Retry:** 3 attempts with exponential backoff (1s, 2s, 4s)

---

### **4. NHTSA API (US/International - Free Fallback)**
**Purpose:** Free fallback vehicle data provider for non-South African customers

**VIN Decode:**
- Endpoint: `GET https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/{vin}?format=json`
- Method: GET (no authentication required)
- Returns: JSON with Make, Model, ModelYear

**⚠️ IMPORTANT - Null Value Handling:**
NHTSA returns `null` for missing fields instead of empty strings. The parser must handle:
```typescript
if (field.Value === null || field.Value === undefined) {
  return undefined;
}
```

**⚠️ Model Field Fallback:**
If `Model` field is null, try `Series` field as fallback:
```typescript
const model = findValue('Model') || findValue('Series');
```

**Extract:**
- Make: `Results[].Variable === "Make"` → `Results[].Value`
- Model: `Results[].Variable === "Model"` → `Results[].Value` (or `Series` as fallback)
- Year: `Results[].Variable === "Model Year"` → `Results[].Value`

**Retry:** 3 attempts with exponential backoff (1s, 2s, 4s)

---

## Geography-Based Routing Logic

### **South African Customers:**
```typescript
// Step 1: OCR VIN Extraction (Google Cloud Vision)
const ocrVin = await extractVinFromPhoto(vinCutoutPhoto);

// Step 2: Vehicle Data Lookup
let vehicleData;
try {
  vehicleData = await lightstoneAPI.decode(validatedVin); // Primary
} catch (error) {
  vehicleData = await bayantyAPI.decode(validatedVin);    // Fallback
}

// Step 3: ADAS Lookup (Always Bayanaty)
const adasData = await bayantyAPI.getAdasInfo(validatedVin);
```

### **Non-South African Customers:**
```typescript
// Step 1: OCR VIN Extraction (Google Cloud Vision)
const ocrVin = await extractVinFromPhoto(vinCutoutPhoto);

// Step 2: Vehicle Data Lookup
let vehicleData;
try {
  vehicleData = await bayantyAPI.decode(validatedVin);    // Primary
} catch (error) {
  vehicleData = await nhtsaAPI.decode(validatedVin);      // Fallback
}

// Step 3: ADAS Lookup (Always Bayanaty)
const adasData = await bayantyAPI.getAdasInfo(validatedVin);
```

---

## VIN Result States

| State | Description |
|-------|-------------|
| `validated` | Both insurer VIN and OCR VIN present and match |
| `ocr_only` | No insurer VIN provided, using OCR VIN |
| `insurer_only` | OCR failed or not performed, using insurer VIN |
| `mismatch` | Both present but differ (use insurer VIN, set flag) |
| `unavailable` | Neither insurer VIN nor OCR VIN available |

---

## ADAS Status Values

| Status | Description |
|--------|-------------|
| `yes` | `HasAdasValues = true` from Bayanaty |
| `no` | `HasAdasValues = false` from Bayanaty |
| `unknown` | Bayanaty API call failed after retries |

---

## Error Handling

### **Retry Strategy:**
- All external API calls: 3 retries with exponential backoff (1s, 2s, 4s)
- Applies to: Google Cloud Vision, Lightstone, Bayanaty, NHTSA

### **Fallback Strategy:**
- **South Africa:** Lightstone fails → try Bayanaty
- **Non-South Africa:** Bayanaty fails → try NHTSA
- **ADAS:** Bayanaty fails → set status to 'unknown', continue processing

### **Critical Failures:**
- If all VIN enrichment attempts fail → set `vinResultState` to 'unavailable'
- Route claim to manual review
- Emit `vin.enrichment_completed` event with failure details

---

## Output Structure

```typescript
interface VINEnrichmentResult {
  claimId: string;
  vinResultState: 'validated' | 'ocr_only' | 'insurer_only' | 'mismatch' | 'unavailable';
  insurerProvidedVin?: string;
  ocrExtractedVin?: string;
  ocrConfidenceScore?: number;
  bestValidatedVin?: string;
  vinMismatchFlag: boolean;
  decoderUsed: 'lightstone' | 'bayanaty' | 'nhtsa' | 'lightstone+bayanaty' | 'bayanaty+nhtsa';
  vehicleData?: {
    make: string;              // REQUIRED
    model: string;             // REQUIRED
    year?: number;
    bodyType?: string;
    color?: string;
    additionalMetadata?: Record<string, any>;
  };
  adasStatus: 'yes' | 'no' | 'unknown';
  adasFeatures?: string[];
  enrichedAt: Date;
}
```

---

## Implementation Checklist

### **Task 7.1: VIN Decoder Provider Abstraction**
- [ ] Create VINDecoderProvider interface
- [ ] Implement Lightstone API client (auth + decode)
- [ ] Implement Bayanaty API client (auth + decode + ADAS)
- [ ] Implement NHTSA API client (decode)
- [ ] Add geography-based routing logic
- [ ] Implement fallback strategy

### **Task 7.2: OCR VIN Extraction**
- [ ] Integrate Google Cloud Vision API
- [ ] Add VIN format validation (17 chars, no I/O/Q)
- [ ] Implement VIN source priority logic
- [ ] Add VIN mismatch detection
- [ ] Store OCR confidence score

### **Task 7.3: ADAS Lookup**
- [ ] Extract HasAdasValues from Bayanaty response
- [ ] Extract AdasValues array from Bayanaty response
- [ ] Determine ADAS status (yes/no/unknown)
- [ ] Implement retry logic for all APIs
- [ ] Add error handling

### **Task 7.4: Integration Testing**
- [ ] Test South Africa routing (Lightstone → Bayanaty)
- [ ] Test Non-SA routing (Bayanaty → NHTSA)
- [ ] Test VIN result state derivation
- [ ] Test VIN mismatch handling
- [ ] Test ADAS lookup
- [ ] Test retry and fallback logic
- [ ] Test event emission

---

## Performance Target

**Total VIN Enrichment Time:** ≤ 30 seconds
- OCR VIN Extraction: ~5-10 seconds
- Vehicle Data Lookup: ~5-10 seconds (including retries/fallback)
- ADAS Lookup: ~5-10 seconds (including retries)

---

## Security Notes

- Store all API credentials in environment variables (`.env` file)
- Never commit credentials to source code
- Use PII-safe logging (mask VINs in logs)
- Implement rate limiting for external API calls
- Monitor API usage and costs

---

## Next Steps

1. ✅ Spec documents updated (requirements.md, design.md, tasks.md)
2. ⏭️ Ready to implement Task 7
3. ⏭️ Add API credentials to `.env` file
4. ⏭️ Create VIN enrichment service implementation
5. ⏭️ Write integration tests

---

**Spec Status:** ✅ COMPLETE - Ready for implementation!
