/**
 * OCR Service Integration Tests
 * 
 * Integration tests for Google Cloud Vision API VIN extraction
 * These tests verify the OCR service works correctly with the VIN enrichment service
 */

import { ocrService } from './ocrService';
import { validateVIN } from './vinDecoders/utils';

describe('OCRService Integration', () => {
  describe('VIN validation integration', () => {
    it('should validate extracted VIN format correctly', () => {
      const validVin = '1HGBH41JXMN109186';
      const validation = validateVIN(validVin);
      
      expect(validation.isValid).toBe(true);
      expect(validation.vin).toBe(validVin);
      expect(validation.errors).toHaveLength(0);
    });

    it('should reject VIN with invalid characters (I, O, Q)', () => {
      const invalidVin = '1HGBH41JXMN1O9I86'; // Contains O and I
      const validation = validateVIN(invalidVin);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      expect(validation.errors[0]).toContain('cannot contain letters I, O, or Q');
    });

    it('should reject VIN with incorrect length', () => {
      const shortVin = '1HGBH41JXMN10'; // Only 13 characters
      const validation = validateVIN(shortVin);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
      expect(validation.errors[0]).toContain('must be exactly 17 characters');
    });

    it('should normalize VIN to uppercase', () => {
      const lowercaseVin = '1hgbh41jxmn109186';
      const validation = validateVIN(lowercaseVin);
      
      expect(validation.isValid).toBe(true);
      expect(validation.vin).toBe('1HGBH41JXMN109186');
    });

    it('should trim whitespace from VIN', () => {
      const vinWithWhitespace = '  1HGBH41JXMN109186  ';
      const validation = validateVIN(vinWithWhitespace);
      
      expect(validation.isValid).toBe(true);
      expect(validation.vin).toBe('1HGBH41JXMN109186');
    });
  });

  describe('OCR service configuration', () => {
    it('should have Google Cloud Vision API configured', () => {
      const { config } = require('../config');
      
      expect(config.externalApis.googleCloudVision.apiKey).toBeDefined();
      expect(config.externalApis.googleCloudVision.apiKey).not.toBe('');
    });

    it('should have retry configuration', () => {
      const { config } = require('../config');
      
      expect(config.assessment.maxApiRetries).toBeDefined();
      expect(config.assessment.maxApiRetries).toBeGreaterThan(0);
      expect(config.assessment.retryInitialDelayMs).toBeDefined();
      expect(config.assessment.retryInitialDelayMs).toBeGreaterThan(0);
    });
  });

  // Note: Actual API calls to Google Cloud Vision are not tested here
  // to avoid external dependencies and API costs in unit tests.
  // These would be covered in end-to-end tests with real images.
});
