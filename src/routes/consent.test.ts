/**
 * Consent API Routes Integration Tests
 * 
 * Tests the consent API endpoints to ensure they work correctly
 * with the Express application
 */

import request from 'supertest';
import express from 'express';
import consentRouter from './consent';
import { consentService } from '../services/consentService';
import { journeyService } from '../services/journeyService';

// Mock services
jest.mock('../services/consentService');
jest.mock('../services/journeyService');

const mockConsentService = consentService as jest.Mocked<typeof consentService>;
const mockJourneyService = journeyService as jest.Mocked<typeof journeyService>;

describe('Consent API Routes', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api', consentRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/consent/legal-notice', () => {
    it('should return legal notice successfully', async () => {
      const mockNotice = {
        version: '1.0.0',
        content: {
          dataProcessingDescription: 'Test data processing description',
          automatedAnalysisNotice: 'Test automated analysis notice',
          manualReviewNotice: 'Test manual review notice',
          privacyNoticeUrl: 'https://example.com/privacy',
          supportContact: 'support@example.com',
        },
      };

      mockConsentService.getLegalNotice.mockReturnValue(mockNotice);

      const response = await request(app)
        .get('/api/consent/legal-notice')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockNotice);
      expect(response.body.timestamp).toBeTruthy();
    });

    it('should handle errors gracefully', async () => {
      mockConsentService.getLegalNotice.mockImplementation(() => {
        throw new Error('Service error');
      });

      const response = await request(app)
        .get('/api/consent/legal-notice')
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('POST /api/consent/capture', () => {
    it('should capture consent successfully', async () => {
      const mockConsentRecord = {
        claimId: 'claim-123',
        consentCaptured: true,
        consentCapturedAt: new Date(),
        consentVersion: '1.0.0',
        legalNoticeVersion: '1.0.0',
        channel: 'pwa' as const,
        sessionMetadata: {},
      };

      mockConsentService.captureConsent.mockResolvedValue({
        success: true,
        consentRecord: mockConsentRecord,
      });

      const response = await request(app)
        .post('/api/consent/capture')
        .send({
          journeyToken: 'valid-token',
          consentAccepted: true,
          sessionMetadata: { userAgent: 'test' },
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.consentCaptured).toBe(true);
      expect(response.body.data.consentCapturedAt).toBeTruthy();
      expect(response.body.data.consentVersion).toBe('1.0.0');
      expect(response.body.data.legalNoticeVersion).toBe('1.0.0');
    });

    it('should reject request without journey token', async () => {
      const response = await request(app)
        .post('/api/consent/capture')
        .send({
          consentAccepted: true,
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    it('should reject request without consent acceptance', async () => {
      const response = await request(app)
        .post('/api/consent/capture')
        .send({
          journeyToken: 'valid-token',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_CONSENT');
    });

    it('should reject request when consent is false', async () => {
      mockConsentService.captureConsent.mockResolvedValue({
        success: false,
        error: 'Consent must be accepted to proceed',
      });

      const response = await request(app)
        .post('/api/consent/capture')
        .send({
          journeyToken: 'valid-token',
          consentAccepted: false,
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('CONSENT_CAPTURE_FAILED');
    });

    it('should handle invalid journey token', async () => {
      mockConsentService.captureConsent.mockResolvedValue({
        success: false,
        error: 'Invalid journey token',
      });

      const response = await request(app)
        .post('/api/consent/capture')
        .send({
          journeyToken: 'invalid-token',
          consentAccepted: true,
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('CONSENT_CAPTURE_FAILED');
    });

    it('should handle service errors', async () => {
      mockConsentService.captureConsent.mockRejectedValue(new Error('Service error'));

      const response = await request(app)
        .post('/api/consent/capture')
        .send({
          journeyToken: 'valid-token',
          consentAccepted: true,
        })
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /api/consent/status', () => {
    it('should return consent status when captured', async () => {
      mockConsentService.isConsentCaptured.mockResolvedValue(true);

      const response = await request(app)
        .get('/api/consent/status')
        .query({ token: 'valid-token' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.consentCaptured).toBe(true);
    });

    it('should return consent status when not captured', async () => {
      mockConsentService.isConsentCaptured.mockResolvedValue(false);

      const response = await request(app)
        .get('/api/consent/status')
        .query({ token: 'valid-token' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.consentCaptured).toBe(false);
    });

    it('should reject request without token', async () => {
      const response = await request(app)
        .get('/api/consent/status')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    it('should handle service errors', async () => {
      mockConsentService.isConsentCaptured.mockRejectedValue(new Error('Service error'));

      const response = await request(app)
        .get('/api/consent/status')
        .query({ token: 'valid-token' })
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
