/**
 * VIN Enrichment Service
 * 
 * Orchestrates VIN validation, OCR extraction, geography-based VIN decoding,
 * and ADAS lookup with fallback strategies.
 * 
 * Geography-based routing:
 * - South Africa: Lightstone (primary) → Bayanaty (fallback)
 * - Non-South Africa: Bayanaty (primary) → NHTSA (fallback)
 * - ADAS: Always Bayanaty (global provider)
 */

import { loggers } from '../utils/logger';
import { EventService, EVENT_TYPES } from './eventService';
import { ocrService } from './ocrService';
import { LightstoneDecoder } from './vinDecoders/lightstoneDecoder';
import { BayantyDecoder } from './vinDecoders/bayantyDecoder';
import { NHTSADecoder } from './vinDecoders/nhtsaDecoder';
import { VINDecoderProvider, VehicleData, AdasData, Geography } from './vinDecoders/types';
import { validateVIN } from './vinDecoders/utils';

export type VINResultState = 'validated' | 'ocr_only' | 'insurer_only' | 'mismatch' | 'unavailable';
export type AdasStatus = 'yes' | 'no' | 'unknown';
export type DecoderUsed = 'lightstone' | 'bayanaty' | 'nhtsa' | 'lightstone+bayanaty' | 'bayanaty+nhtsa';

export interface VINEnrichmentResult {
  claimId: string;
  vinResultState: VINResultState;
  insurerProvidedVin?: string;
  ocrExtractedVin?: string;
  ocrConfidenceScore?: number;
  bestValidatedVin?: string;
  vinMismatchFlag: boolean;
  decoderUsed?: DecoderUsed;
  vehicleData?: VehicleData;
  adasStatus: AdasStatus;
  adasFeatures?: string[];
  enrichedAt: Date;
  errors?: string[];
}

export interface VINEnrichmentOptions {
  claimId: string;
  insurerProvidedVin?: string;
  vinCutoutPhotoBuffer?: Buffer;
  geography: Geography;
}

export class VINEnrichmentService {
  private lightstoneDecoder: LightstoneDecoder;
  private bayantyDecoder: BayantyDecoder;
  private nhtsaDecoder: NHTSADecoder;

  constructor() {
    this.lightstoneDecoder = new LightstoneDecoder();
    this.bayantyDecoder = new BayantyDecoder();
    this.nhtsaDecoder = new NHTSADecoder();
  }

