/**
 * Glass Type Analysis Service Tests
 * 
 * Tests for glass type and brand identification using Gemini Vision API
 */

import { GlassTypeAnalysisService } from './glassTypeAnalysisService';
import { EventService } from './eventService';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock config
jest.mock('../config', () => ({
  config: {
    externalApis: {
      googleCloudVision: {
        apiKey: 'test-api-key',
        serviceAccount: 'test-service-account',
      },
    },
    damageAnalysis: {
      confidenceThreshold: 0.7,
      model: 'gemini-1.5-pro',
      maxRetries: 3,
    },
    assessment: {
      retryInitialDelayMs: 10, // Faster for tests
    },
  },
}));

// Mock logger
jest.mock('../utils/logger', () => ({
  loggers: {
    app: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  },
}));

// Mock EventService
jest.mock('./eventService', () => ({
  EventService: {
    emit: jest.fn(),
  },
  EVENT_TYPES: {
    DAMAGE_ANALYSIS_STARTED: 'damage.analysis_started',
    DAMAGE_ANALYSIS_COMPLETED: 'damage.analysis_completed',
    DAMAGE_ANALYSIS_FAILED: 'damage.analysis_failed',
  },
}));

describe('GlassTypeAnalysisService', () => {
  let service: GlassTypeAnalysisService;
  let mockPost: jest.Mock;
  const testClaimId = 'test-claim-123';
  const testPhotoBuffer = Buffer.from('fake-image-data');

  beforeEach(() => {
    jest.clearAllMocks();
    mockPost = jest.fn();

    // Mock axios.create to return an instance with our mockPost
    mockedAxios.create.mockReturnValue({
      post: mockPost,
    } as any);

    service = new GlassTypeAnalysisService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('analyze', () => {
    it('should successfully analyze OEM glass with vehicle logo', async () => {
      const mockGeminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    glassManufacturer: 'AGC',
                    vehicleManufacturerLogo: 'Toyota',
                    glassType: 'oem',
                    confidence: 0.95,
                    uncertaintyIndicators: [],
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          totalTokenCount: 150,
        },
      };

      mockPost.mockResolvedValue({ data: mockGeminiResponse });

      const result = await service.analyze(testClaimId, testPhotoBuffer);

      expect(result).toMatchObject({
        claimId: testClaimId,
        glassManufacturer: 'AGC',
        vehicleManufacturerLogo: 'Toyota',
        glassType: 'oem',
        confidence: 0.95,
        uncertaintyIndicators: [],
      });
      expect(result.analysedAt).toBeInstanceOf(Date);

      // Verify API call
      expect(mockPost).toHaveBeenCalledWith(
        expect.stringContaining('/v1beta/models/gemini-1.5-pro:generateContent'),
        expect.objectContaining({
          contents: expect.arrayContaining([
            expect.objectContaining({
              parts: expect.any(Array),
            }),
          ]),
          generationConfig: expect.objectContaining({
            temperature: 0.1,
            responseMimeType: 'application/json',
          }),
        })
      );

      // Verify events emitted
      expect(EventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          claimId: testClaimId,
          sourceService: 'glass-type-analysis-service',
          payload: expect.objectContaining({
            analysisType: 'glass_type',
          }),
        })
      );
    });

    it('should successfully analyze Aftermarket glass without vehicle logo', async () => {
      const mockGeminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    glassManufacturer: 'Pilkington',
                    vehicleManufacturerLogo: null,
                    glassType: 'aftermarket',
                    confidence: 0.88,
                    uncertaintyIndicators: [],
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      };

      mockPost.mockResolvedValue({ data: mockGeminiResponse });

      const result = await service.analyze(testClaimId, testPhotoBuffer);

      expect(result).toMatchObject({
        claimId: testClaimId,
        glassManufacturer: 'Pilkington',
        glassType: 'aftermarket',
        confidence: 0.88,
      });
      expect(result.vehicleManufacturerLogo).toBeUndefined();
    });

    it('should handle unknown glass type with uncertainty indicators', async () => {
      const mockGeminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    glassManufacturer: null,
                    vehicleManufacturerLogo: null,
                    glassType: 'unknown',
                    confidence: 0.45,
                    uncertaintyIndicators: ['poor_photo_quality', 'no_visible_branding'],
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      };

      mockPost.mockResolvedValue({ data: mockGeminiResponse });

      const result = await service.analyze(testClaimId, testPhotoBuffer);

      expect(result).toMatchObject({
        claimId: testClaimId,
        glassType: 'unknown',
        confidence: 0.45,
        uncertaintyIndicators: ['poor_photo_quality', 'no_visible_branding'],
      });
    });

    it('should handle multiple glass manufacturers correctly', async () => {
      const glassManufacturers = ['AGC', 'Pilkington', 'Saint-Gobain', 'Fuyao', 'Xinyi'];

      for (const manufacturer of glassManufacturers) {
        const mockGeminiResponse = {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      glassManufacturer: manufacturer,
                      vehicleManufacturerLogo: null,
                      glassType: 'aftermarket',
                      confidence: 0.85,
                      uncertaintyIndicators: [],
                    }),
                  },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        };

        mockPost.mockResolvedValue({ data: mockGeminiResponse });

        const result = await service.analyze(testClaimId, testPhotoBuffer);

        expect(result.glassManufacturer).toBe(manufacturer);
        expect(result.glassType).toBe('aftermarket');
      }
    });

    it('should throw error when photo buffer is empty', async () => {
      const emptyBuffer = Buffer.from('');

      await expect(service.analyze(testClaimId, emptyBuffer)).rejects.toThrow(
        'Logo/silkscreen photo is required for glass type analysis'
      );
    });

    it('should handle Gemini API errors', async () => {
      const mockErrorResponse = {
        error: {
          code: 400,
          message: 'Invalid request',
          status: 'INVALID_ARGUMENT',
        },
      };

      mockPost.mockResolvedValue({ data: mockErrorResponse });

      await expect(service.analyze(testClaimId, testPhotoBuffer)).rejects.toThrow(
        'Gemini API error (400): Invalid request'
      );

      // Verify failure event emitted
      expect(EventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          claimId: testClaimId,
          sourceService: 'glass-type-analysis-service',
          payload: expect.objectContaining({
            analysisType: 'glass_type',
            error: expect.any(String),
          }),
        })
      );
    });

    it('should handle invalid JSON response', async () => {
      const mockGeminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: 'This is not valid JSON',
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      };

      mockPost.mockResolvedValue({ data: mockGeminiResponse });

      await expect(service.analyze(testClaimId, testPhotoBuffer)).rejects.toThrow(
        'Failed to parse glass type analysis response as JSON'
      );
    });

    it('should handle missing required fields in response', async () => {
      const mockGeminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    glassManufacturer: 'AGC',
                    // Missing glassType
                    confidence: 0.9,
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      };

      mockPost.mockResolvedValue({ data: mockGeminiResponse });

      await expect(service.analyze(testClaimId, testPhotoBuffer)).rejects.toThrow(
        'Invalid glass type analysis response: missing glassType'
      );
    });

    it('should handle invalid glassType value', async () => {
      const mockGeminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    glassManufacturer: 'AGC',
                    glassType: 'invalid_type',
                    confidence: 0.9,
                    uncertaintyIndicators: [],
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      };

      mockPost.mockResolvedValue({ data: mockGeminiResponse });

      await expect(service.analyze(testClaimId, testPhotoBuffer)).rejects.toThrow(
        'Invalid glassType value: invalid_type'
      );
    });

    it('should include photo in base64 format in API request', async () => {
      const mockGeminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    glassManufacturer: 'Pilkington',
                    vehicleManufacturerLogo: null,
                    glassType: 'aftermarket',
                    confidence: 0.85,
                    uncertaintyIndicators: [],
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      };

      mockPost.mockResolvedValue({ data: mockGeminiResponse });

      await service.analyze(testClaimId, testPhotoBuffer);

      // Verify the request includes base64 encoded photo
      const callArgs = mockPost.mock.calls[0];
      const requestBody = callArgs[1];

      expect(requestBody.contents[0].parts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            inline_data: expect.objectContaining({
              mime_type: 'image/jpeg',
              data: testPhotoBuffer.toString('base64'),
            }),
          }),
        ])
      );
    });

    it('should emit success event with correct payload', async () => {
      const mockGeminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    glassManufacturer: 'Saint-Gobain',
                    vehicleManufacturerLogo: 'BMW',
                    glassType: 'oem',
                    confidence: 0.92,
                    uncertaintyIndicators: [],
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      };

      mockPost.mockResolvedValue({ data: mockGeminiResponse });

      await service.analyze(testClaimId, testPhotoBuffer);

      // Verify success event
      expect(EventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          claimId: testClaimId,
          sourceService: 'glass-type-analysis-service',
          actorType: 'system',
          payload: expect.objectContaining({
            analysisType: 'glass_type',
            glassType: 'oem',
            glassManufacturer: 'Saint-Gobain',
            vehicleManufacturerLogo: 'BMW',
            confidence: 0.92,
            hasUncertainty: false,
          }),
        })
      );
    });
  });

  describe('OEM vs Aftermarket Classification', () => {
    it('should classify as OEM when vehicle logo is present with glass manufacturer', async () => {
      const testCases = [
        { vehicle: 'Toyota', glass: 'AGC' },
        { vehicle: 'Honda', glass: 'Pilkington' },
        { vehicle: 'BMW', glass: 'Saint-Gobain' },
        { vehicle: 'Mercedes-Benz', glass: 'Fuyao' },
      ];

      for (const testCase of testCases) {
        const mockGeminiResponse = {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      glassManufacturer: testCase.glass,
                      vehicleManufacturerLogo: testCase.vehicle,
                      glassType: 'oem',
                      confidence: 0.9,
                      uncertaintyIndicators: [],
                    }),
                  },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        };

        mockPost.mockResolvedValue({ data: mockGeminiResponse });

        const result = await service.analyze(testClaimId, testPhotoBuffer);

        expect(result.glassType).toBe('oem');
        expect(result.vehicleManufacturerLogo).toBe(testCase.vehicle);
        expect(result.glassManufacturer).toBe(testCase.glass);
      }
    });

    it('should classify as Aftermarket when only glass manufacturer is present', async () => {
      const glassManufacturers = ['AGC', 'Pilkington', 'Saint-Gobain', 'Fuyao', 'Xinyi'];

      for (const manufacturer of glassManufacturers) {
        const mockGeminiResponse = {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      glassManufacturer: manufacturer,
                      vehicleManufacturerLogo: null,
                      glassType: 'aftermarket',
                      confidence: 0.85,
                      uncertaintyIndicators: [],
                    }),
                  },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        };

        mockPost.mockResolvedValue({ data: mockGeminiResponse });

        const result = await service.analyze(testClaimId, testPhotoBuffer);

        expect(result.glassType).toBe('aftermarket');
        expect(result.glassManufacturer).toBe(manufacturer);
        expect(result.vehicleManufacturerLogo).toBeUndefined();
      }
    });
  });

  describe('Error Handling and Retry Logic', () => {
    it('should retry on network errors and succeed', async () => {
      const mockGeminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    glassManufacturer: 'AGC',
                    vehicleManufacturerLogo: 'Honda',
                    glassType: 'oem',
                    confidence: 0.9,
                    uncertaintyIndicators: [],
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      };

      mockPost
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ data: mockGeminiResponse });

      const result = await service.analyze(testClaimId, testPhotoBuffer);

      expect(result.glassType).toBe('oem');
      expect(mockPost).toHaveBeenCalledTimes(3); // 2 failures + 1 success
    });

    it('should fail after max retries', async () => {
      mockPost.mockRejectedValue(new Error('Network error'));

      await expect(service.analyze(testClaimId, testPhotoBuffer)).rejects.toThrow();

      // Should have tried maxRetries + 1 times (initial + retries)
      expect(mockPost).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });
  });

  describe('Confidence Scoring', () => {
    it('should handle low confidence results', async () => {
      const mockGeminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    glassManufacturer: 'AGC',
                    vehicleManufacturerLogo: 'Toyota',
                    glassType: 'oem',
                    confidence: 0.65, // Below 0.7 threshold
                    uncertaintyIndicators: ['lighting_issues'],
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      };

      mockPost.mockResolvedValue({ data: mockGeminiResponse });

      const result = await service.analyze(testClaimId, testPhotoBuffer);

      expect(result.confidence).toBe(0.65);
      expect(result.uncertaintyIndicators).toContain('lighting_issues');
    });

    it('should handle high confidence results', async () => {
      const mockGeminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    glassManufacturer: 'Pilkington',
                    vehicleManufacturerLogo: null,
                    glassType: 'aftermarket',
                    confidence: 0.98,
                    uncertaintyIndicators: [],
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      };

      mockPost.mockResolvedValue({ data: mockGeminiResponse });

      const result = await service.analyze(testClaimId, testPhotoBuffer);

      expect(result.confidence).toBe(0.98);
      expect(result.uncertaintyIndicators).toHaveLength(0);
    });
  });
});
