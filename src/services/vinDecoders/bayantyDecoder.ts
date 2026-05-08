/**
 * Bayanaty VIN Decoder (Global)
 * 
 * - Primary vehicle data provider for non-South African customers
 * - Fallback vehicle data provider for South African customers
 * - Primary ADAS provider for ALL customers (global)
 * 
 * Authentication: Form-urlencoded → Bearer JWT token
 * Endpoint: POST https://capi1.bayanaty.com/api/v1/vehicles
 */

import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../config';
import { loggers } from '../../utils/logger';
import { VINDecoderProvider, AdasProvider, VehicleData, AdasData, RetryConfig } from './types';
import { validateVIN, withRetry, parseYear, safeString } from './utils';

interface BayantyAuthResponse {
  AccessToken: string;
  IssuedAt: string;
  ExpiresAt: string;
  ExpiresIn: number;
}

interface BayantyDecodeRequest {
  transactionId: string;
  agentId: string;
  vin: string;
}

interface BayantyPaintInfo {
  Code: string;
  Value: string;
}

interface BayantyVehicleInfo {
  Vin: string;
  MakeName: string;
  ModelName: string;
  BuildDate: string;
  PaintInfo: BayantyPaintInfo;
  HeadlampType: string | null;
  HeadlampValues: string[];
  HasAdasValues: boolean;
  AdasValues: string[];
}

interface BayantyDecodeResponse {
  VehicleInfo: BayantyVehicleInfo;
  TransactionId: string;
  StatusCode: number;
}

export class BayantyDecoder implements VINDecoderProvider, AdasProvider {
  public readonly name = 'bayanaty' as const;
  public readonly geography = 'global' as const;

  private client: AxiosInstance;
  private retryConfig: RetryConfig;
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor() {
    this.client = axios.create({
      baseURL: config.externalApis.bayanaty.apiUrl,
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
   * Authenticate with Bayanaty API and get Bearer token
   * Uses form-urlencoded credentials
   */
  private async authenticate(): Promise<string> {
    // Return cached token if still valid (with 5-minute buffer)
    const now = Date.now();
    if (this.cachedToken && this.tokenExpiresAt > now + 5 * 60 * 1000) {
      return this.cachedToken;
    }

    const { username, password } = config.externalApis.bayanaty;

    try {
      const response = await withRetry(
        async () => {
          const params = new URLSearchParams();
          params.append('Username', username);
          params.append('Password', password);

          const res = await this.client.post<BayantyAuthResponse>(
            '/api/v1/Token',
            params,
            {
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
              },
            }
          );

          return res.data;
        },
        this.retryConfig,
        'Bayanaty authentication'
      );

      this.cachedToken = response.AccessToken;
      this.tokenExpiresAt = now + response.ExpiresIn * 1000;

      loggers.app.info('Bayanaty authentication successful');

      return this.cachedToken;
    } catch (error) {
      loggers.app.error('Bayanaty authentication failed', error as Error);
      throw new Error(`Bayanaty authentication failed: ${(error as Error).message}`);
    }
  }

  /**
   * Decode VIN using Bayanaty API
   * 
   * @param vin - 17-character VIN
   * @returns Vehicle data or null if not found
   */
  async decode(vin: string): Promise<VehicleData | null> {
    // Validate VIN format
    const validation = validateVIN(vin);
    if (!validation.isValid) {
      loggers.app.warn('Invalid VIN format for Bayanaty decode', {
        vin: '[VIN_REDACTED]',
        errors: validation.errors,
      });
      throw new Error(`Invalid VIN format: ${validation.errors.join(', ')}`);
    }

    const normalizedVin = validation.vin!;

    try {
      // Get authentication token
      const token = await this.authenticate();

      // Call decode API with retry
      const response = await withRetry(
        async () => {
          const requestBody: BayantyDecodeRequest = {
            transactionId: uuidv4(),
            agentId: config.externalApis.bayanaty.agentId,
            vin: normalizedVin,
          };

          const res = await this.client.post<BayantyDecodeResponse>(
            '/api/v1/vehicles',
            requestBody,
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }
          );

          return res.data;
        },
        this.retryConfig,
        'Bayanaty VIN decode'
      );

      // Parse response
      const vehicleData = this.parseVehicleData(response);

      if (!vehicleData) {
        loggers.app.info('Bayanaty returned no vehicle data', {
          vin: '[VIN_REDACTED]',
        });
        return null;
      }

      loggers.app.info('Bayanaty VIN decode successful', {
        vin: '[VIN_REDACTED]',
        make: vehicleData.make,
        model: vehicleData.model,
      });

      return vehicleData;
    } catch (error) {
      loggers.app.error('Bayanaty VIN decode failed', error as Error, {
        vin: '[VIN_REDACTED]',
      });
      throw error;
    }
  }

  /**
   * Get ADAS information for a VIN
   * Bayanaty is the primary (and only) ADAS provider for all geographies
   * 
   * @param vin - 17-character VIN
   * @returns ADAS data or null if not found
   */
  async getAdasInfo(vin: string): Promise<AdasData | null> {
    // Validate VIN format
    const validation = validateVIN(vin);
    if (!validation.isValid) {
      loggers.app.warn('Invalid VIN format for Bayanaty ADAS lookup', {
        vin: '[VIN_REDACTED]',
        errors: validation.errors,
      });
      throw new Error(`Invalid VIN format: ${validation.errors.join(', ')}`);
    }

    const normalizedVin = validation.vin!;

    try {
      // Get authentication token
      const token = await this.authenticate();

      // Call decode API with retry (same endpoint returns ADAS data)
      const response = await withRetry(
        async () => {
          const requestBody: BayantyDecodeRequest = {
            transactionId: uuidv4(),
            agentId: config.externalApis.bayanaty.agentId,
            vin: normalizedVin,
          };

          const res = await this.client.post<BayantyDecodeResponse>(
            '/api/v1/vehicles',
            requestBody,
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }
          );

          return res.data;
        },
        this.retryConfig,
        'Bayanaty ADAS lookup'
      );

      // Parse ADAS data
      const adasData = this.parseAdasData(response);

      if (!adasData) {
        loggers.app.info('Bayanaty returned no ADAS data', {
          vin: '[VIN_REDACTED]',
        });
        return null;
      }

      loggers.app.info('Bayanaty ADAS lookup successful', {
        vin: '[VIN_REDACTED]',
        hasAdasValues: adasData.hasAdasValues,
        adasCount: adasData.adasValues.length,
      });

      return adasData;
    } catch (error) {
      loggers.app.error('Bayanaty ADAS lookup failed', error as Error, {
        vin: '[VIN_REDACTED]',
      });
      throw error;
    }
  }

