/**
 * Damage Analysis Service
 * 
 * Uses Google Gemini 1.5 Pro Vision (multimodal LLM) to analyze windscreen damage
 * and determine repair eligibility based on ROLAGS/NAGS guidelines.
 * 
 * API Key: Stored in .env as GOOGLE_CLOUD_VISION_API_KEY (same as OCR)
 * Service Account: vertexairunner@fils-glass-project.iam.gserviceaccount.com
 * Model: gemini-1.5-pro-vision (configurable via .env)
 */

import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { loggers } from '../utils/logger';
import { withRetry } from './vinDecoders/utils';
import { RetryConfig } from './vinDecoders/types';
import { EventService, EVENT_TYPES } from './eventService';

export type EvidenceSufficiency = 'sufficient' | 'sufficient_with_warnings' | 'insufficient';

export interface DamageAnalysisResult {
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

export interface DamageAnalysisOptions {
  claimId: string;
  damagePhotos: Buffer[]; // 1-3 damage photos
  insideDriverPhoto?: Buffer; // For scale context
  insidePassengerPhoto?: Buffer; // For scale context
}

interface GeminiRequest {
  contents: Array<{
    parts: Array<{
      text?: string;
      inline_data?: {
        mime_type: string;
        data: string; // Base64-encoded image
      };
    }>;
  }>;
  generationConfig: {
    temperature: number;
    topK: number;
    topP: number;
    maxOutputTokens: number;
    responseMimeType: string;
  };
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
    finishReason: string;
    safetyRatings?: Array<{
      category: string;
      probability: string;
    }>;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
  error?: {
    code: number;
    message: string;
    status?: string;
  };
}

/**
 * ROLAGS/NAGS Guidelines System Prompt
 * 
 * This prompt embeds the complete ROLAGS/NAGS repair criteria into the LLM
 * and requests structured JSON output for damage analysis.
 */
const ROLAGS_SYSTEM_PROMPT = `You are an expert windscreen damage assessment AI trained on ROLAGS/NAGS (Repair of Laminated Automotive Glass Standard / National Auto Glass Specifications) guidelines.

Your task is to analyze windscreen damage photos and determine:
1. Damage type and dimensions
2. Location relative to Driver's Primary Viewing Area (DPVA)
3. Repair eligibility based on ROLAGS/NAGS criteria
4. Confidence in your assessment

## ROLAGS/NAGS REPAIR CRITERIA

### Repairable Damage Types:
- **Bullseye**: Circular damage ≤ 1 inch (25mm) diameter
- **Star Break**: Radial cracks from central point ≤ 3 inches (75mm) diameter
- **Combination Break**: Body ≤ 2 inches (50mm) diameter (excluding legs)
- **Half-Moon**: Partial circular damage ≤ 1 inch (25mm) diameter
- **Crack**: Linear crack ≤ 14 inches (350mm) long
- **Surface Pit**: Shallow impact ≥ 1/8 inch (3mm) diameter

### DO NOT REPAIR (Replacement Required):
- Damage penetrating both glass layers
- 3 or more long cracks from single impact point
- Damage on inside glass layer (not outer surface)
- Contaminated damage (dirt, debris embedded)
- Plastic interlayer damage visible
- Pit size > 3/8 inch (9mm) diameter
- Edge cracks intersecting more than 1 edge
- Stress cracks (not from impact)

### Driver's Primary Viewing Area (DPVA) Restrictions:
- **DPVA Definition**: 12 inches (300mm) wide, centered on driver, extending from top to bottom of wiper sweep
- **DPVA Rules**:
  - Damage > 1 inch in DPVA → DO NOT REPAIR
  - Finished pit > 3/16 inch in DPVA → DO NOT REPAIR
  - Repair within 4 inches of another repair in DPVA → DO NOT REPAIR

## DAMAGE SIZE ESTIMATION

Use visual context clues to estimate damage dimensions:
- **Steering wheel diameter**: ~14-15 inches (350-380mm)
- **Windscreen frame width**: ~50-60 inches (1270-1520mm)
- **Typical windscreen height**: ~30-35 inches (760-890mm)
- **Human hand width**: ~3-4 inches (75-100mm)
- **Credit card**: 3.37 x 2.125 inches (85.6 x 54mm)

Compare damage size to these reference objects visible in photos.

## OUTPUT FORMAT

Return a JSON object with this exact structure:

{
  "damagePoints": [
    {
      "affectedRegion": "driver_side_upper" | "passenger_side_upper" | "center_upper" | "driver_side_lower" | "passenger_side_lower" | "center_lower" | "dpva" | "edge",
      "severityAttributes": {
        "damageType": "bullseye" | "star_break" | "combination_break" | "half_moon" | "crack" | "surface_pit" | "unknown",
        "estimatedDiameterInches": number | null,
        "estimatedLengthInches": number | null,
        "inDPVA": boolean,
        "repairEligible": boolean,
        "repairBlockingReasons": string[]
      },
      "glassObservations": [
        "penetrates_both_layers" | "inside_layer_damage" | "contaminated" | "interlayer_damage" | "edge_crack" | "stress_crack" | "multiple_long_cracks" | "pit_too_large" | "damage_too_large" | "dpva_restriction" | "clean_outer_surface_damage"
      ]
    }
  ],
  "overallConfidence": number (0.0 to 1.0),
  "uncertaintyIndicators": [
    "poor_photo_quality" | "insufficient_scale_reference" | "unclear_damage_boundaries" | "lighting_issues" | "angle_obscures_damage" | "multiple_damage_points_unclear" | "dpva_location_uncertain"
  ],
  "insufficiencyFlags": [
    "no_damage_visible" | "photo_too_blurry" | "damage_not_in_frame" | "need_closer_photo" | "need_different_angle" | "need_scale_reference"
  ],
  "evidenceSufficiencyAssessment": "sufficient" | "sufficient_with_warnings" | "insufficient"
}

## ASSESSMENT GUIDELINES

1. **Confidence Scoring**:
   - 0.9-1.0: Clear damage, good photo quality, confident size estimate
   - 0.7-0.89: Visible damage, acceptable quality, reasonable size estimate
   - 0.5-0.69: Damage visible but quality/scale issues affect confidence
   - 0.0-0.49: Poor quality, unclear damage, unreliable assessment

2. **Evidence Sufficiency**:
   - "sufficient": Clear damage photos with scale context, confident assessment possible
   - "sufficient_with_warnings": Damage visible but some uncertainty (note in uncertaintyIndicators)
   - "insufficient": Cannot make reliable assessment (note specific issues in insufficiencyFlags)

3. **Multiple Damage Points**:
   - Analyze each distinct damage point separately
   - Check for multiple cracks from single impact (3+ long cracks → DO NOT REPAIR)

4. **Conservative Approach**:
   - When uncertain about size, err on the side of caution
   - If damage appears borderline, note uncertainty and recommend manual review
   - If DPVA location uncertain, flag it

Analyze the provided photos and return ONLY the JSON object (no additional text).`;

export class DamageAnalysisService {
  private client: AxiosInstance;
  private retryConfig: RetryConfig;
  private readonly confidenceThreshold: number;
  private readonly model: string;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://generativelanguage.googleapis.com',
      timeout: 60000, // 60 seconds for multimodal analysis
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.retryConfig = {
      maxRetries: config.damageAnalysis.maxRetries,
      initialDelayMs: config.assessment.retryInitialDelayMs,
    };

