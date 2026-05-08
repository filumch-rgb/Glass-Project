/**
 * Lightstone VIN Decoder (South Africa)
 * 
 * Primary vehicle data provider for South African customers
 * 
 * Authentication: Basic Auth → Bearer JWT token
 * Endpoint: POST https://liveapi.lightstoneauto.co.za/api/gateway
 */

import axios, { AxiosInstance } from 'axios';
import { config } from '../../config';
import { loggers } from '../../utils/logger';
import { VINDecoderProvider, VehicleData, RetryConfig } from './types';
import { validateVIN, withRetry, parseYear, safeString } from './utils';

interface LightstoneAuthResponse {
  Token: string;
}

interface LightstoneDecodeRequest {
  ClientPackageId: string;
  VinNumber: string;
}

interface LightstoneFieldValue {
  Description: string;
  Value: string | number;
}

type LightstoneDecodeResponse = LightstoneFieldValue[];

export class LightstoneDecoder implements VINDecoderProvider {
  public readonly name = 'lightstone' as const;
  public readonly geography = 'south_africa' as const;

  private client: AxiosInstance;
  private retryConfig: RetryConfig;
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor() {
    this.client = axios.create({
      baseURL: config.externalApis.lightstone.apiUrl,
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
   * Authenticate with Lightstone API and get Bearer token
   * Uses Basic Auth with username and password
   */
  private async authenticate(): Promise<string> {
    // Return cached token if still valid (with 5-minute buffer)
    const now = Date.now();
    if (this.cachedToken && this.tokenExpiresAt > now + 5 * 60 * 1000) {
      return this.cachedToken;
    }

    const { username, password } = config.externalApis.lightstone;

    try {
      const response = await withRetry(
        async () => {
          const authString = Buffer.from(`${username}:${password}`).toString('base64');
          
          const res = await this.client.post<LightstoneAuthResponse>(
            '/services/token',
            {},
            {
              headers: {
                Authorization: `Basic ${authString}`,
              },
            }
          );

          return res.data;
        },
        this.retryConfig,
        'Lightstone authentication'
      );

      this.cachedToken = response.Token;
      this.tokenExpiresAt = now + (24 * 60 * 60 * 1000); // 24 hours default

      loggers.app.info('Lightstone authentication successful');

      return this.cachedToken;
    } catch (error) {
      loggers.app.error('Lightstone authentication failed', error as Error);
      throw new Error(`Lightstone authentication failed: ${(error as Error).message}`);
    }
  }

  /**
   * Decode VIN using Lightstone API
   * 
   * @param vin - 17-character VIN
   * @returns Vehicle data or null if not found
   */
  async decode(vin: string): Promise<VehicleData | null> {
    // Validate VIN format
    const validation = validateVIN(vin);
    if (!validation.isValid) {
      loggers.app.warn('Invalid VIN format for Lightstone decode', {
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
          const requestBody: LightstoneDecodeRequest = {
            ClientPackageId: config.externalApis.lightstone.clientPackageId,
            VinNumber: normalizedVin,
          };

          const res = await this.client.post<LightstoneDecodeResponse>(
            '/api/gateway',
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
        'Lightstone VIN decode'
      );

      // Parse response
      const vehicleData = this.parseResponse(response);

      if (!vehicleData) {
        loggers.app.info('Lightstone returned no vehicle data', {
          vin: '[VIN_REDACTED]',
        });
        return null;
      }

      loggers.app.info('Lightstone VIN decode successful', {
        vin: '[VIN_REDACTED]',
        make: vehicleData.make,
        model: vehicleData.model,
      });

      return vehicleData;
    } catch (error) {
      loggers.app.error('Lightstone VIN decode failed', error as Error, {
        vin: '[VIN_REDACTED]',
      });
      throw error;
    }
  }

  /**
   * Parse Lightstone response array into VehicleData
   * 
   * Response format: Array of { Description, Value } objects
   * Extract by matching Description values:
   * - Make: "Make"
   * - Model: "Model"
   * - Year: "Warranty Year" or "Introduction Date"
   * - Color: "Colour"
   * - Body Type: "Body shape"
   */
  private parseResponse(response: LightstoneDecodeResponse): VehicleData | null {
    if (!Array.isArray(response) || response.length === 0) {
      return null;
    }

    // Helper to find value by description
    const findValue = (description: string): string | undefined => {
      const field = response.find(
        (f) => f.Description?.toLowerCase() === description.toLowerCase()
      );
      return field ? String(field.Value).trim() : undefined;
    };

    const make = findValue('Make');
    const model = findValue('Model');

    // Make and model are required
    if (!make || !model) {
      loggers.app.warn('Lightstone response missing required fields (make/model)', {
        hasMake: !!make,
        hasModel: !!model,
      });
      return null;
    }

    // Try to extract year from "Warranty Year" or "Introduction Date"
    const warrantyYear = findValue('Warranty Year');
    const introDate = findValue('Introduction Date');
    const year = parseYear(warrantyYear || introDate);

    const color = findValue('Colour');
    const bodyType = findValue('Body shape');

    // Store all fields as additional metadata
    const additionalMetadata: Record<string, any> = {};
    response.forEach((field) => {
      if (field.Description && field.Value !== null && field.Value !== undefined) {
        additionalMetadata[field.Description] = field.Value;
      }
    });

    return {
      make,
      model,
      ...(year !== undefined && { year }),
      ...(bodyType && { bodyType }),
      ...(color && { color }),
      additionalMetadata,
    };
  }
}
