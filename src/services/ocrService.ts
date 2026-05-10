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
  confidence?: number;
}

interface GoogleVisionResponse {
  responses: Array<{
    textAnnotations?: GoogleVisionTextAnnotation[];
    fullTextAnnotation?: {
      text: string;
      pages?: Array<{
        confidence?: number;
      }>;
    };
    error?: {
      code: number;
      message: string;
      status?: string;
    };
  }>;
}

export class OCRService {
  private client: AxiosInstance;
  private retryConfig: RetryConfig;
  private readonly MIN_CONFIDENCE_THRESHOLD = 0.6;

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
      // Validate API key is configured
      if (!config.externalApis.googleCloudVision.apiKey) {
        throw new Error('Google Cloud Vision API key is not configured');
      }

      // Convert image to base64
      const base64Image = imageBuffer.toString('base64');

      loggers.app.info('Calling Google Cloud Vision API for VIN extraction', {
        imageSize: imageBuffer.length,
      });

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
        const errorMsg = `Google Vision API error (${result.error.code}): ${result.error.message}`;
        if (result.error.status) {
          loggers.app.error(`API error status: ${result.error.status}`);
        }
        throw new Error(errorMsg);
      }

      // Extract text from response
      const rawText = result.fullTextAnnotation?.text || '';
      const textAnnotations = result.textAnnotations || [];
      const pageConfidence = result.fullTextAnnotation?.pages?.[0]?.confidence;

      if (!rawText && textAnnotations.length === 0) {
        throw new Error('No text detected in image');
      }

      loggers.app.info('OCR text extraction successful', {
        textLength: rawText.length,
        annotationCount: textAnnotations.length,
        pageConfidence,
      });

      // Extract VIN from text
      const vinResult = this.extractVINFromText(rawText, textAnnotations, pageConfidence);

      if (!vinResult) {
        loggers.app.warn('No valid VIN found in OCR text', {
          rawTextSample: rawText.substring(0, 100),
        });
        throw new Error('No valid VIN found in OCR text');
      }

      // Check confidence threshold
      if (vinResult.confidence < this.MIN_CONFIDENCE_THRESHOLD) {
        loggers.app.warn('OCR VIN confidence below threshold', {
          confidence: vinResult.confidence,
          threshold: this.MIN_CONFIDENCE_THRESHOLD,
        });
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
   * @param pageConfidence - Overall page confidence from Google Vision
   * @returns VIN result or null if no valid VIN found
   */
  private extractVINFromText(
    fullText: string,
    annotations: GoogleVisionTextAnnotation[],
    pageConfidence?: number
  ): OCRVINResult | null {
    // Remove whitespace and newlines
    const cleanText = fullText.replace(/\s+/g, '').toUpperCase();

    // Find all potential VIN sequences (17 alphanumeric chars, no I/O/Q)
    const vinPattern = /[A-HJ-NPR-Z0-9]{17}/g;
    const matches = cleanText.match(vinPattern);

    if (!matches || matches.length === 0) {
      loggers.app.debug('No 17-character VIN patterns found in OCR text');
      return null;
    }

    loggers.app.debug(`Found ${matches.length} potential VIN pattern(s) in OCR text`);

    // Validate each match and pick the first valid one
    for (const match of matches) {
      const validation = validateVIN(match);
      if (validation.isValid) {
        // Calculate confidence based on multiple factors
        const confidence = this.calculateConfidence(
          match,
          fullText,
          annotations,
          pageConfidence
        );

        loggers.app.info('Valid VIN found in OCR text', {
          vin: '[VIN_REDACTED]',
          confidence,
          pageConfidence,
        });

        return {
          vin: validation.vin!,
          confidence,
          rawText: fullText,
        };
      } else {
        loggers.app.debug('VIN pattern failed validation', {
          pattern: match,
          errors: validation.errors,
        });
      }
    }

    loggers.app.debug('No valid VINs found after validation');
    return null;
  }

  /**
   * Calculate confidence score for extracted VIN
   * 
   * Factors:
   * - Page-level confidence from Google Vision (if available)
   * - VIN pattern match quality
   * - Text clarity indicators
   * 
   * @param vin - Extracted VIN
   * @param fullText - Full OCR text
   * @param annotations - Text annotations
   * @param pageConfidence - Page confidence from Google Vision
   * @returns Confidence score (0-1)
   */
  private calculateConfidence(
    vin: string,
    fullText: string,
    annotations: GoogleVisionTextAnnotation[],
    pageConfidence?: number
  ): number {
    let confidence = 0.7; // Base confidence for valid VIN pattern

    // Factor 1: Page-level confidence from Google Vision
    if (pageConfidence !== undefined && pageConfidence > 0) {
      confidence = pageConfidence;
    }

    // Factor 2: VIN appears as a continuous sequence in original text
    // (not split across multiple lines or words)
    const vinInOriginalText = fullText.toUpperCase().includes(vin);
    if (vinInOriginalText) {
      confidence = Math.min(confidence + 0.1, 1.0);
    }

    // Factor 3: Text annotation confidence (if available)
    // Find annotations that might contain the VIN
    const vinAnnotations = annotations.filter(
      (ann) => ann.description && ann.description.toUpperCase().includes(vin.substring(0, 8))
    );
    
    if (vinAnnotations.length > 0) {
      const avgAnnotationConfidence = vinAnnotations.reduce(
        (sum, ann) => sum + (ann.confidence || 0.7),
        0
      ) / vinAnnotations.length;
      
      // Blend annotation confidence with current confidence
      confidence = (confidence + avgAnnotationConfidence) / 2;
    }

    // Factor 4: Penalize if text is very short (might be misread)
    if (fullText.length < 20) {
      confidence = Math.max(confidence - 0.1, 0.5);
    }

    // Ensure confidence is in valid range
    return Math.max(0, Math.min(1, confidence));
  }
}

// Export singleton instance
export const ocrService = new OCRService();