  /**
   * Parse Bayanaty response into VehicleData
   * 
   * Extract:
   * - Make: VehicleInfo.MakeName
   * - Model: VehicleInfo.ModelName
   * - Year: Parse from VehicleInfo.BuildDate (e.g., "2014-06-10" → 2014)
   * - Color: VehicleInfo.PaintInfo.Value
   */
  private parseVehicleData(response: BayantyDecodeResponse): VehicleData | null {
    const vehicleInfo = response?.VehicleInfo;
    if (!vehicleInfo) {
      return null;
    }

    const make = safeString(vehicleInfo, 'MakeName');
    const model = safeString(vehicleInfo, 'ModelName');

    // Make and model are required
    if (!make || !model) {
      loggers.app.warn('Bayanaty response missing required fields (make/model)', {
        hasMake: !!make,
        hasModel: !!model,
      });
      return null;
    }

    const year = parseYear(vehicleInfo.BuildDate);
    const color = safeString(vehicleInfo.PaintInfo, 'Value');

    return {
      make,
      model,
      ...(year !== undefined && { year }),
      ...(color && { color }),
      additionalMetadata: {
        vin: vehicleInfo.Vin,
        buildDate: vehicleInfo.BuildDate,
        paintCode: vehicleInfo.PaintInfo?.Code,
        headlampType: vehicleInfo.HeadlampType,
        headlampValues: vehicleInfo.HeadlampValues || [],
      },
    };
  }

  /**
   * Parse Bayanaty response into AdasData
   * 
   * Extract:
   * - HasAdasValues: VehicleInfo.HasAdasValues (boolean)
   * - AdasValues: VehicleInfo.AdasValues (array)
   */
  private parseAdasData(response: BayantyDecodeResponse): AdasData | null {
    const vehicleInfo = response?.VehicleInfo;
    if (!vehicleInfo) {
      return null;
    }

    return {
      hasAdasValues: vehicleInfo.HasAdasValues === true,
      adasValues: Array.isArray(vehicleInfo.AdasValues) ? vehicleInfo.AdasValues : [],
    };
  }
}
