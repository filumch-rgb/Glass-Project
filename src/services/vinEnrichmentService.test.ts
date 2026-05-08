/**
 * VIN Enrichment Service Integration Tests
 * 
 * Tests Task 7.4: Integration test - VIN enrichment with geography routing
 * 
 * **Validates: Requirements 6.1-6.40**
 */

import { VINEnrichmentService } from './vinEnrichmentService';
import { EventService, EVENT_TYPES } from './eventService';
import { ocrService } from './ocrService';
import { LightstoneDecoder } from './vinDecoders/lightstoneDecoder';
import { BayantyDecoder } from './vinDecoders/bayantyDecoder';
import { NHTSADecoder } from './vinDecoders/nhtsaDecoder';
import { VehicleData, AdasData } from './vinDecoders/types';

// Mock all external dependencies
jest.mock('./eventService');
jest.mock('./ocrService');
jest.mock('./vinDecoders/lightstoneDecoder');
jest.mock('./vinDecoders/bayantyDecoder');
jest.mock('./vinDecoders/nhtsaDecoder');

describe('VINEnrichmentService - Integration Tests (Task 7.4)', () => {
  let service: VINEnrichmentService;
  let mockEventEmit: jest.SpyInstance;
  let mockOcrExtractVIN: jest.SpyInstance;
  let mockLightstoneDecode: jest.Mock;
  let mockBayantyDecode: jest.Mock;
  let mockBayantyGetAdasInfo: jest.Mock;
  let mockNhtsaDecode: jest.Mock;

  const validVin = 'MALAN51BLEM575556';
  const testClaimId = 'test-claim-123';

  const mockVehicleData: VehicleData = {
    make: 'HYUNDAI',
    model: 'I10',
    year: 2014,
    color: 'PURE WHITE',
    bodyType: 'Hatch (5-dr)',
  };

  const mockAdasData: AdasData = {
    hasAdasValues: false,
    adasValues: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mocks
    mockEventEmit = jest.spyOn(EventService, 'emit').mockResolvedValue('event-id');
    mockOcrExtractVIN = jest.spyOn(ocrService, 'extractVIN');
    
    // Mock decoder instances
    mockLightstoneDecode = jest.fn();
    mockBayantyDecode = jest.fn();
    mockBayantyGetAdasInfo = jest.fn();
    mockNhtsaDecode = jest.fn();

    (LightstoneDecoder as jest.MockedClass<typeof LightstoneDecoder>).mockImplementation(() => ({
      name: 'lightstone',
      geography: 'south_africa',
      decode: mockLightstoneDecode,
    } as any));

    (BayantyDecoder as jest.MockedClass<typeof BayantyDecoder>).mockImplementation(() => ({
      name: 'bayanaty',
      geography: 'global',
      decode: mockBayantyDecode,
      getAdasInfo: mockBayantyGetAdasInfo,
    } as any));

    (NHTSADecoder as jest.MockedClass<typeof NHTSADecoder>).mockImplementation(() => ({
      name: 'nhtsa',
      geography: 'united_states',
      decode: mockNhtsaDecode,
    } as any));

    service = new VINEnrichmentService();
  });

  describe('Geography-Based Routing', () => {
    describe('South Africa: Lightstone → Bayanaty fallback', () => {
      it('should use Lightstone as primary for South Africa', async () => {
        mockLightstoneDecode.mockResolvedValue(mockVehicleData);
        mockBayantyGetAdasInfo.mockResolvedValue(mockAdasData);

        const result = await service.enrich({
          claimId: testClaimId,
          insurerProvidedVin: validVin,
          geography: 'south_africa',
        });

        expect(mockLightstoneDecode).toHaveBeenCalledWith(validVin);
        expect(mockBayantyDecode).not.toHaveBeenCalled();
        expect(result.decoderUsed).toBe('lightstone');
        expect(result.vehicleData).toEqual(mockVehicleData);
      });

      it('should fallback to Bayanaty when Lightstone fails', async () => {
        mockLightstoneDecode.mockRejectedValue(new Error('Lightstone API error'));
        mockBayantyDecode.mockResolvedValue(mockVehicleData);
        mockBayantyGetAdasInfo.mockResolvedValue(mockAdasData);

        const result = await service.enrich({
          claimId: testClaimId,
          insurerProvidedVin: validVin,
          geography: 'south_africa',
        });

        expect(mockLightstoneDecode).toHaveBeenCalledWith(validVin);
        expect(mockBayantyDecode).toHaveBeenCalledWith(validVin);
        expect(result.decoderUsed).toBe('lightstone+bayanaty');
        expect(result.vehicleData).toEqual(mockVehicleData);
      });
    });

    describe('Non-South Africa: Bayanaty → NHTSA fallback', () => {
      it('should use Bayanaty as primary for non-SA geographies', async () => {
        mockBayantyDecode.mockResolvedValue(mockVehicleData);
        mockBayantyGetAdasInfo.mockResolvedValue(mockAdasData);

        const result = await service.enrich({
          claimId: testClaimId,
          insurerProvidedVin: validVin,
          geography: 'global',
        });

        expect(mockBayantyDecode).toHaveBeenCalledWith(validVin);
        expect(mockNhtsaDecode).not.toHaveBeenCalled();
        expect(result.decoderUsed).toBe('bayanaty');
        expect(result.vehicleData).toEqual(mockVehicleData);
      });
    });
  });

  describe('VIN Result State Derivation', () => {
    it('should return "validated" when insurer VIN and OCR VIN match', async () => {
      mockOcrExtractVIN.mockResolvedValue({
        vin: validVin,
        confidence: 0.95,
        rawText: validVin,
      });
      mockLightstoneDecode.mockResolvedValue(mockVehicleData);
      mockBayantyGetAdasInfo.mockResolvedValue(mockAdasData);

      const result = await service.enrich({
        claimId: testClaimId,
        insurerProvidedVin: validVin,
        vinCutoutPhotoBuffer: Buffer.from('fake-image'),
        geography: 'south_africa',
      });

      expect(result.vinResultState).toBe('validated');
      expect(result.insurerProvidedVin).toBe(validVin);
      expect(result.ocrExtractedVin).toBe(validVin);
      expect(result.bestValidatedVin).toBe(validVin);
      expect(result.vinMismatchFlag).toBe(false);
      expect(result.ocrConfidenceScore).toBe(0.95);
    });

    it('should return "mismatch" when insurer VIN and OCR VIN differ', async () => {
      const differentVin = 'WBADT43452G217969';
      mockOcrExtractVIN.mockResolvedValue({
        vin: differentVin,
        confidence: 0.92,
        rawText: differentVin,
      });
      mockLightstoneDecode.mockResolvedValue(mockVehicleData);
      mockBayantyGetAdasInfo.mockResolvedValue(mockAdasData);

      const result = await service.enrich({
        claimId: testClaimId,
        insurerProvidedVin: validVin,
        vinCutoutPhotoBuffer: Buffer.from('fake-image'),
        geography: 'south_africa',
      });

      expect(result.vinResultState).toBe('mismatch');
      expect(result.insurerProvidedVin).toBe(validVin);
      expect(result.ocrExtractedVin).toBe(differentVin);
      expect(result.bestValidatedVin).toBe(validVin);
      expect(result.vinMismatchFlag).toBe(true);
    });

    it('should return "unavailable" when neither insurer VIN nor OCR VIN available', async () => {
      const result = await service.enrich({
        claimId: testClaimId,
        geography: 'global',
      });

      expect(result.vinResultState).toBe('unavailable');
      expect(result.insurerProvidedVin).toBeUndefined();
      expect(result.ocrExtractedVin).toBeUndefined();
      expect(result.bestValidatedVin).toBeUndefined();
      expect(result.vinMismatchFlag).toBe(false);
      expect(result.vehicleData).toBeUndefined();
      expect(result.adasStatus).toBe('unknown');
    });
  });

  describe('ADAS Lookup', () => {
    it('should return "yes" when vehicle has ADAS', async () => {
      const adasVehicle: AdasData = {
        hasAdasValues: true,
        adasValues: ['Lane Departure Warning', 'Adaptive Cruise Control'],
      };
      mockLightstoneDecode.mockResolvedValue(mockVehicleData);
      mockBayantyGetAdasInfo.mockResolvedValue(adasVehicle);

      const result = await service.enrich({
        claimId: testClaimId,
        insurerProvidedVin: validVin,
        geography: 'south_africa',
      });

      expect(result.adasStatus).toBe('yes');
      expect(result.adasFeatures).toEqual(['Lane Departure Warning', 'Adaptive Cruise Control']);
      expect(mockBayantyGetAdasInfo).toHaveBeenCalledWith(validVin);
    });

    it('should return "no" when vehicle has no ADAS', async () => {
      mockLightstoneDecode.mockResolvedValue(mockVehicleData);
      mockBayantyGetAdasInfo.mockResolvedValue(mockAdasData);

      const result = await service.enrich({
        claimId: testClaimId,
        insurerProvidedVin: validVin,
        geography: 'south_africa',
      });

      expect(result.adasStatus).toBe('no');
      expect(result.adasFeatures).toBeUndefined();
    });
  });

  describe('Event Emission', () => {
    it('should emit vin.enrichment_started event', async () => {
      mockLightstoneDecode.mockResolvedValue(mockVehicleData);
      mockBayantyGetAdasInfo.mockResolvedValue(mockAdasData);

      await service.enrich({
        claimId: testClaimId,
        insurerProvidedVin: validVin,
        geography: 'south_africa',
      });

      expect(mockEventEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: EVENT_TYPES.VIN_ENRICHMENT_STARTED,
          claimId: testClaimId,
          sourceService: 'vin-enrichment-service',
          actorType: 'system',
          payload: { geography: 'south_africa' },
        })
      );
    });

    it('should emit vin.enrichment_completed event on success', async () => {
      mockLightstoneDecode.mockResolvedValue(mockVehicleData);
      mockBayantyGetAdasInfo.mockResolvedValue(mockAdasData);

      await service.enrich({
        claimId: testClaimId,
        insurerProvidedVin: validVin,
        geography: 'south_africa',
      });

      expect(mockEventEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: EVENT_TYPES.VIN_ENRICHMENT_COMPLETED,
          claimId: testClaimId,
          sourceService: 'vin-enrichment-service',
          actorType: 'system',
          payload: expect.objectContaining({
            vinResultState: 'insurer_only',
            decoderUsed: 'lightstone',
            adasStatus: 'no',
            hasVehicleData: true,
          }),
        })
      );
    });
  });

  describe('Complete Enrichment Flow', () => {
    it('should complete full enrichment with all data sources', async () => {
      mockOcrExtractVIN.mockResolvedValue({
        vin: validVin,
        confidence: 0.93,
        rawText: validVin,
      });
      mockLightstoneDecode.mockResolvedValue(mockVehicleData);
      mockBayantyGetAdasInfo.mockResolvedValue({
        hasAdasValues: true,
        adasValues: ['Forward Collision Warning'],
      });

      const result = await service.enrich({
        claimId: testClaimId,
        insurerProvidedVin: validVin,
        vinCutoutPhotoBuffer: Buffer.from('fake-image'),
        geography: 'south_africa',
      });

      expect(result).toMatchObject({
        claimId: testClaimId,
        vinResultState: 'validated',
        insurerProvidedVin: validVin,
        ocrExtractedVin: validVin,
        ocrConfidenceScore: 0.93,
        bestValidatedVin: validVin,
        vinMismatchFlag: false,
        decoderUsed: 'lightstone',
        vehicleData: mockVehicleData,
        adasStatus: 'yes',
        adasFeatures: ['Forward Collision Warning'],
      });
      expect(result.enrichedAt).toBeInstanceOf(Date);
    });
  });
});
