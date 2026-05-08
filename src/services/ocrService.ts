/**
 * OCR Service for VIN Extraction
 * 
 * Uses Google Cloud Vision API to extract VIN from VIN cutout photos
 * 
 * API Key: Stored in .env as GOOGLE_CLOUD_VISION_API_KEY
 * Service Account: vertexairunner@fils-glass-project.iam.gserviceaccount.com
 */

import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { loggers } from '../utils/logger';
import { validateVIN } from './vinDecoders/utils';
import { withRetry } from './vinDecoders/utils';
import { RetryConfig } from './vinDecoders/types';

export interface OCRVINResult {
  vin: string;
  confidence: number;
  rawText: string;
}

interface GoogleVisionRequest {
  requests: Array<{
    image: {
      content: string; // Base64-encoded image
    };
    features: Array<{
      type: string;
      maxResults?: number;
    }>;
  }>;
}

interface GoogleVisionTextAnnotation {
  description: string;
  boundingPoly?: {
    vertices: Array<{ x: number; y: number }>;
  };
}

interface GoogleVisionResponse {
  responses: Array<{
    textAnnotations?: GoogleVisionTextAnnotation[];
    fullTextAnnotation?: {
      text: string;
    };
    error?: {
      code: number;
      message: string;
    };
  }>;
}

export class OCRService {
  private client: AxiosInstance;
  private retryConfig: RetryConfig;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://vision.googleapis.com',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.retryConfig = {
      maxRetries: config.assessment.maxApiRetries,
      initialDelayMs: config.assessment.retryInitialDelayMs,
    };
  }

  /**
   * Extract VIN from photo using Google Cloud Vision OCR
   * 
   * @param imageBuffer - Image file buffer
   * @returns OCR result with VIN, confidence, and raw text
   * @throws Error if OCR fails or no valid VIN found
   */
  async extractVIN(imageBuffer: Buffer): Promise<OCRVINResult> {
    try {
      // Convert image to base64
      const base64Image = imageBuffer.toString('base64');

      // Call Google Cloud Vision API with retry
      const response = await withRetry(
        async () => {
          const requestBody: GoogleVisionRequest = {
            requests: [
              {
                image: {
                  content: base64Image,
                },
                features: [
                  {
                    type: 'TEXT_DETECTION',
                    maxResults: 1,
                  },
                ],
              },
            ],
          };

          const res = await this.client.post<GoogleVisionResponse>(
            `/v1/images:annotate?key=${config.externalApis.googleCloudVision.apiKey}`,
            requestBody
          );

          return res.data;
        },
        this.retryConfig,
        'Google Cloud Vision OCR'
      );

      // Check for API errors
      const result = response.responses[0];
      if (!result) {
        throw new Error('Google Vision API returned no response');
      }
      
      if (result.error) {
        throw new Error(`Google Vision API error: ${result.error.message}`);
      }

      // Extract text from response
      const rawText = result.fullTextAnnotation?.text || '';
      const textAnnotations = result.textAnnotations || [];

      if (!rawText && textAnnotations.length === 0) {
        throw new Error('No text detected in image');
      }

      // Extract VIN from text
      const vinResult = this.extractVINFromText(rawText, textAnnotations);

      if (!vinResult) {
        throw new Error('No valid VIN found in OCR text');
      }

      loggers.app.info('OCR VIN extraction successful', {
        vin: '[VIN_REDACTED]',
        confidence: vinResult.confidence,
      });

      return vinResult;
    } catch (error) {
      loggers.app.error('OCR VIN extraction failed', error as Error);
      throw error;
    }
  }

  /**
   * Extract VIN from OCR text
   * 
   * Strategy:
   * 1. Look for 17-character alphanumeric sequences (excluding I, O, Q)
   * 2. Validate VIN format
   * 3. Return highest confidence match
   * 
   * @param fullText - Full OCR text
   * @param annotations - Individual text annotations with confidence
   * @returns VIN result or null if no valid VIN found
   */
  private extractVINFromText(
    fullText: string,
    annotations: GoogleVisionTextAnnotation[]
  ): OCRVINResult | null {
    // Remove whitespace and newlines
    const cleanText = fullText.replace(/\s+/g, '').toUpperCase();

    // Find all potential VIN sequences (17 alphanumeric chars, no I/O/Q)
    const vinPattern = /[A-HJ-NPR-Z0-9]{17}/g;
    const matches = cleanText.match(vinPattern);

    if (!matches || matches.length === 0) {
      return null;
    }

    // Validate each match and pick the first valid one
    for (const match of matches) {
      const validation = validateVIN(match);
      if (validation.isValid) {
        // Calculate confidence based on text detection confidence
        // Google Vision doesn't provide per-word confidence in TEXT_DETECTION mode
        // Use a heuristic: if we found a valid VIN pattern, confidence is high
        const confidence = 0.9; // High confidence if VIN format is valid

        return {
          vin: validation.vin!,
          confidence,
          rawText: fullText,
        };
      }
    }

    return null;
  }
}

// Export singleton instance
export const ocrService = new OCRService();