    this.confidenceThreshold = config.damageAnalysis.confidenceThreshold;
    this.model = config.damageAnalysis.model;
  }

  /**
   * Analyze windscreen damage using Gemini 1.5 Pro Vision
   * 
   * @param options - Analysis options with damage photos and context photos
   * @returns Structured damage analysis result
   * @throws Error if analysis fails or evidence is insufficient
   */
  async analyze(options: DamageAnalysisOptions): Promise<DamageAnalysisResult> {
    const { claimId, damagePhotos, insideDriverPhoto, insidePassengerPhoto } = options;

    try {
      // Validate API key is configured
      if (!config.externalApis.googleCloudVision.apiKey) {
        throw new Error('Google Cloud Vision API key is not configured');
      }

      // Validate we have at least one damage photo
      if (!damagePhotos || damagePhotos.length === 0) {
        throw new Error('At least one damage photo is required for analysis');
      }

      loggers.app.info('Starting damage analysis', {
        claimId,
        damagePhotoCount: damagePhotos.length,
        hasInsideDriverPhoto: !!insideDriverPhoto,
        hasInsidePassengerPhoto: !!insidePassengerPhoto,
      });

      // Emit start event
      await EventService.emit({
        eventType: EVENT_TYPES.DAMAGE_ANALYSIS_STARTED,
        claimId,
        sourceService: 'damage-analysis-service',
        actorType: 'system',
        payload: {
          damagePhotoCount: damagePhotos.length,
          hasScaleContext: !!(insideDriverPhoto || insidePassengerPhoto),
        },
      });

      // Prepare multimodal request with system prompt and photos
      const requestParts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [];

      // Add system prompt
      requestParts.push({ text: ROLAGS_SYSTEM_PROMPT });

      // Add instruction for photo analysis
      let photoDescription = `\n\nAnalyze the following ${damagePhotos.length} damage photo(s)`;
      if (insideDriverPhoto || insidePassengerPhoto) {
        photoDescription += ` and ${insideDriverPhoto && insidePassengerPhoto ? '2' : '1'} inside vehicle photo(s) for scale context`;
      }
      photoDescription += ':\n\n';
      requestParts.push({ text: photoDescription });

      // Add damage photos
      for (let i = 0; i < damagePhotos.length; i++) {
        requestParts.push({
          text: `Damage Photo ${i + 1}:`,
        });
        requestParts.push({
          inline_data: {
            mime_type: 'image/jpeg',
            data: damagePhotos[i]!.toString('base64'),
          },
        });
      }

      // Add inside vehicle photos for scale context
      if (insideDriverPhoto) {
        requestParts.push({
          text: 'Inside Vehicle (Driver Side) - for scale reference:',
        });
        requestParts.push({
          inline_data: {
            mime_type: 'image/jpeg',
            data: insideDriverPhoto.toString('base64'),
          },
        });
      }

      if (insidePassengerPhoto) {
        requestParts.push({
          text: 'Inside Vehicle (Passenger Side) - for scale reference:',
        });
        requestParts.push({
          inline_data: {
            mime_type: 'image/jpeg',
            data: insidePassengerPhoto.toString('base64'),
          },
        });
      }

      // Call Gemini API with retry
      const response = await withRetry(
        async () => {
          const requestBody: GeminiRequest = {
            contents: [
              {
                parts: requestParts,
              },
            ],
            generationConfig: {
              temperature: 0.1, // Low temperature for consistent, factual analysis
              topK: 32,
              topP: 0.95,
              maxOutputTokens: 2048,
              responseMimeType: 'application/json', // Request JSON output
            },
          };

          const res = await this.client.post<GeminiResponse>(
            `/v1beta/models/${this.model}:generateContent?key=${config.externalApis.googleCloudVision.apiKey}`,
            requestBody
          );

          return res.data;
        },
        this.retryConfig,
        'Google Gemini Damage Analysis'
      );

      // Check for API errors
      if (response.error) {
        const errorMsg = `Gemini API error (${response.error.code}): ${response.error.message}`;
        if (response.error.status) {
          loggers.app.error(`API error status: ${response.error.status}`);
        }
        throw new Error(errorMsg);
      }

      // Extract response
      const candidate = response.candidates?.[0];
      if (!candidate || !candidate.content?.parts?.[0]?.text) {
        throw new Error('Gemini API returned no content');
      }

      const responseText = candidate.content.parts[0].text;

      loggers.app.info('Gemini API response received', {
        claimId,
        finishReason: candidate.finishReason,
        responseLength: responseText.length,
        tokenUsage: response.usageMetadata,
      });

      // Parse JSON response
      let analysisData: {
        damagePoints: Array<{
          affectedRegion: string;
          severityAttributes: Record<string, unknown>;
          glassObservations: string[];
        }>;
        overallConfidence: number;
        uncertaintyIndicators: string[];
        insufficiencyFlags: string[];
        evidenceSufficiencyAssessment: EvidenceSufficiency;
      };

      try {
        analysisData = JSON.parse(responseText);
      } catch (parseError) {
        loggers.app.error('Failed to parse Gemini JSON response', parseError as Error, {
          claimId,
          responseText: responseText.substring(0, 500),
        });
        throw new Error('Failed to parse damage analysis response as JSON');
      }

      // Validate required fields
      if (!analysisData.damagePoints || !Array.isArray(analysisData.damagePoints)) {
        throw new Error('Invalid damage analysis response: missing damagePoints array');
      }

      if (typeof analysisData.overallConfidence !== 'number') {
        throw new Error('Invalid damage analysis response: missing overallConfidence');
      }

      if (!analysisData.evidenceSufficiencyAssessment) {
        throw new Error('Invalid damage analysis response: missing evidenceSufficiencyAssessment');
      }

      // Assemble result
      const result: DamageAnalysisResult = {
        claimId,
        damagePoints: analysisData.damagePoints,
        overallConfidence: analysisData.overallConfidence,
        uncertaintyIndicators: analysisData.uncertaintyIndicators || [],
        insufficiencyFlags: analysisData.insufficiencyFlags || [],
        evidenceSufficiencyAssessment: analysisData.evidenceSufficiencyAssessment,
        analysedAt: new Date(),
      };

      // Check confidence threshold
      if (result.overallConfidence < this.confidenceThreshold) {
        loggers.app.warn('Damage analysis confidence below threshold', {
          claimId,
          confidence: result.overallConfidence,
          threshold: this.confidenceThreshold,
        });
      }

      // Emit success event
      await EventService.emit({
        eventType: EVENT_TYPES.DAMAGE_ANALYSIS_COMPLETED,
        claimId,
        sourceService: 'damage-analysis-service',
        actorType: 'system',
        payload: {
          damagePointCount: result.damagePoints.length,
          overallConfidence: result.overallConfidence,
          evidenceSufficiency: result.evidenceSufficiencyAssessment,
          hasUncertainty: result.uncertaintyIndicators.length > 0,
          hasInsufficiency: result.insufficiencyFlags.length > 0,
        },
      });

      loggers.app.info('Damage analysis completed successfully', {
        claimId,
        damagePointCount: result.damagePoints.length,
        overallConfidence: result.overallConfidence,
        evidenceSufficiency: result.evidenceSufficiencyAssessment,
      });

      return result;
    } catch (error) {
      // Emit failure event
      await EventService.emit({
        eventType: EVENT_TYPES.DAMAGE_ANALYSIS_FAILED,
        claimId,
        sourceService: 'damage-analysis-service',
        actorType: 'system',
        payload: {
          error: (error as Error).message,
        },
      });

      loggers.app.error('Damage analysis failed', error as Error, { claimId });
      throw error;
    }
  }
}

// Export singleton instance
export const damageAnalysisService = new DamageAnalysisService();
