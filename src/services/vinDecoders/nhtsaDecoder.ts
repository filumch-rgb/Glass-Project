/**
 * NHTSA VIN Decoder (US/International - Free Fallback)
 * 
 * Free fallback vehicle data provider for non-South African customers
 * No authentication required
 * 
 * Endpoint: GET https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/{vin}?format=json
 */

import axios, { AxiosInstance } from 'axios';
import { config } from '../../config';
import { loggers } from '../../utils/logger';
import { VINDecoderProvider, VehicleData, RetryConfig } from './types';
import { validateVIN, withRetry, safeString, safeNumber } from './utils';

interface NHTSAResultField {
  Variable: string;
  Value: string | null;
  ValueId: string | null;
  VariableId: number;
}

interface NHTSADecodeResponse {
  Count: number;
  Message: string;
  SearchCriteria: string;
  Results: NHTSAResultField[];
}

export class NHTSADecoder implements VINDecoderProvider {
  public readonly name = 'nhtsa' as const;
  public readonly geography = 'united_states' as const;

  private client: AxiosInstance;
  private retryConfig: RetryConfig;

  constructor() {
    this.client = axios.create({
      baseURL: config.externalApis.nhtsa.apiUrl,
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
   * Decode VIN using NHTSA API
   * 
   * @param vin - 17-character VIN
   * @returns Vehicle data or null if not found
   */
  async decode(vin: string): Promise<VehicleData | null> {
    // Validate VIN format
    const validation = validateVIN(vin);
    if (!validation.isValid) {
      loggers.app.warn('Invalid VIN format for NHTSA decode', {
        vin: '[VIN_REDACTED]',
        errors: validation.errors,
      });
      throw new Error(`Invalid VIN format: ${validation.errors.join(', ')}`);
    }

    const normalizedVin = validation.vin!;

    try {
      // Call decode API with retry (no authentication required)
      const response = await withRetry(
        async () => {
          const res = await this.client.get<NHTSADecodeResponse>(
            `/api/vehicles/DecodeVin/${normalizedVin}?format=json`
          );

          return res.data;
        },
        this.retryConfig,
        'NHTSA VIN decode'
      );

      // Parse response
      const vehicleData = this.parseResponse(response);

      if (!vehicleData) {
        loggers.app.info('NHTSA returned no vehicle data', {
          vin: '[VIN_REDACTED]',
        });
        return null;
      }

      loggers.app.info('NHTSA VIN decode successful', {
        vin: '[VIN_REDACTED]',
        make: vehicleData.make,
        model: vehicleData.model,
      });

      return vehicleData;
    } catch (error) {
      loggers.app.error('NHTSA VIN decode failed', error as Error, {
        vin: '[VIN_REDACTED]',
      });
      throw error;
    }
  }

  /**
   * Parse NHTSA response into VehicleData
   * 
   * Response format: Array of { Variable, Value } objects
   * Extract by matching Variable names:
   * - Make: "Make"
   * - Model: "Model"
   * - Year: "Model Year"
   * - Body Type: "Body Class"
   */
  private parseResponse(response: NHTSADecodeResponse): VehicleData | null {
    if (!response.Results || response.Results.length === 0) {
      return null;
    }

    // Helper to find value by variable name
    const findValue = (variable: string): string | undefined => {
      const field = response.Results.find(
        (f) => f.Variable?.toLowerCase() === variable.toLowerCase()
      );
      // Handle null values - NHTSA returns null instead of empty string
      if (!field || field.Value === null || field.Value === undefined) {
        return undefined;
      }
      const trimmed = String(field.Value).trim();
      return trimmed.length > 0 ? trimmed : undefined;
    };

    const make = findValue('Make');
    const model = findValue('Model') || findValue('Series'); // Try Series as fallback

    // Make and model are required
    if (!make || !model) {
      loggers.app.warn('NHTSA response missing required fields (make/model)', {
        hasMake: !!make,
        hasModel: !!model,
      });
      return null;
    }

    const yearStr = findValue('Model Year');
    const year = yearStr ? parseInt(yearStr, 10) : undefined;

    const bodyType = findValue('Body Class');

    // Store all fields as additional metadata
    const additionalMetadata: Record<string, any> = {};
    response.Results.forEach((field) => {
      if (field.Variable && field.Value) {
        additionalMetadata[field.Variable] = field.Value;
      }
    });

    const validYear = year && !isNaN(year) ? year : undefined;

    return {
      make,
      model,
      ...(validYear !== undefined && { year: validYear }),
      ...(bodyType && { bodyType }),
      additionalMetadata,
    };
  }
}
