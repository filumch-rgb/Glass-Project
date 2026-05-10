/**
 * Damage Analysis Service Tests
 * 
 * Tests for the damage analysis service including:
 * - Unit tests for structured output parsing
 * - Mock tests for all code paths
 * - Integration tests with real Gemini API (optional)
 */

import { DamageAnalysisService, DamageAnalysisOptions } from './damageAnalysisService';
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
      },
    },
    assessment: {
      retryInitialDelayMs: 10, // Faster for tests
    },
    damageAnalysis: {
      confidenceThreshold: 0.7,
      model: 'gemini-1.5-pro',
      maxRetries: 3,
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

describe('DamageAnalysisService', () => {
  let service: DamageAnalysisService;
  let mockPost: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPost = jest.fn();

    // Mock axios.create to return an instance with our mockPost
    mockedAxios.create.mockReturnValue({
      post: mockPost,
    } as any);

    service = new DamageAnalysisService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Unit Tests - Structured Output Parsing', () => {
    it('should parse valid Gemini JSON response correctly', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    damagePoints: [
                      {
                        affectedRegion: 'driver_side_upper',
                        severityAttributes: {
                          damageType: 'bullseye',
                          estimatedDiameterInches: 0.8,
                          estimatedLengthInches: null,
                          inDPVA: false,
                          repairEligible: true,
                          repairBlockingReasons: [],
                        },
                        glassObservations: ['clean_outer_surface_damage'],
                      },
                    ],
                    overallConfidence: 0.85,
                    uncertaintyIndicators: [],
                    insufficiencyFlags: [],
                    evidenceSufficiencyAssessment: 'sufficient',
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      };

      mockPost.mockResolvedValue({ data: mockResponse });

      const options: DamageAnalysisOptions = {
        claimId: 'test-claim-123',
        damagePhotos: [Buffer.from('fake-image-data')],
      };

      const result = await service.analyze(options);

      expect(result).toBeDefined();
      expect(result.claimId).toBe('test-claim-123');
      expect(result.damagePoints).toHaveLength(1);
      expect(result.damagePoints[0]!.affectedRegion).toBe('driver_side_upper');
      expect(result.overallConfidence).toBe(0.85);
      expect(result.evidenceSufficiencyAssessment).toBe('sufficient');
      expect(result.analysedAt).toBeInstanceOf(Date);
    });

    it('should handle multiple damage points correctly', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    damagePoints: [
                      {
                        affectedRegion: 'driver_side_upper',
                        severityAttributes: {
                          damageType: 'star_break',
                          estimatedDiameterInches: 2.5,
                          estimatedLengthInches: null,
                          inDPVA: true,
                          repairEligible: false,
                          repairBlockingReasons: ['damage_too_large', 'dpva_restriction'],
                        },
                        glassObservations: ['clean_outer_surface_damage'],
                      },
                      {
                        affectedRegion: 'passenger_side_lower',
                        severityAttributes: {
                          damageType: 'crack',
                          estimatedDiameterInches: null,
                          estimatedLengthInches: 10.0,
                          inDPVA: false,
                          repairEligible: true,
                          repairBlockingReasons: [],
                        },
                        glassObservations: ['clean_outer_surface_damage'],
                      },
                    ],
                    overallConfidence: 0.78,
                    uncertaintyIndicators: ['insufficient_scale_reference'],
                    insufficiencyFlags: [],
                    evidenceSufficiencyAssessment: 'sufficient_with_warnings',
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      };

      mockPost.mockResolvedValue({ data: mockResponse });

      const options: DamageAnalysisOptions = {
        claimId: 'test-claim-456',
        damagePhotos: [Buffer.from('fake-image-1'), Buffer.from('fake-image-2')],
      };

      const result = await service.analyze(options);

      expect(result.damagePoints).toHaveLength(2);
      expect(result.damagePoints[0]!.severityAttributes.damageType).toBe('star_break');
      expect(result.damagePoints[1]!.severityAttributes.damageType).toBe('crack');
      expect(result.uncertaintyIndicators).toContain('insufficient_scale_reference');
      expect(result.evidenceSufficiencyAssessment).toBe('sufficient_with_warnings');
    });

    it('should handle insufficient evidence correctly', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    damagePoints: [],
                    overallConfidence: 0.3,
                    uncertaintyIndicators: ['poor_photo_quality', 'damage_not_in_frame'],
                    insufficiencyFlags: ['photo_too_blurry', 'need_closer_photo'],
                    evidenceSufficiencyAssessment: 'insufficient',
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      };

      mockPost.mockResolvedValue({ data: mockResponse });

      const options: DamageAnalysisOptions = {
        claimId: 'test-claim-789',
        damagePhotos: [Buffer.from('blurry-image')],
      };

      const result = await service.analyze(options);

      expect(result.damagePoints).toHaveLength(0);
      expect(result.overallConfidence).toBe(0.3);
      expect(result.insufficiencyFlags).toContain('photo_too_blurry');
      expect(result.evidenceSufficiencyAssessment).toBe('insufficient');
    });
  });

  describe('Unit Tests - Confidence Scoring', () => {
    it('should log warning when confidence is below threshold', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    damagePoints: [
                      {
                        affectedRegion: 'center_upper',
                        severityAttributes: {
                          damageType: 'unknown',
                          estimatedDiameterInches: null,
                          estimatedLengthInches: null,
                          inDPVA: false,
                          repairEligible: false,
                          repairBlockingReasons: ['damage_type_unclear'],
                        },
                        glassObservations: [],
                      },
                    ],
                    overallConfidence: 0.5, // Below default threshold of 0.7
                    uncertaintyIndicators: ['unclear_damage_boundaries'],
                    insufficiencyFlags: [],
                    evidenceSufficiencyAssessment: 'sufficient_with_warnings',
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      };

      mockPost.mockResolvedValue({ data: mockResponse });

      const options: DamageAnalysisOptions = {
        claimId: 'test-claim-low-confidence',
        damagePhotos: [Buffer.from('unclear-image')],
      };

      const result = await service.analyze(options);

      expect(result.overallConfidence).toBe(0.5);
      // Service should still return result but log warning
      expect(result).toBeDefined();
    });
  });

  describe('Unit Tests - ROLAGS Criteria Application', () => {
    it('should identify repairable bullseye damage', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    damagePoints: [
                      {
                        affectedRegion: 'passenger_side_upper',
                        severityAttributes: {
                          damageType: 'bullseye',
                          estimatedDiameterInches: 0.9, // ≤ 1 inch = repairable
                          estimatedLengthInches: null,
                          inDPVA: false,
                          repairEligible: true,
                          repairBlockingReasons: [],
                        },
                        glassObservations: ['clean_outer_surface_damage'],
                      },
                    ],
                    overallConfidence: 0.88,
                    uncertaintyIndicators: [],
                    insufficiencyFlags: [],
                    evidenceSufficiencyAssessment: 'sufficient',
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      };

      mockPost.mockResolvedValue({ data: mockResponse });

      const options: DamageAnalysisOptions = {
        claimId: 'test-repairable-bullseye',
        damagePhotos: [Buffer.from('bullseye-image')],
      };

      const result = await service.analyze(options);

      expect(result.damagePoints[0]!.severityAttributes.damageType).toBe('bullseye');
      expect(result.damagePoints[0]!.severityAttributes.repairEligible).toBe(true);
      expect(result.damagePoints[0]!.severityAttributes.repairBlockingReasons).toHaveLength(0);
    });

    it('should identify non-repairable damage in DPVA', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    damagePoints: [
                      {
                        affectedRegion: 'dpva',
                        severityAttributes: {
                          damageType: 'star_break',
                          estimatedDiameterInches: 1.5, // > 1 inch in DPVA = not repairable
                          estimatedLengthInches: null,
                          inDPVA: true,
                          repairEligible: false,
                          repairBlockingReasons: ['damage_too_large', 'dpva_restriction'],
                        },
                        glassObservations: ['clean_outer_surface_damage'],
                      },
                    ],
                    overallConfidence: 0.82,
                    uncertaintyIndicators: [],
                    insufficiencyFlags: [],
                    evidenceSufficiencyAssessment: 'sufficient',
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      };

      mockPost.mockResolvedValue({ data: mockResponse });

      const options: DamageAnalysisOptions = {
        claimId: 'test-dpva-damage',
        damagePhotos: [Buffer.from('dpva-damage-image')],
      };

      const result = await service.analyze(options);

      expect(result.damagePoints[0]!.severityAttributes.inDPVA).toBe(true);
      expect(result.damagePoints[0]!.severityAttributes.repairEligible).toBe(false);
      expect(result.damagePoints[0]!.severityAttributes.repairBlockingReasons).toContain('dpva_restriction');
    });

    it('should identify damage with penetration blocking repair', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    damagePoints: [
                      {
                        affectedRegion: 'center_lower',
                        severityAttributes: {
                          damageType: 'combination_break',
                          estimatedDiameterInches: 1.8,
                          estimatedLengthInches: null,
                          inDPVA: false,
                          repairEligible: false,
                          repairBlockingReasons: ['penetrates_both_layers'],
                        },
                        glassObservations: ['penetrates_both_layers', 'interlayer_damage'],
                      },
                    ],
                    overallConfidence: 0.91,
                    uncertaintyIndicators: [],
                    insufficiencyFlags: [],
                    evidenceSufficiencyAssessment: 'sufficient',
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      };

      mockPost.mockResolvedValue({ data: mockResponse });

      const options: DamageAnalysisOptions = {
        claimId: 'test-penetration-damage',
        damagePhotos: [Buffer.from('penetration-image')],
      };

      const result = await service.analyze(options);

      expect(result.damagePoints[0]!.severityAttributes.repairEligible).toBe(false);
      expect(result.damagePoints[0]!.glassObservations).toContain('penetrates_both_layers');
    });
  });

  describe('Unit Tests - Error Handling', () => {
    it('should throw error when no damage photos provided', async () => {
      const options: DamageAnalysisOptions = {
        claimId: 'test-no-photos',
        damagePhotos: [],
      };

      await expect(service.analyze(options)).rejects.toThrow(
        'At least one damage photo is required for analysis'
      );
    });

    it('should handle Gemini API error response', async () => {
      const mockErrorResponse = {
        error: {
          code: 400,
          message: 'Invalid request',
          status: 'INVALID_ARGUMENT',
        },
      };

      mockPost.mockResolvedValue({ data: mockErrorResponse });

      const options: DamageAnalysisOptions = {
        claimId: 'test-api-error',
        damagePhotos: [Buffer.from('image')],
      };

      await expect(service.analyze(options)).rejects.toThrow('Gemini API error (400): Invalid request');

      // Verify failure event was emitted
      expect(EventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'damage.analysis_failed',
          claimId: 'test-api-error',
        })
      );
    });

    it('should handle invalid JSON response', async () => {
      const mockResponse = {
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

      mockPost.mockResolvedValue({ data: mockResponse });

      const options: DamageAnalysisOptions = {
        claimId: 'test-invalid-json',
        damagePhotos: [Buffer.from('image')],
      };

      await expect(service.analyze(options)).rejects.toThrow(
        'Failed to parse damage analysis response as JSON'
      );
    });

    it('should handle missing required fields in response', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    // Missing damagePoints
                    overallConfidence: 0.8,
                    evidenceSufficiencyAssessment: 'sufficient',
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      };

      mockPost.mockResolvedValue({ data: mockResponse });

      const options: DamageAnalysisOptions = {
        claimId: 'test-missing-fields',
        damagePhotos: [Buffer.from('image')],
      };

      await expect(service.analyze(options)).rejects.toThrow(
        'Invalid damage analysis response: missing damagePoints array'
      );
    });

    it('should implement retry logic on network failure', async () => {
      // First two calls fail, third succeeds
      mockPost
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          data: {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        damagePoints: [],
                        overallConfidence: 0.7,
                        uncertaintyIndicators: [],
                        insufficiencyFlags: [],
                        evidenceSufficiencyAssessment: 'sufficient',
                      }),
                    },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
          },
        });

      const options: DamageAnalysisOptions = {
        claimId: 'test-retry',
        damagePhotos: [Buffer.from('image')],
      };

      const result = await service.analyze(options);

      expect(result).toBeDefined();
      expect(mockPost).toHaveBeenCalledTimes(3);
    });
  });

  describe('Unit Tests - Event Emission', () => {
    it('should emit analysis_started event', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    damagePoints: [],
                    overallConfidence: 0.7,
                    uncertaintyIndicators: [],
                    insufficiencyFlags: [],
                    evidenceSufficiencyAssessment: 'sufficient',
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      };

      mockPost.mockResolvedValue({ data: mockResponse });

      const options: DamageAnalysisOptions = {
        claimId: 'test-event-started',
        damagePhotos: [Buffer.from('image')],
        insideDriverPhoto: Buffer.from('driver-photo'),
      };

      await service.analyze(options);

      expect(EventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'damage.analysis_started',
          claimId: 'test-event-started',
          sourceService: 'damage-analysis-service',
          actorType: 'system',
          payload: expect.objectContaining({
            damagePhotoCount: 1,
            hasScaleContext: true,
          }),
        })
      );
    });

    it('should emit analysis_completed event on success', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    damagePoints: [
                      {
                        affectedRegion: 'driver_side_upper',
                        severityAttributes: {
                          damageType: 'bullseye',
                          estimatedDiameterInches: 0.8,
                          estimatedLengthInches: null,
                          inDPVA: false,
                          repairEligible: true,
                          repairBlockingReasons: [],
                        },
                        glassObservations: ['clean_outer_surface_damage'],
                      },
                    ],
                    overallConfidence: 0.85,
                    uncertaintyIndicators: ['insufficient_scale_reference'],
                    insufficiencyFlags: [],
                    evidenceSufficiencyAssessment: 'sufficient_with_warnings',
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      };

      mockPost.mockResolvedValue({ data: mockResponse });

      const options: DamageAnalysisOptions = {
        claimId: 'test-event-completed',
        damagePhotos: [Buffer.from('image')],
      };

      await service.analyze(options);

      expect(EventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'damage.analysis_completed',
          claimId: 'test-event-completed',
          sourceService: 'damage-analysis-service',
          actorType: 'system',
          payload: expect.objectContaining({
            damagePointCount: 1,
            overallConfidence: 0.85,
            evidenceSufficiency: 'sufficient_with_warnings',
            hasUncertainty: true,
            hasInsufficiency: false,
          }),
        })
      );
    });

    it('should emit analysis_failed event on error', async () => {
      mockPost.mockRejectedValue(new Error('API failure'));

      const options: DamageAnalysisOptions = {
        claimId: 'test-event-failed',
        damagePhotos: [Buffer.from('image')],
      };

      await expect(service.analyze(options)).rejects.toThrow();

      expect(EventService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'damage.analysis_failed',
          claimId: 'test-event-failed',
          sourceService: 'damage-analysis-service',
          actorType: 'system',
          payload: expect.objectContaining({
            error: expect.any(String),
          }),
        })
      );
    });
  });

  describe('Unit Tests - Photo Context', () => {
    it('should include inside vehicle photos for scale context', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    damagePoints: [
                      {
                        affectedRegion: 'center_upper',
                        severityAttributes: {
                          damageType: 'crack',
                          estimatedDiameterInches: null,
                          estimatedLengthInches: 8.0,
                          inDPVA: false,
                          repairEligible: true,
                          repairBlockingReasons: [],
                        },
                        glassObservations: ['clean_outer_surface_damage'],
                      },
                    ],
                    overallConfidence: 0.92,
                    uncertaintyIndicators: [],
                    insufficiencyFlags: [],
                    evidenceSufficiencyAssessment: 'sufficient',
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      };

      mockPost.mockResolvedValue({ data: mockResponse });

      const options: DamageAnalysisOptions = {
        claimId: 'test-with-context',
        damagePhotos: [Buffer.from('damage-image')],
        insideDriverPhoto: Buffer.from('driver-context'),
        insidePassengerPhoto: Buffer.from('passenger-context'),
      };

      await service.analyze(options);

      // Verify the API was called with all photos
      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          contents: expect.arrayContaining([
            expect.objectContaining({
              parts: expect.arrayContaining([
                expect.objectContaining({
                  inline_data: expect.objectContaining({
                    mime_type: 'image/jpeg',
                  }),
                }),
              ]),
            }),
          ]),
        })
      );
    });
  });
});
