import { Router, Request, Response } from 'express';
import { consentService } from '../services/consentService';
import { loggers } from '../utils/logger';

const router = Router();

/**
 * GET /api/consent/legal-notice
 * 
 * Returns the current legal notice that must be presented to claimants
 */
router.get('/consent/legal-notice', (req: Request, res: Response) => {
  try {
    const legalNotice = consentService.getLegalNotice();

    res.status(200).json({
      success: true,
      data: legalNotice,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    loggers.app.error('Failed to get legal notice', error as Error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to retrieve legal notice',
      },
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/consent/capture
 * 
 * Records consent capture for a journey
 * 
 * Request body:
 * - journeyToken: JWT token from journey link
 * - consentAccepted: boolean indicating consent acceptance
 * - sessionMetadata: optional metadata about the session
 */
router.post('/consent/capture', async (req: Request, res: Response) => {
  try {
    const { journeyToken, consentAccepted, sessionMetadata } = req.body;

    // Validate required fields
    if (!journeyToken) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Journey token is required',
          code: 'MISSING_TOKEN',
        },
        timestamp: new Date().toISOString(),
      });
    }

    if (typeof consentAccepted !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Consent acceptance must be a boolean value',
          code: 'INVALID_CONSENT',
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Capture consent
    const result = await consentService.captureConsent({
      journeyToken,
      consentAccepted,
      sessionMetadata: sessionMetadata || {},
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: {
          message: result.error || 'Failed to capture consent',
          code: 'CONSENT_CAPTURE_FAILED',
        },
        timestamp: new Date().toISOString(),
      });
    }

    res.status(200).json({
      success: true,
      data: {
        consentCaptured: true,
        consentCapturedAt: result.consentRecord!.consentCapturedAt,
        consentVersion: result.consentRecord!.consentVersion,
        legalNoticeVersion: result.consentRecord!.legalNoticeVersion,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    loggers.app.error('Failed to capture consent', error as Error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      },
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/consent/status
 * 
 * Check if consent has been captured for a journey
 * 
 * Query parameters:
 * - token: Journey token
 */
router.get('/consent/status', async (req: Request, res: Response) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Journey token is required',
          code: 'MISSING_TOKEN',
        },
        timestamp: new Date().toISOString(),
      });
    }

    const consentCaptured = await consentService.isConsentCaptured(token);

    res.status(200).json({
      success: true,
      data: {
        consentCaptured,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    loggers.app.error('Failed to check consent status', error as Error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      },
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
