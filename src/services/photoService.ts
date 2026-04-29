import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import jwt from 'jsonwebtoken';
import { loggers } from '../utils/logger';
import { database } from '../config/database';
import { journeyService } from './journeyService';
import { consentService } from './consentService';
import { eventService, EVENT_TYPES } from './eventService';
import { config } from '../config';
import {
  PhotoSlot,
  FixedPhotoSlot,
  DamagePhotoSlot,
  PhotoValidationOutcome,
  UploadedPhoto,
  EvidenceSufficiency,
} from '../types';

/**
 * Photo Service for Glass Claim Assessment System
 * Handles photo upload, storage, and slot management
 * 
 * Features:
 * - 5 fixed photo slots + up to 3 damage photo slots
 * - Journey token authentication
 * - Consent gate enforcement
 * - Photo storage with signed URLs
 * - File validation and security checks
 * - Photo set completion tracking
 */

export interface PhotoUploadRequest {
  journeyToken: string;
  slot: PhotoSlot;
  file: Express.Multer.File;
}

export interface PhotoUploadResult {
  success: boolean;
  photo?: UploadedPhoto;
  error?: string;
  errorCode?: string;
}

export interface SignedUrlPayload {
  photoId: string;
  claimId: string;
  action: 'read' | 'write';
  exp: number;
}

export interface PhotoSetStatus {
  claimId: string;
  fixedPhotos: {
    [key in FixedPhotoSlot]: {
      uploaded: boolean;
      outcome?: PhotoValidationOutcome;
      photoId?: string;
    };
  };
  damagePhotos: {
    [key in DamagePhotoSlot]?: {
      uploaded: boolean;
      outcome?: PhotoValidationOutcome;
      photoId?: string;
    };
  };
  isComplete: boolean;
  evidenceSufficiency: EvidenceSufficiency;
}