  /**
   * Enrich claim with VIN data, vehicle information, and ADAS status
   * 
   * Flow:
   * 1. VIN Source Selection (insurer VIN primary, OCR validation/backup)
   * 2. Geography-Based Vehicle Data Lookup (with fallback)
   * 3. ADAS Lookup (always Bayanaty)
   * 
   * @param options - Enrichment options
   * @returns VIN enrichment result
   */
  async enrich(options: VINEnrichmentOptions): Promise<VINEnrichmentResult> {
    const { claimId, insurerProvidedVin, vinCutoutPhotoBuffer, geography } = options;

    loggers.app.info('Starting VIN enrichment', {
      claimId,
      hasInsurerVin: !!insurerProvidedVin,
      hasVinPhoto: !!vinCutoutPhotoBuffer,
      geography,
    });

    // Emit start event
    await EventService.emit({
      eventType: EVENT_TYPES.VIN_ENRICHMENT_STARTED,
      claimId,
      sourceService: 'vin-enrichment-service',
      actorType: 'system',
      payload: { geography },
    });

    try {
      // Step 1: VIN Source Selection
      const vinSelection = await this.selectVINSource(
        insurerProvidedVin,
        vinCutoutPhotoBuffer
      );

      // Step 2: Geography-Based Vehicle Data Lookup
      let vehicleData: VehicleData | null = null;
      let decoderUsed: DecoderUsed | undefined = undefined;

      if (vinSelection.bestValidatedVin) {
        const vehicleResult = await this.lookupVehicleData(
          vinSelection.bestValidatedVin,
          geography
        );
        vehicleData = vehicleResult.vehicleData;
        decoderUsed = vehicleResult.decoderUsed;
      }

      // Step 3: ADAS Lookup (always Bayanaty)
      let adasStatus: AdasStatus = 'unknown';
      let adasFeatures: string[] | undefined = undefined;

      if (vinSelection.bestValidatedVin) {
        const adasResult = await this.lookupAdasInfo(vinSelection.bestValidatedVin);
        adasStatus = adasResult.status;
        adasFeatures = adasResult.features;
      }

      // Assemble result
      const result: VINEnrichmentResult = {
        claimId,
        vinResultState: vinSelection.vinResultState,
        ...(vinSelection.insurerProvidedVin && { insurerProvidedVin: vinSelection.insurerProvidedVin }),
        ...(vinSelection.ocrExtractedVin && { ocrExtractedVin: vinSelection.ocrExtractedVin }),
        ...(vinSelection.ocrConfidenceScore !== undefined && { ocrConfidenceScore: vinSelection.ocrConfidenceScore }),
        ...(vinSelection.bestValidatedVin && { bestValidatedVin: vinSelection.bestValidatedVin }),
        vinMismatchFlag: vinSelection.vinMismatchFlag,
        ...(decoderUsed && { decoderUsed }),
        ...(vehicleData && { vehicleData }),
        adasStatus,
        ...(adasFeatures && { adasFeatures }),
        enrichedAt: new Date(),
      };

      // Emit success event
      await EventService.emit({
        eventType: EVENT_TYPES.VIN_ENRICHMENT_COMPLETED,
        claimId,
        sourceService: 'vin-enrichment-service',
        actorType: 'system',
        payload: {
          vinResultState: result.vinResultState,
          decoderUsed: result.decoderUsed,
          adasStatus: result.adasStatus,
          hasVehicleData: !!result.vehicleData,
        },
      });

      loggers.app.info('VIN enrichment completed successfully', {
        claimId,
        vinResultState: result.vinResultState,
        decoderUsed: result.decoderUsed,
        adasStatus: result.adasStatus,
      });

      return result;
    } catch (error) {
      // Emit failure event
      await EventService.emit({
        eventType: EVENT_TYPES.VIN_ENRICHMENT_FAILED,
        claimId,
        sourceService: 'vin-enrichment-service',
        actorType: 'system',
        payload: {
          error: (error as Error).message,
        },
      });

      loggers.app.error('VIN enrichment failed', error as Error, { claimId });

      // Return unavailable result
      return {
        claimId,
        vinResultState: 'unavailable',
        vinMismatchFlag: false,
        adasStatus: 'unknown',
        enrichedAt: new Date(),
        errors: [(error as Error).message],
      };
    }
  }

  /**
   * Step 1: VIN Source Selection
   * 
   * Priority:
   * 1. Use insurer-provided VIN as primary
   * 2. If VIN cutout photo available → perform OCR extraction
   * 3. Compare insurer VIN vs OCR VIN
   * 4. If mismatch → use insurer VIN, set mismatch flag
   * 5. If no insurer VIN → use OCR VIN
   * 
   * @returns VIN selection result
   */
  private async selectVINSource(
    insurerProvidedVin?: string,
    vinCutoutPhotoBuffer?: Buffer
  ): Promise<{
    vinResultState: VINResultState;
    insurerProvidedVin?: string;
    ocrExtractedVin?: string;
    ocrConfidenceScore?: number;
    bestValidatedVin?: string;
    vinMismatchFlag: boolean;
  }> {
    let normalizedInsurerVin: string | undefined = undefined;
    let ocrExtractedVin: string | undefined = undefined;
    let ocrConfidenceScore: number | undefined = undefined;

    // Validate and normalize insurer-provided VIN
    if (insurerProvidedVin) {
      const validation = validateVIN(insurerProvidedVin);
      if (validation.isValid) {
        normalizedInsurerVin = validation.vin;
      } else {
        loggers.app.warn('Insurer-provided VIN is invalid', {
          errors: validation.errors,
        });
      }
    }

    // Perform OCR extraction if photo available
    if (vinCutoutPhotoBuffer) {
      try {
        const ocrResult = await ocrService.extractVIN(vinCutoutPhotoBuffer);
        ocrExtractedVin = ocrResult.vin;
        ocrConfidenceScore = ocrResult.confidence;
      } catch (error) {
        loggers.app.warn('OCR VIN extraction failed', {
          error: (error as Error).message,
        });
      }
    }

    // Determine VIN result state and best validated VIN
    let vinResultState: VINResultState;
    let bestValidatedVin: string | undefined;
    let vinMismatchFlag = false;

    if (normalizedInsurerVin && ocrExtractedVin) {
      if (normalizedInsurerVin === ocrExtractedVin) {
        vinResultState = 'validated';
        bestValidatedVin = normalizedInsurerVin;
      } else {
        vinResultState = 'mismatch';
        bestValidatedVin = normalizedInsurerVin; // Use insurer VIN on mismatch
        vinMismatchFlag = true;
        loggers.app.warn('VIN mismatch detected', {
          insurerVin: '[VIN_REDACTED]',
          ocrVin: '[VIN_REDACTED]',
        });
      }
    } else if (ocrExtractedVin && !normalizedInsurerVin) {
      vinResultState = 'ocr_only';
      bestValidatedVin = ocrExtractedVin;
    } else if (normalizedInsurerVin && !ocrExtractedVin) {
      vinResultState = 'insurer_only';
      bestValidatedVin = normalizedInsurerVin;
    } else {
      vinResultState = 'unavailable';
      bestValidatedVin = undefined;
    }

    return {
      vinResultState,
      ...(normalizedInsurerVin && { insurerProvidedVin: normalizedInsurerVin }),
      ...(ocrExtractedVin && { ocrExtractedVin }),
      ...(ocrConfidenceScore !== undefined && { ocrConfidenceScore }),
      ...(bestValidatedVin && { bestValidatedVin }),
      vinMismatchFlag,
    };
  }

