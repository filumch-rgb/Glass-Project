/**
 * Glass Type Analysis Service
 * 
 * Uses Google Gemini 1.5 Pro Vision to analyze windscreen logo/silkscreen photos
 * and determine glass brand and OEM vs Aftermarket classification.
 * 
 * API Key: Stored in .env as GOOGLE_CLOUD_VISION_API_KEY (same as OCR and damage analysis)
 * Service Account: vertexairunner@fils-glass-project.iam.gserviceaccount.com
 * Model: gemini-1.5-pro (configurable via .env)
 */

import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { loggers } from '../utils/logger';
import { withRetry } from './vinDecoders/utils';
import { RetryConfig } from './vinDecoders/types';
import { EventService, EVENT_TYPES } from './eventService';

export type GlassType = 'oem' | 'aftermarket' | 'unknown';

export interface GlassTypeAnalysisResult {
  claimId: string;
  glassManufacturer?: string; // e.g., "AGC", "Pilkington", "Saint-Gobain", "Fuyao", "Xinyi"
  vehicleManufacturerLogo?: string; // e.g., "Toyota", "Honda", "BMW" (if present)
  glassType: GlassType;
  confidence: number; // 0-1
  uncertaintyIndicators: string[];
  analysedAt: Date;
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
 * Glass Type Analysis System Prompt
 * 
 * This prompt instructs the LLM to identify glass branding and classify
 * OEM vs Aftermarket based on vehicle manufacturer logo presence.
 */
const GLASS_TYPE_SYSTEM_PROMPT = `You are an expert at identifying automotive glass branding and classification.

Your task is to analyze a windscreen logo/silkscreen photo and determine:
1. Glass manufacturer brand (if visible)
2. Vehicle manufacturer logo/name (if present)
3. Whether the glass is OEM or Aftermarket

## CLASSIFICATION RULES

**OEM Glass:**
- Vehicle manufacturer logo or name is visible (e.g., Toyota, Honda, BMW, Mercedes, Ford, etc.)
- The presence of a vehicle manufacturer logo/name indicates OEM glass
- Glass manufacturers like AGC, Pilkington, Saint-Gobain, Fuyao, Xinyi manufacture BOTH OEM and Aftermarket glass
- The vehicle logo is what distinguishes OEM from Aftermarket

**Aftermarket Glass:**
- Only glass manufacturer branding visible (e.g., AGC, Pilkington, Saint-Gobain, Fuyao, Xinyi, Guardian, Vitro, Shatterprufe)
- No vehicle manufacturer logo or name present
- Glass manufacturer branding alone does NOT indicate OEM

**Unknown:**
- Cannot determine due to poor photo quality
- No visible branding of any kind
- Photo does not show the logo/silkscreen area clearly

## COMMON GLASS MANUFACTURERS

Look for these glass manufacturer brands:
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

## COMMON VEHICLE MANUFACTURERS (OEM INDICATORS)

Look for these vehicle manufacturer logos/names:
- Toyota, Lexus
- Honda, Acura
- Ford, Lincoln
- GM (Chevrolet, GMC, Cadillac, Buick)
- Volkswagen, Audi, Porsche
- BMW, Mini
- Mercedes-Benz
- Nissan, Infiniti
- Hyundai, Kia, Genesis
- Mazda
- Subaru
- Volvo
- Jaguar, Land Rover
- Tesla
- Stellantis brands (Jeep, Ram, Dodge, Chrysler, Fiat, Peugeot, Citroën)

## OUTPUT FORMAT

Return a JSON object with this exact structure:

{
  "glassManufacturer": "string or null",
  "vehicleManufacturerLogo": "string or null",
  "glassType": "oem" | "aftermarket" | "unknown",
  "confidence": number (0.0 to 1.0),
  "uncertaintyIndicators": [
    "poor_photo_quality" | "no_visible_branding" | "unclear_logo" | "lighting_issues" | "angle_obscures_branding" | "partial_branding_visible"
  ]
}

## CONFIDENCE SCORING

- 0.9-1.0: Clear branding visible, confident classification
- 0.7-0.89: Branding visible, reasonable classification
- 0.5-0.69: Some branding visible but quality issues affect confidence
- 0.0-0.49: Poor quality, unclear branding, unreliable classification

## IMPORTANT NOTES

1. Glass manufacturers like AGC, Pilkington, Saint-Gobain, Fuyao, Xinyi manufacture BOTH OEM and Aftermarket glass
2. The presence of a vehicle manufacturer logo/name is the ONLY indicator of OEM glass
3. If you see only glass manufacturer branding (no vehicle logo), classify as Aftermarket
4. If you cannot determine due to photo quality, classify as Unknown with appropriate uncertainty indicators
5. Be conservative - when uncertain, use lower confidence scores and include uncertainty indicators

Analyze the provided photo and return ONLY the JSON object (no additional text).`;

export class GlassTypeAnalysisService {
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
   * Analyze glass type and brand using Gemini 1.5 Pro Vision
   * 
   * @param claimId - Claim identifier
   * @param logoSilkscreenPhoto - Logo/silkscreen photo buffer
   * @returns Structured glass type analysis result
   * @throws Error if analysis fails
   */
  async analyze(claimId: string, logoSilkscreenPhoto: Buffer): Promise<GlassTypeAnalysisResult> {
    try {
      // Validate API key is configured
      if (!config.externalApis.googleCloudVision.apiKey) {
        throw new Error('Google Cloud Vision API key is not configured');
      }

      // Validate we have a photo
      if (!logoSilkscreenPhoto || logoSilkscreenPhoto.length === 0) {
        throw new Error('Logo/silkscreen photo is required for glass type analysis');
      }

      loggers.app.info('Starting glass type analysis', {
        claimId,
        photoSize: logoSilkscreenPhoto.length,
      });

      // Emit start event
      await EventService.emit({
        eventType: EVENT_TYPES.DAMAGE_ANALYSIS_STARTED, // Reusing damage analysis events for now
        claimId,
        sourceService: 'glass-type-analysis-service',
        actorType: 'system',
        payload: {
          analysisType: 'glass_type',
        },
      });

      // Prepare multimodal request with system prompt and photo
      const requestParts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [];

      // Add system prompt
      requestParts.push({ text: GLASS_TYPE_SYSTEM_PROMPT });

      // Add instruction for photo analysis
      requestParts.push({
        text: '\n\nAnalyze the following windscreen logo/silkscreen photo:\n\n',
      });

      // Add logo/silkscreen photo
      requestParts.push({
        inline_data: {
          mime_type: 'image/jpeg',
          data: logoSilkscreenPhoto.toString('base64'),
        },
      });

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
              maxOutputTokens: 1024,
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
        'Google Gemini Glass Type Analysis'
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
        glassManufacturer?: string;
        vehicleManufacturerLogo?: string;
        glassType: GlassType;
        confidence: number;
        uncertaintyIndicators: string[];
      };

      try {
        analysisData = JSON.parse(responseText);
      } catch (parseError) {
        loggers.app.error('Failed to parse Gemini JSON response', parseError as Error, {
          claimId,
          responseText: responseText.substring(0, 500),
        });
        throw new Error('Failed to parse glass type analysis response as JSON');
      }

      // Validate required fields
      if (!analysisData.glassType) {
        throw new Error('Invalid glass type analysis response: missing glassType');
      }

      if (typeof analysisData.confidence !== 'number') {
        throw new Error('Invalid glass type analysis response: missing confidence');
      }

      // Validate glassType is one of the allowed values
      if (!['oem', 'aftermarket', 'unknown'].includes(analysisData.glassType)) {
        throw new Error(`Invalid glassType value: ${analysisData.glassType}`);
      }

      // Assemble result
      const result: GlassTypeAnalysisResult = {
        claimId,
        ...(analysisData.glassManufacturer && { glassManufacturer: analysisData.glassManufacturer }),
        ...(analysisData.vehicleManufacturerLogo && { vehicleManufacturerLogo: analysisData.vehicleManufacturerLogo }),
        glassType: analysisData.glassType,
        confidence: analysisData.confidence,
        uncertaintyIndicators: analysisData.uncertaintyIndicators || [],
        analysedAt: new Date(),
      };

      // Check confidence threshold
      if (result.confidence < this.confidenceThreshold) {
        loggers.app.warn('Glass type analysis confidence below threshold', {
          claimId,
          confidence: result.confidence,
          threshold: this.confidenceThreshold,
        });
      }

      // Emit success event
      await EventService.emit({
        eventType: EVENT_TYPES.DAMAGE_ANALYSIS_COMPLETED, // Reusing damage analysis events for now
        claimId,
        sourceService: 'glass-type-analysis-service',
        actorType: 'system',
        payload: {
          analysisType: 'glass_type',
          glassType: result.glassType,
          glassManufacturer: result.glassManufacturer,
          vehicleManufacturerLogo: result.vehicleManufacturerLogo,
          confidence: result.confidence,
          hasUncertainty: result.uncertaintyIndicators.length > 0,
        },
      });

      loggers.app.info('Glass type analysis completed successfully', {
        claimId,
        glassType: result.glassType,
        glassManufacturer: result.glassManufacturer,
        vehicleManufacturerLogo: result.vehicleManufacturerLogo,
        confidence: result.confidence,
      });

      return result;
    } catch (error) {
      // Emit failure event
      await EventService.emit({
        eventType: EVENT_TYPES.DAMAGE_ANALYSIS_FAILED, // Reusing damage analysis events for now
        claimId,
        sourceService: 'glass-type-analysis-service',
        actorType: 'system',
        payload: {
          analysisType: 'glass_type',
          error: (error as Error).message,
        },
      });

      loggers.app.error('Glass type analysis failed', error as Error, { claimId });
      throw error;
    }
  }
}

// Export singleton instance
export const glassTypeAnalysisService = new GlassTypeAnalysisService();