export class PhotoService {
  private readonly UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'photos');
  private readonly SIGNED_URL_EXPIRES_HOURS = 24;
  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  private readonly ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'];

  private readonly FIXED_SLOTS: FixedPhotoSlot[] = [
    'front_vehicle',
    'vin_cutout',
    'logo_silkscreen',
    'inside_driver',
    'inside_passenger',
  ];

  private readonly DAMAGE_SLOTS: DamagePhotoSlot[] = ['damage_1', 'damage_2', 'damage_3'];

  constructor() {
    this.ensureUploadDirectory();
  }

  /**
   * Ensure upload directory exists
   */
  private async ensureUploadDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.UPLOAD_DIR, { recursive: true });
    } catch (error) {
      loggers.app.error('Failed to create upload directory', error as Error);
    }
  }

  /**
   * Upload a photo for a specific slot
   * 
   * @param request - Photo upload request
   * @returns Upload result with photo data or error
   */
  async uploadPhoto(request: PhotoUploadRequest): Promise<PhotoUploadResult> {
    const { journeyToken, slot, file } = request;

    loggers.app.info('Processing photo upload', {
      slot,
      mimeType: file.mimetype,
      size: file.size,
    });

    try {
      // Validate journey token
      const validation = await journeyService.validateToken(journeyToken);

      if (!validation.valid || !validation.journey) {
        loggers.app.warn('Invalid journey token for photo upload', {
          error: validation.error,
        });
        return {
          success: false,
          error: validation.error || 'Invalid journey token',
          errorCode: 'INVALID_TOKEN',
        };
      }

      const journey = validation.journey;
      const claimId = journey.claimId;

      // Enforce consent gate
      if (!journey.consentCaptured) {
        loggers.app.warn('Photo upload blocked - consent not captured', {
          journeyId: journey.journeyId,
          claimId,
        });
        return {
          success: false,
          error: 'Consent must be captured before uploading photos',
          errorCode: 'CONSENT_NOT_CAPTURED',
        };
      }

      // Validate file
      const fileValidation = this.validateFile(file);
      if (!fileValidation.valid) {
        return {
          success: false,
          error: fileValidation.error || 'File validation failed',
          errorCode: 'FILE_VALIDATION_FAILED',
        };
      }

      // Validate slot
      if (!this.isValidSlot(slot)) {
        return {
          success: false,
          error: `Invalid photo slot: ${slot}`,
          errorCode: 'INVALID_SLOT',
        };
      }

      // Check if slot already has a photo
      const existingPhoto = await this.getPhotoBySlot(claimId, slot);
      if (existingPhoto && existingPhoto.validationOutcome === 'accepted') {
        loggers.app.warn('Slot already has accepted photo', {
          claimId,
          slot,
          existingPhotoId: existingPhoto.photoId,
        });
        return {
          success: false,
          error: `Slot ${slot} already has an accepted photo. Delete it first to upload a new one.`,
          errorCode: 'SLOT_ALREADY_FILLED',
        };
      }

      // Generate photo ID and storage key
      const photoId = uuidv4();
      const fileExtension = path.extname(file.originalname) || '.jpg';
      const storageKey = `${claimId}/${slot}/${photoId}${fileExtension}`;
      const filePath = path.join(this.UPLOAD_DIR, storageKey);

      // Ensure directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      // Save file to storage
      await fs.writeFile(filePath, file.buffer);

      // Store photo record in database (with pending validation outcome)
      const photo = await this.storePhotoRecord({
        photoId,
        claimId,
        journeyId: journey.journeyId,
        slot,
        storageKey,
        mimeType: file.mimetype,
        fileSizeBytes: file.size,
        validationOutcome: 'accepted', // Will be updated by validation service
        validationDetails: {},
      });

      // Emit photo.uploaded event
      await eventService.emit({
        eventType: EVENT_TYPES.PHOTO_UPLOADED,
        claimId,
        sourceService: 'photo-service',
        actorType: 'claimant',
        payload: {
          photoId,
          slot,
          fileSizeBytes: file.size,
          mimeType: file.mimetype,
        },
      });

      loggers.app.info('Photo uploaded successfully', {
        photoId,
        claimId,
        slot,
      });

      return {
        success: true,
        photo,
      };
    } catch (error) {
      loggers.app.error('Failed to upload photo', error as Error);
      return {
        success: false,
        error: 'Failed to upload photo. Please try again.',
        errorCode: 'UPLOAD_FAILED',
      };
    }
  }

  /**
   * Validate uploaded file
   */
  private validateFile(file: Express.Multer.File): { valid: boolean; error?: string } {
    // Check MIME type
    if (!this.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return {
        valid: false,
        error: `Invalid file type. Only JPEG and PNG images are allowed.`,
      };
    }

    // Check file size
    if (file.size > this.MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `File size exceeds maximum limit of ${this.MAX_FILE_SIZE / 1024 / 1024}MB`,
      };
    }

    // Check if file is readable
    if (!file.buffer || file.buffer.length === 0) {
      return {
        valid: false,
        error: 'File is empty or unreadable',
      };
    }

    return { valid: true };
  }

  /**
   * Check if slot is valid
   */
  private isValidSlot(slot: string): slot is PhotoSlot {
    return (
      this.FIXED_SLOTS.includes(slot as FixedPhotoSlot) ||
      this.DAMAGE_SLOTS.includes(slot as DamagePhotoSlot)
    );
  }

  /**
   * Store photo record in database
   */
  private async storePhotoRecord(data: {
    photoId: string;
    claimId: string;
    journeyId: string;
    slot: PhotoSlot;
    storageKey: string;
    mimeType: string;
    fileSizeBytes: number;
    validationOutcome: PhotoValidationOutcome;
    validationDetails: Record<string, unknown>;
  }): Promise<UploadedPhoto> {
    const result = await database.query(
      `
      INSERT INTO uploaded_photos (
        photo_id,
        claim_id,
        journey_id,
        slot,
        storage_key,
        mime_type,
        file_size_bytes,
        validation_outcome,
        validation_details
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `,
      [
        data.photoId,
        data.claimId,
        data.journeyId,
        data.slot,
        data.storageKey,
        data.mimeType,
        data.fileSizeBytes,
        data.validationOutcome,
        JSON.stringify(data.validationDetails),
      ]
    );

    return this.mapRowToPhoto(result.rows[0]);
  }

  /**
   * Get photo by slot
   */
  async getPhotoBySlot(claimId: string, slot: PhotoSlot): Promise<UploadedPhoto | null> {
    const result = await database.query(
      `
      SELECT * FROM uploaded_photos
      WHERE claim_id = $1 AND slot = $2
      ORDER BY uploaded_at DESC
      LIMIT 1
    `,
      [claimId, slot]
    );

    if (result.rowCount === 0) {
      return null;
    }

    return this.mapRowToPhoto(result.rows[0]);
  }

  /**
   * Get all photos for a claim
   */
  async getClaimPhotos(claimId: string): Promise<UploadedPhoto[]> {
    const result = await database.query(
      `
      SELECT * FROM uploaded_photos
      WHERE claim_id = $1
      ORDER BY uploaded_at ASC
    `,
      [claimId]
    );

    return result.rows.map((row: any) => this.mapRowToPhoto(row));
  }

  /**
   * Get photo set status for a claim
   */
  async getPhotoSetStatus(claimId: string): Promise<PhotoSetStatus> {
    const photos = await this.getClaimPhotos(claimId);

    const status: PhotoSetStatus = {
      claimId,
      fixedPhotos: {
        front_vehicle: { uploaded: false },
        vin_cutout: { uploaded: false },
        logo_silkscreen: { uploaded: false },
        inside_driver: { uploaded: false },
        inside_passenger: { uploaded: false },
      },
      damagePhotos: {},
      isComplete: false,
      evidenceSufficiency: 'in_progress',
    };

    // Populate photo status
    for (const photo of photos) {
      if (this.FIXED_SLOTS.includes(photo.slot as FixedPhotoSlot)) {
        status.fixedPhotos[photo.slot as FixedPhotoSlot] = {
          uploaded: true,
          outcome: photo.validationOutcome,
          photoId: photo.photoId,
        };
      } else if (this.DAMAGE_SLOTS.includes(photo.slot as DamagePhotoSlot)) {
        status.damagePhotos[photo.slot as DamagePhotoSlot] = {
          uploaded: true,
          outcome: photo.validationOutcome,
          photoId: photo.photoId,
        };
      }
    }

    // Check completion rule
    const allFixedAccepted = this.FIXED_SLOTS.every(
      (slot) =>
        status.fixedPhotos[slot].outcome === 'accepted' ||
        status.fixedPhotos[slot].outcome === 'accepted_with_warning' ||
        status.fixedPhotos[slot].outcome === 'accepted_low_quality'
    );

    const damagePhotoCount = Object.keys(status.damagePhotos).length;
    const acceptedDamagePhotos = Object.values(status.damagePhotos).filter(
      (photo) =>
        photo.outcome === 'accepted' ||
        photo.outcome === 'accepted_with_warning' ||
        photo.outcome === 'accepted_low_quality'
    ).length;

    status.isComplete =
      allFixedAccepted && acceptedDamagePhotos >= 1 && damagePhotoCount <= 3;

    // Determine evidence sufficiency
    if (!status.isComplete) {
      status.evidenceSufficiency = 'in_progress';
    } else {
      const hasWarnings = photos.some(
        (p) =>
          p.validationOutcome === 'accepted_with_warning' ||
          p.validationOutcome === 'accepted_low_quality'
      );
      const hasRejected = photos.some((p) => p.validationOutcome === 'rejected_retake_required');

      if (hasRejected) {
        status.evidenceSufficiency = 'insufficient';
      } else if (hasWarnings) {
        status.evidenceSufficiency = 'sufficient_with_warnings';
      } else {
        status.evidenceSufficiency = 'sufficient';
      }
    }

    return status;
  }

  /**
   * Generate signed URL for photo access
   * 
   * @param photoId - Photo identifier
   * @param action - 'read' or 'write'
   * @returns Signed URL
   */
  generateSignedUrl(photoId: string, claimId: string, action: 'read' | 'write'): string {
    const expiresAt = new Date(
      Date.now() + this.SIGNED_URL_EXPIRES_HOURS * 60 * 60 * 1000
    );

    const payload: SignedUrlPayload = {
      photoId,
      claimId,
      action,
      exp: Math.floor(expiresAt.getTime() / 1000),
    };

    const token = jwt.sign(payload, config.security.jwtSecret);

    return `${config.baseUrl}/api/photos/${photoId}?token=${token}`;
  }

  /**
   * Verify signed URL token
   */
  verifySignedUrl(token: string): { valid: boolean; payload?: SignedUrlPayload; error?: string } {
    try {
      const decoded = jwt.verify(token, config.security.jwtSecret) as SignedUrlPayload;
      return { valid: true, payload: decoded };
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        return { valid: false, error: 'Invalid token signature' };
      }
      if (error instanceof jwt.TokenExpiredError) {
        return { valid: false, error: 'Token has expired' };
      }
      return { valid: false, error: 'Token verification failed' };
    }
  }

  /**
   * Get photo file path
   */
  getPhotoFilePath(storageKey: string): string {
    return path.join(this.UPLOAD_DIR, storageKey);
  }

  /**
   * Map database row to UploadedPhoto
   */
  private mapRowToPhoto(row: any): UploadedPhoto {
    return {
      id: row.id,
      photoId: row.photo_id,
      claimId: row.claim_id,
      journeyId: row.journey_id,
      slot: row.slot,
      storageKey: row.storage_key,
      mimeType: row.mime_type,
      fileSizeBytes: row.file_size_bytes,
      uploadedAt: row.uploaded_at,
      validationOutcome: row.validation_outcome,
      validationDetails: row.validation_details,
    };
  }
}

// Export singleton instance
export const photoService = new PhotoService();