  /**
   * Step 2: Geography-Based Vehicle Data Lookup
   * 
   * South Africa: Lightstone (primary) → Bayanaty (fallback)
   * Non-South Africa: Bayanaty (primary) → NHTSA (fallback)
   * 
   * @param vin - Validated VIN
   * @param geography - Customer geography
   * @returns Vehicle data and decoder used
   */
  private async lookupVehicleData(
    vin: string,
    geography: Geography
  ): Promise<{
    vehicleData: VehicleData | null;
    decoderUsed?: DecoderUsed;
  }> {
    if (geography === 'south_africa') {
      // South Africa: Lightstone → Bayanaty
      try {
        const vehicleData = await this.lightstoneDecoder.decode(vin);
        if (vehicleData) {
          return { vehicleData, decoderUsed: 'lightstone' };
        }
      } catch (error) {
        loggers.app.warn('Lightstone decode failed, trying Bayanaty fallback', {
          error: (error as Error).message,
        });
      }

      // Fallback to Bayanaty
      try {
        const vehicleData = await this.bayantyDecoder.decode(vin);
        if (vehicleData) {
          return { vehicleData, decoderUsed: 'lightstone+bayanaty' };
        }
      } catch (error) {
        loggers.app.error('Bayanaty fallback also failed', error as Error);
      }

      return { vehicleData: null };
    } else {
      // Non-South Africa: Bayanaty → NHTSA
      try {
        const vehicleData = await this.bayantyDecoder.decode(vin);
        if (vehicleData) {
          return { vehicleData, decoderUsed: 'bayanaty' };
        }
      } catch (error) {
        loggers.app.warn('Bayanaty decode failed, trying NHTSA fallback', {
          error: (error as Error).message,
        });
      }

      // Fallback to NHTSA
      try {
        const vehicleData = await this.nhtsaDecoder.decode(vin);
        if (vehicleData) {
          return { vehicleData, decoderUsed: 'bayanaty+nhtsa' };
        }
      } catch (error) {
        loggers.app.error('NHTSA fallback also failed', error as Error);
      }

      return { vehicleData: null };
    }
  }

  /**
   * Step 3: ADAS Lookup
   * 
   * Always uses Bayanaty (global provider for all geographies)
   * 
   * @param vin - Validated VIN
   * @returns ADAS status and features
   */
  private async lookupAdasInfo(vin: string): Promise<{
    status: AdasStatus;
    features?: string[];
  }> {
    try {
      const adasData = await this.bayantyDecoder.getAdasInfo(vin);
      
      if (!adasData) {
        return { status: 'unknown' };
      }

      return {
        status: adasData.hasAdasValues ? 'yes' : 'no',
        ...(adasData.adasValues.length > 0 && { features: adasData.adasValues }),
      };
    } catch (error) {
      loggers.app.warn('ADAS lookup failed', {
        error: (error as Error).message,
      });
      return { status: 'unknown' };
    }
  }
}

// Export singleton instance
export const vinEnrichmentService = new VINEnrichmentService();
