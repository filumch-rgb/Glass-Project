/**
 * VIN Decoder Utilities
 * 
 * Common utilities for VIN validation and API retry logic
 */

import { loggers } from '../../utils/logger';
import { VINValidationResult, RetryConfig } from './types';

/**
 * Validate VIN format
 * - Must be exactly 17 characters
 * - Cannot contain I, O, or Q (to avoid confusion with 1, 0)
 * - Must be alphanumeric
 * 
 * @param vin - VIN to validate
 * @returns Validation result with normalized VIN
 */
export function validateVIN(vin: string): VINValidationResult {
  const errors: string[] = [];
  
  if (!vin) {
    errors.push('VIN is required');
    return { isValid: false, errors };
  }

  // Normalize: trim and uppercase
  const normalizedVin = vin.trim().toUpperCase();

  // Check length
  if (normalizedVin.length !== 17) {
    errors.push(`VIN must be exactly 17 characters (got ${normalizedVin.length})`);
  }

  // Check for invalid characters (I, O, Q)
  if (/[IOQ]/.test(normalizedVin)) {
    errors.push('VIN cannot contain letters I, O, or Q');
  }

  // Check alphanumeric
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(normalizedVin)) {
    errors.push('VIN must contain only alphanumeric characters (excluding I, O, Q)');
  }

  return {
    isValid: errors.length === 0,
    vin: normalizedVin,
    errors,
  };
}

/**
 * Execute an async function with exponential backoff retry
 * 
 * @param fn - Async function to execute
 * @param config - Retry configuration
 * @param context - Context for logging (e.g., "Lightstone API")
 * @returns Result of the function
 * @throws Error if all retries are exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  context: string
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const result = await fn();
      
      if (attempt > 0) {
        loggers.app.info(`${context} succeeded after ${attempt} retries`);
      }
      
      return result;
    } catch (error) {
      lastError = error as Error;
      
      if (attempt < config.maxRetries) {
        const delayMs = config.initialDelayMs * Math.pow(2, attempt);
        loggers.app.warn(
          `${context} failed (attempt ${attempt + 1}/${config.maxRetries + 1}), retrying in ${delayMs}ms`,
          { error: lastError.message }
        );
        await sleep(delayMs);
      }
    }
  }

  loggers.app.error(
    `${context} failed after ${config.maxRetries + 1} attempts`,
    lastError!
  );
  throw lastError!;
}

/**
 * Sleep for a specified duration
 * @param ms - Milliseconds to sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse year from various date formats
 * Handles: "2014", "2014-06-10", "2014/06/10", etc.
 * 
 * @param dateStr - Date string to parse
 * @returns Year as number or undefined if parsing fails
 */
export function parseYear(dateStr: string | undefined): number | undefined {
  if (!dateStr) return undefined;

  // Try to extract 4-digit year
  const yearMatch = dateStr.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) {
    return parseInt(yearMatch[0], 10);
  }

  // Try parsing as full date
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date.getFullYear();
  }

  return undefined;
}

/**
 * Safely extract string value from object
 * @param obj - Object to extract from
 * @param key - Key to extract
 * @returns String value or undefined
 */
export function safeString(obj: any, key: string): string | undefined {
  const value = obj?.[key];
  if (value === null || value === undefined) return undefined;
  return String(value).trim() || undefined;
}

/**
 * Safely extract number value from object
 * @param obj - Object to extract from
 * @param key - Key to extract
 * @returns Number value or undefined
 */
export function safeNumber(obj: any, key: string): number | undefined {
  const value = obj?.[key];
  if (value === null || value === undefined) return undefined;
  const num = Number(value);
  return isNaN(num) ? undefined : num;
}
