import { Router, Request, Response } from 'express';
import multer from 'multer';
import { photoService } from '../services/photoService';
import { photoValidationService } from '../services/photoValidationService';
import { loggers } from '../utils/logger';

const router = Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    // Accept only images
    if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG and PNG images are allowed'));
    }
  },
});

/**
 * POST /api/photos/upload
 * 
 * Upload a photo for a specific slot
 * 
 * Request body (multipart/form-data):
 * - journeyToken: JWT token from journey link
 * - slot: Photo slot identifier
 * - photo: Image file
 */
router.post('/photos/upload', upload.single('photo'), async (req: Request, res: Response) => {
  try {
    const { journeyToken, slot } = req.body;
    const file = req.file;

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

    if (!slot) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Photo slot is required',
          code: 'MISSING_SLOT',
        },
        timestamp: new Date().toISOString(),
      });
    }

    if (!file) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Photo file is required',
          code: 'MISSING_FILE',
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Upload photo
    const uploadResult = await photoService.uploadPhoto({
      journeyToken,
      slot,
      file,
    });

    if (!uploadResult.success) {
      const statusCode = uploadResult.errorCode === 'CONSENT_NOT_CAPTURED' ? 403 : 400;
      return res.status(statusCode).json({
        success: false,
        error: {
          message: uploadResult.error,
          code: uploadResult.errorCode,
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Validate photo
    const validationResult = await photoValidationService.validatePhoto(uploadResult.photo!);

    // Get photo set status
    const photoSetStatus = await photoService.getPhotoSetStatus(uploadResult.photo!.claimId);

    res.status(200).json({
      success: true,
      data: {
        photo: {
          photoId: uploadResult.photo!.photoId,
          slot: uploadResult.photo!.slot,
          uploadedAt: uploadResult.photo!.uploadedAt,
          validationOutcome: validationResult.outcome,
          validationMessage: validationResult.userFriendlyMessage,
          warnings: validationResult.warnings,
        },
        photoSetStatus: {
          isComplete: photoSetStatus.isComplete,
          evidenceSufficiency: photoSetStatus.evidenceSufficiency,
          fixedPhotos: photoSetStatus.fixedPhotos,
          damagePhotos: photoSetStatus.damagePhotos,
        },
      },
      timestamp: new Date().toISOString(),
    });
    return;
  } catch (error) {
    loggers.app.error('Failed to upload photo', error as Error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      },
      timestamp: new Date().toISOString(),
    });
    return;
  }
});

/**
 * GET /api/photos/status
 * 
 * Get photo set status for a journey
 * 
 * Query parameters:
 * - token: Journey token
 */
router.get('/photos/status', async (req: Request, res: Response) => {
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

    // Validate journey token and get claim ID
    const { journeyService } = await import('../services/journeyService');
    const validation = await journeyService.validateToken(token);

    if (!validation.valid || !validation.journey) {
      return res.status(401).json({
        success: false,
        error: {
          message: validation.error || 'Invalid journey token',
          code: 'INVALID_TOKEN',
        },
        timestamp: new Date().toISOString(),
      });
    }

    const claimId = validation.journey.claimId;

    // Get photo set status
    const photoSetStatus = await photoService.getPhotoSetStatus(claimId);

    res.status(200).json({
      success: true,
      data: photoSetStatus,
      timestamp: new Date().toISOString(),
    });
    return;
  } catch (error) {
    loggers.app.error('Failed to get photo status', error as Error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      },
      timestamp: new Date().toISOString(),
    });
    return;
  }
});

/**
 * GET /api/photos/:photoId
 * 
 * Get a photo file with signed URL authentication
 * 
 * Query parameters:
 * - token: Signed URL token
 */
router.get('/photos/:photoId', async (req: Request, res: Response) => {
  try {
    const { photoId } = req.params;
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Signed URL token is required',
          code: 'MISSING_TOKEN',
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Verify signed URL
    const verification = photoService.verifySignedUrl(token);

    if (!verification.valid || !verification.payload) {
      return res.status(401).json({
        success: false,
        error: {
          message: verification.error || 'Invalid signed URL',
          code: 'INVALID_TOKEN',
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Check if photo ID matches
    if (verification.payload.photoId !== photoId) {
      return res.status(403).json({
        success: false,
        error: {
          message: 'Photo ID mismatch',
          code: 'PHOTO_ID_MISMATCH',
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Get photo from database
    const photos = await photoService.getClaimPhotos(verification.payload.claimId);
    const photo = photos.find((p) => p.photoId === photoId);

    if (!photo) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Photo not found',
          code: 'PHOTO_NOT_FOUND',
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Send file
    const filePath = photoService.getPhotoFilePath(photo.storageKey);
    res.sendFile(filePath);
    return;
  } catch (error) {
    loggers.app.error('Failed to get photo', error as Error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      },
      timestamp: new Date().toISOString(),
    });
    return;
  }
});

export default router;
