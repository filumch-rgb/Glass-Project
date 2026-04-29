import { consentService } from './consentService';
import { journeyService } from './journeyService';

// Mock journey service
jest.mock('./journeyService', () => ({
  journeyService: {
    validateToken: jest.fn(),
    captureConsent: jest.fn(),
  },
}));

const mockJourneyService = journeyService as jest.Mocked<typeof journeyService>;

describe('ConsentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getLegalNotice', () => {
    it('should return legal notice with all required fields', () => {
      const notice = consentService.getLegalNotice();

      expect(notice).toHaveProperty('version');
      expect(notice).toHaveProperty('content');
      expect(notice.content).toHaveProperty('dataProcessingDescription');
      expect(notice.content).toHaveProperty('automatedAnalysisNotice');
      expect(notice.content).toHaveProperty('manualReviewNotice');
      expect(notice.content).toHaveProperty('privacyNoticeUrl');
      expect(notice.content).toHaveProperty('supportContact');
    });

    it('should return non-empty content fields', () => {
      const notice = consentService.getLegalNotice();

      expect(notice.version).toBeTruthy();
      expect(notice.content.dataProcessingDescription).toBeTruthy();
      expect(notice.content.automatedAnalysisNotice).toBeTruthy();
      expect(notice.content.manualReviewNotice).toBeTruthy();
      expect(notice.content.privacyNoticeUrl).toBeTruthy();
      expect(notice.content.supportContact).toBeTruthy();
    });
  });

  describe('captureConsent', () => {
    it('should capture consent successfully for valid journey', async () => {
      const mockJourney = {
        id: 1,
        journeyId: 'journey-123',
        claimId: 'claim-456',
        channel: 'pwa' as const,
        tokenJti: 'jti-789',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        revoked: false,
        consentCaptured: false,
        sessionMetadata: {},
        createdAt: new Date(),
      };

      mockJourneyService.validateToken.mockResolvedValue({
        valid: true,
        journey: mockJourney,
      });

      mockJourneyService.captureConsent.mockResolvedValue(undefined);

      const result = await consentService.captureConsent({
        journeyToken: 'valid-token',
        consentAccepted: true,
        sessionMetadata: { userAgent: 'test' },
      });

      expect(result.success).toBe(true);
      expect(result.consentRecord).toBeDefined();
      expect(result.consentRecord?.claimId).toBe('claim-456');
      expect(result.consentRecord?.consentCaptured).toBe(true);
      expect(result.consentRecord?.channel).toBe('pwa');
      expect(mockJourneyService.captureConsent).toHaveBeenCalledWith(
        'journey-123',
        expect.any(String),
        expect.any(String)
      );
    });

    it('should fail for invalid journey token', async () => {
      mockJourneyService.validateToken.mockResolvedValue({
        valid: false,
        error: 'Invalid token',
      });

      const result = await consentService.captureConsent({
        journeyToken: 'invalid-token',
        consentAccepted: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid token');
      expect(mockJourneyService.captureConsent).not.toHaveBeenCalled();
    });

    it('should fail when consent not accepted', async () => {
      const mockJourney = {
        id: 1,
        journeyId: 'journey-123',
        claimId: 'claim-456',
        channel: 'pwa' as const,
        tokenJti: 'jti-789',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        revoked: false,
        consentCaptured: false,
        sessionMetadata: {},
        createdAt: new Date(),
      };

      mockJourneyService.validateToken.mockResolvedValue({
        valid: true,
        journey: mockJourney,
      });

      const result = await consentService.captureConsent({
        journeyToken: 'valid-token',
        consentAccepted: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('must be accepted');
      expect(mockJourneyService.captureConsent).not.toHaveBeenCalled();
    });

    it('should return existing consent if already captured', async () => {
      const consentDate = new Date('2024-01-01T12:00:00Z');
      const mockJourney = {
        id: 1,
        journeyId: 'journey-123',
        claimId: 'claim-456',
        channel: 'pwa' as const,
        tokenJti: 'jti-789',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        revoked: false,
        consentCaptured: true,
        consentCapturedAt: consentDate,
        consentVersion: '1.0.0',
        legalNoticeVersion: '1.0.0',
        sessionMetadata: {},
        createdAt: new Date(),
      };

      mockJourneyService.validateToken.mockResolvedValue({
        valid: true,
        journey: mockJourney,
      });

      const result = await consentService.captureConsent({
        journeyToken: 'valid-token',
        consentAccepted: true,
      });

      expect(result.success).toBe(true);
      expect(result.consentRecord?.consentCaptured).toBe(true);
      expect(result.consentRecord?.consentCapturedAt).toEqual(consentDate);
      expect(mockJourneyService.captureConsent).not.toHaveBeenCalled();
    });

    it('should handle WhatsApp channel', async () => {
      const mockJourney = {
        id: 1,
        journeyId: 'journey-123',
        claimId: 'claim-456',
        channel: 'whatsapp' as const,
        tokenJti: 'jti-789',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        revoked: false,
        consentCaptured: false,
        sessionMetadata: {},
        createdAt: new Date(),
      };

      mockJourneyService.validateToken.mockResolvedValue({
        valid: true,
        journey: mockJourney,
      });

      mockJourneyService.captureConsent.mockResolvedValue(undefined);

      const result = await consentService.captureConsent({
        journeyToken: 'valid-token',
        consentAccepted: true,
      });

      expect(result.success).toBe(true);
      expect(result.consentRecord?.channel).toBe('whatsapp');
    });
  });

  describe('isConsentCaptured', () => {
    it('should return true when consent is captured', async () => {
      const mockJourney = {
        id: 1,
        journeyId: 'journey-123',
        claimId: 'claim-456',
        channel: 'pwa' as const,
        tokenJti: 'jti-789',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        revoked: false,
        consentCaptured: true,
        consentCapturedAt: new Date(),
        consentVersion: '1.0.0',
        legalNoticeVersion: '1.0.0',
        sessionMetadata: {},
        createdAt: new Date(),
      };

      mockJourneyService.validateToken.mockResolvedValue({
        valid: true,
        journey: mockJourney,
      });

      const result = await consentService.isConsentCaptured('valid-token');

      expect(result).toBe(true);
    });

    it('should return false when consent is not captured', async () => {
      const mockJourney = {
        id: 1,
        journeyId: 'journey-123',
        claimId: 'claim-456',
        channel: 'pwa' as const,
        tokenJti: 'jti-789',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        revoked: false,
        consentCaptured: false,
        sessionMetadata: {},
        createdAt: new Date(),
      };

      mockJourneyService.validateToken.mockResolvedValue({
        valid: true,
        journey: mockJourney,
      });

      const result = await consentService.isConsentCaptured('valid-token');

      expect(result).toBe(false);
    });

    it('should return false for invalid token', async () => {
      mockJourneyService.validateToken.mockResolvedValue({
        valid: false,
        error: 'Invalid token',
      });

      const result = await consentService.isConsentCaptured('invalid-token');

      expect(result).toBe(false);
    });
  });
});
