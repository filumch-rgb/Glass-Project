/**
 * VIN Decoder Provider Types
 * 
 * Defines the common interface and types for all VIN decoder providers
 * (Lightstone, Bayanaty, NHTSA)
 */

export interface VehicleData {
  make: string;
  model: string;
  year?: number;
  bodyType?: string;
  color?: string;
  additionalMetadata?: Record<string, any>;
}

export interface AdasData {
  hasAdasValues: boolean;
  adasValues: string[];
}

export type VINDecoderProviderName = 'lightstone' | 'bayanaty' | 'nhtsa';

export type Geography = 'south_africa' | 'global' | 'united_states' | 'international';

/**
 * VIN Decoder Provider Interface
 * All VIN decoder implementations must implement this interface
 */
export interface VINDecoderProvider {
  name: VINDecoderProviderName;
  geography: Geography;
  
  /**
   * Decode a VIN and return vehicle data
   * @param vin - 17-character VIN
   * @returns Vehicle data or null if not found
   * @throws Error if API call fails after retries
   */
  decode(vin: string): Promise<VehicleData | null>;
}

/**
 * ADAS Provider Interface
 * Bayanaty is the only provider that supports ADAS lookup
 */
export interface AdasProvider {
  /**
   * Get ADAS information for a VIN
   * @param vin - 17-character VIN
   * @returns ADAS data or null if not found
   * @throws Error if API call fails after retries
   */
  getAdasInfo(vin: string): Promise<AdasData | null>;
}

/**
 * VIN validation result
 */
export interface VINValidationResult {
  isValid: boolean;
  vin?: string;
  errors: string[];
}

/**
 * Retry configuration for API calls
 */
export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  // Exponential backoff: delays will be initialDelayMs, initialDelayMs*2, initialDelayMs*4, etc.
}
