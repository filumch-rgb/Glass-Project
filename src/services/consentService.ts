import { loggers } from '../utils/logger';
import { journeyService } from './journeyService';

/**
 * Consent Service for Glass Claim Assessment System
 * Handles legal notice presentation and consent recording
 * 
 * Features:
 * - Present legal notice with required content fields
 * - Record consent capture with metadata
 * - Enforce consent gate for photo uploads
 * - Support PWA and WhatsApp channels
 */

export interface LegalNotice {
  version: string;
  content: {
    dataProcessingDescription: string;
    automatedAnalysisNotice: string;
    manualReviewNotice: string;
    privacyNoticeUrl: string;
    supportContact: string;
  };
}

export interface ConsentRecord {
  claimId: string;
  consentCaptured: boolean;
  consentCapturedAt: Date;
  consentVersion: string;
  legalNoticeVersion: string;
  channel: 'pwa' | 'whatsapp';
  sessionMetadata: Record<string, string>;
}

export interface CaptureConsentRequest {
  journeyToken: string;
  consentAccepted: boolean;
  sessionMetadata?: Record<string, string>;
}

export interface CaptureConsentResult {
  success: boolean;
  consentRecord?: ConsentRecord;
  error?: string;
}

export class ConsentService {
  // Current legal notice version
  private readonly LEGAL_NOTICE_VERSION = '1.0.0';
  private readonly CONSENT_VERSION = '1.0.0';

  /**
   * Get the current legal notice
   * 
   * @returns Legal notice with required content fields
   */
  getLegalNotice(): LegalNotice {
    return {
      version: this.LEGAL_NOTICE_VERSION,
      content: {
        dataProcessingDescription:
          'Your photos and claim information will be processed using automated image analysis technology to assess windscreen damage. This processing includes damage detection, severity analysis, and vehicle identification.',
        automatedAnalysisNotice:
          'An automated system will analyze your photos to determine whether your windscreen should be repaired or replaced. This analysis uses artificial intelligence and predefined rules.',
        manualReviewNotice:
          'In some cases, your claim may be reviewed by a human operator to ensure accuracy. This may occur if the automated system has low confidence or detects unusual circumstances.',
        privacyNoticeUrl: 'https://glassscans.com/privacy',
        supportContact: 'support@glassscans.com',
      },
    };
  }

  /**
   * Capture consent for a journey
   * 
   * @param request - Consent capture request
   * @returns Consent capture result
   */
  async captureConsent(request: CaptureConsentRequest): Promise<CaptureConsentResult> {
    const { journeyToken, consentAccepted, sessionMetadata = {} } = request;

    loggers.app.info('Processing consent capture request', {
      consentAccepted,
    });

    try {
      // Validate journey token
      const validation = await journeyService.validateToken(journeyToken);

      if (!validation.valid || !validation.journey) {
        loggers.app.warn('Invalid journey token for consent capture', {
          error: validation.error,
        });
        return {
          success: false,
          error: validation.error || 'Invalid journey token',
        };
      }

      const journey = validation.journey;

      // Check if consent already captured
      if (journey.consentCaptured) {
        loggers.app.info('Consent already captured for journey', {
          journeyId: journey.journeyId,
        });
        return {
          success: true,
          consentRecord: {
            claimId: journey.claimId,
            consentCaptured: true,
            consentCapturedAt: journey.consentCapturedAt!,
            consentVersion: journey.consentVersion!,
            legalNoticeVersion: journey.legalNoticeVersion!,
            channel: journey.channel,
            sessionMetadata: sessionMetadata,
          },
        };
      }

      // Validate consent acceptance
      if (!consentAccepted) {
        loggers.app.warn('Consent not accepted', {
          journeyId: journey.journeyId,
        });
        return {
          success: false,
          error: 'Consent must be accepted to proceed',
        };
      }

      // Record consent in journey service
      await journeyService.captureConsent(
        journey.journeyId,
        this.CONSENT_VERSION,
        this.LEGAL_NOTICE_VERSION
      );

      const consentCapturedAt = new Date();

      const consentRecord: ConsentRecord = {
        claimId: journey.claimId,
        consentCaptured: true,
        consentCapturedAt,
        consentVersion: this.CONSENT_VERSION,
        legalNoticeVersion: this.LEGAL_NOTICE_VERSION,
        channel: journey.channel,
        sessionMetadata,
      };

      loggers.app.info('Consent captured successfully', {
        journeyId: journey.journeyId,
        claimId: journey.claimId,
        channel: journey.channel,
      });

      return {
        success: true,
        consentRecord,
      };
    } catch (error) {
      loggers.app.error('Failed to capture consent', error as Error);
      return {
        success: false,
        error: 'Failed to capture consent. Please try again.',
      };
    }
  }

  /**
   * Check if consent has been captured for a journey
   * 
   * @param journeyToken - Journey token
   * @returns True if consent captured, false otherwise
   */
  async isConsentCaptured(journeyToken: string): Promise<boolean> {
    try {
      const validation = await journeyService.validateToken(journeyToken);

      if (!validation.valid || !validation.journey) {
        return false;
      }

      return validation.journey.consentCaptured;
    } catch (error) {
      loggers.app.error('Failed to check consent status', error as Error);
      return false;
    }
  }
}

// Export singleton instance
export const consentService = new ConsentService();
