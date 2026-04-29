import sharp from 'sharp';
import exifParser from 'exif-parser';
import fs from 'fs/promises';
import { loggers } from '../utils/logger';
import { database } from '../config/database';
import { photoService } from './photoService';
import { eventService, EVENT_TYPES } from './eventService';
import { PhotoSlot, PhotoValidationOutcome, UploadedPhoto } from '../types';

/**
 * Photo Validation Service for Glass Claim Assessment System
 * Validates photo quality and enforces camera-only capture
 * 
 * Features:
 * - MIME type validation
 * - File size validation
 * - Resolution validation (minimum 800x600)
 * - Sharpness check (Laplacian variance)
 * - Brightness check (average pixel intensity)
 * - EXIF timestamp validation (within last 10 minutes)
 * - Camera-only enforcement
 * - User-friendly error messages
 */

export interface PhotoValidationResult {
  photoId: string;
  slot: PhotoSlot;
  outcome: PhotoValidationOutcome;
  checks: {
    mimeTypeSupported: boolean;
    fileReadable: boolean;
    fileSizeWithinLimit: boolean;
    minimumResolutionMet: boolean;
    sharpnessAcceptable: boolean;
    brightnessAcceptable: boolean;
    likelyCorrectFraming: boolean;
    likelyNotDuplicate: boolean;
    exifTimestampValid: boolean;
    capturedWithinTimeLimit: boolean;
  };
  warnings: string[];
  rejectionReason?: string;
  userFriendlyMessage?: string;
}

export class PhotoValidationService {
  private readonly MIN_WIDTH = 800;
  private readonly MIN_HEIGHT = 600;
  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  private readonly ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'];
  
  // Sharpness threshold (Laplacian variance)
  private readonly MIN_SHARPNESS = 50;
  
  // Brightness thresholds (0-255 scale)
  private readonly MIN_BRIGHTNESS = 30;
  private readonly MAX_BRIGHTNESS = 240;
  
  // EXIF timestamp validation (10 minutes)
  private readonly MAX_PHOTO_AGE_MINUTES = 10;

  /**
   * Validate a photo
   * 
   * @param photo - Uploaded photo record
   * @returns Validation result
   */
  async validatePhoto(photo: UploadedPhoto): Promise<PhotoValidationResult> {
    loggers.app.info('Validating photo', {
      photoId: photo.photoId,
      slot: photo.slot,
      claimId: photo.claimId,
    });

    const result: PhotoValidationResult = {
      photoId: photo.photoId,
      slot: photo.slot,
      outcome: 'accepted',
      checks: {
        mimeTypeSupported: false,
        fileReadable: false,
        fileSizeWithinLimit: false,
        minimumResolutionMet: false,
        sharpnessAcceptable: false,
        brightnessAcceptable: false,
        likelyCorrectFraming: true, // Simplified for POC
        likelyNotDuplicate: true, // Simplified for POC
        exifTimestampValid: false,
        capturedWithinTimeLimit: false,
      },
      warnings: [],
    };

    try {
      // Check MIME type
      result.checks.mimeTypeSupported = this.ALLOWED_MIME_TYPES.includes(photo.mimeType);
      if (!result.checks.mimeTypeSupported) {
        result.outcome = 'rejected_retake_required';
        result.rejectionReason = 'unsupported_mime_type';
        result.userFriendlyMessage = 'Please upload a JPEG or PNG image.';
        await this.updatePhotoValidation(photo.photoId, result);
        return result;
      }

      // Check file size
      result.checks.fileSizeWithinLimit = photo.fileSizeBytes <= this.MAX_FILE_SIZE;
      if (!result.checks.fileSizeWithinLimit) {
        result.outcome = 'rejected_retake_required';
        result.rejectionReason = 'file_too_large';
        result.userFriendlyMessage = `File size exceeds ${this.MAX_FILE_SIZE / 1024 / 1024}MB limit. Please compress the image or take a new photo.`;
        await this.updatePhotoValidation(photo.photoId, result);
        return result;
      }

      // Read file
      const filePath = photoService.getPhotoFilePath(photo.storageKey);
      const fileBuffer = await fs.readFile(filePath);
      result.checks.fileReadable = true;

      // Load image with sharp
      const image = sharp(fileBuffer);
      const metadata = await image.metadata();

      // Check resolution
      const width = metadata.width || 0;
      const height = metadata.height || 0;
      result.checks.minimumResolutionMet = width >= this.MIN_WIDTH && height >= this.MIN_HEIGHT;
      
      if (!result.checks.minimumResolutionMet) {
        result.outcome = 'rejected_retake_required';
        result.rejectionReason = 'resolution_too_low';
        result.userFriendlyMessage = `Image resolution is too low (${width}x${height}). Please take a photo with at least ${this.MIN_WIDTH}x${this.MIN_HEIGHT} resolution.`;
        await this.updatePhotoValidation(photo.photoId, result);
        return result;
      }

      // Check sharpness (Laplacian variance)
      const sharpness = await this.calculateSharpness(image);
      result.checks.sharpnessAcceptable = sharpness >= this.MIN_SHARPNESS;
      
      if (!result.checks.sharpnessAcceptable) {
        result.warnings.push('Image appears blurry');
        result.outcome = 'accepted_with_warning';
        result.userFriendlyMessage = 'Photo accepted but appears slightly blurry. For best results, ensure the camera is focused before taking the photo.';
      }

      // Check brightness
      const brightness = await this.calculateBrightness(image);
      result.checks.brightnessAcceptable =
        brightness >= this.MIN_BRIGHTNESS && brightness <= this.MAX_BRIGHTNESS;
      
      if (!result.checks.brightnessAcceptable) {
        if (brightness < this.MIN_BRIGHTNESS) {
          result.warnings.push('Image is too dark');
          result.outcome = 'accepted_with_warning';
          result.userFriendlyMessage = 'Photo accepted but is quite dark. For better results, take the photo in good lighting conditions.';
        } else {
          result.warnings.push('Image is too bright');
          result.outcome = 'accepted_with_warning';
          result.userFriendlyMessage = 'Photo accepted but is overexposed. Avoid direct sunlight or bright reflections.';
        }
      }

      // Check EXIF timestamp
      const exifValidation = await this.validateExifTimestamp(fileBuffer);
      result.checks.exifTimestampValid = exifValidation.valid;
      result.checks.capturedWithinTimeLimit = exifValidation.withinTimeLimit;

      if (!exifValidation.valid) {
        result.outcome = 'rejected_retake_required';
        result.rejectionReason = 'photo_not_recently_captured';
        result.userFriendlyMessage = exifValidation.message || 'Photo must be taken with your device camera, not uploaded from gallery. Please take a new photo.';
        await this.updatePhotoValidation(photo.photoId, result);
        return result;
      }

      if (!exifValidation.withinTimeLimit) {
        result.outcome = 'rejected_retake_required';
        result.rejectionReason = 'photo_not_recently_captured';
        result.userFriendlyMessage = `Photo was taken more than ${this.MAX_PHOTO_AGE_MINUTES} minutes ago. Please take a fresh photo now.`;
        await this.updatePhotoValidation(photo.photoId, result);
        return result;
      }

      // Update photo validation in database
      await this.updatePhotoValidation(photo.photoId, result);

      // Emit appropriate event
      if (result.outcome === 'accepted' || result.outcome === 'accepted_with_warning') {
        await eventService.emit({
          eventType: EVENT_TYPES.PHOTO_VALIDATED,
          claimId: photo.claimId,
          sourceService: 'photo-validation-service',
          actorType: 'system',
          payload: {
            photoId: photo.photoId,
            slot: photo.slot,
            outcome: result.outcome,
            warnings: result.warnings,
          },
        });
      } else {
        await eventService.emit({
          eventType: EVENT_TYPES.PHOTO_REJECTED,
          claimId: photo.claimId,
          sourceService: 'photo-validation-service',
          actorType: 'system',
          payload: {
            photoId: photo.photoId,
            slot: photo.slot,
            outcome: result.outcome,
            rejectionReason: result.rejectionReason,
          },
        });
      }

      loggers.app.info('Photo validation complete', {
        photoId: photo.photoId,
        outcome: result.outcome,
        warnings: result.warnings,
      });

      return result;
    } catch (error) {
      loggers.app.error('Photo validation failed', error as Error, {
        photoId: photo.photoId,
      });

      result.outcome = 'rejected_retake_required';
      result.rejectionReason = 'validation_error';
      result.userFriendlyMessage = 'Unable to process photo. Please try taking a new photo.';
      
      await this.updatePhotoValidation(photo.photoId, result);
      return result;
    }
  }

  /**
   * Calculate image sharpness using Laplacian variance
   */
  private async calculateSharpness(image: sharp.Sharp): Promise<number> {
    try {
      // Convert to grayscale and get raw pixel data
      const { data, info } = await image
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      // Calculate Laplacian variance (simplified)
      // This is a basic implementation - production would use more sophisticated algorithms
      let variance = 0;
      const width = info.width;
      const height = info.height;

      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = y * width + x;
          const center = data[idx];
          const top = data[(y - 1) * width + x];
          const bottom = data[(y + 1) * width + x];
          const left = data[y * width + (x - 1)];
          const right = data[y * width + (x + 1)];

          const laplacian = Math.abs(4 * center - top - bottom - left - right);
          variance += laplacian * laplacian;
        }
      }

      variance = variance / ((width - 2) * (height - 2));
      return Math.sqrt(variance);
    } catch (error) {
      loggers.app.warn('Failed to calculate sharpness', error as Error);
      return this.MIN_SHARPNESS; // Default to acceptable
    }
  }

  /**
   * Calculate average brightness
   */
  private async calculateBrightness(image: sharp.Sharp): Promise<number> {
    try {
      // Get image statistics
      const stats = await image.stats();
      
      // Calculate average brightness across all channels
      const avgBrightness = stats.channels.reduce((sum, channel) => sum + channel.mean, 0) / stats.channels.length;
      
      return avgBrightness;
    } catch (error) {
      loggers.app.warn('Failed to calculate brightness', error as Error);
      return 128; // Default to mid-range
    }
  }

  /**
   * Validate EXIF timestamp
   */
  private async validateExifTimestamp(
    fileBuffer: Buffer
  ): Promise<{ valid: boolean; withinTimeLimit: boolean; message?: string }> {
    try {
      const parser = exifParser.create(fileBuffer);
      const exifData = parser.parse();

      if (!exifData.tags || !exifData.tags.DateTimeOriginal) {
        return {
          valid: false,
          withinTimeLimit: false,
          message: 'Photo must be taken with your device camera. Please use the camera button, not the gallery.',
        };
      }

      const photoTimestamp = exifData.tags.DateTimeOriginal * 1000; // Convert to milliseconds
      const now = Date.now();
      const ageMinutes = (now - photoTimestamp) / 1000 / 60;

      if (ageMinutes < 0) {
        // Photo timestamp is in the future - likely clock issue
        return {
          valid: false,
          withinTimeLimit: false,
          message: 'Photo timestamp is invalid. Please check your device clock and take a new photo.',
        };
      }

      if (ageMinutes > this.MAX_PHOTO_AGE_MINUTES) {
        return {
          valid: true,
          withinTimeLimit: false,
          message: `Photo was taken ${Math.round(ageMinutes)} minutes ago. Please take a fresh photo now.`,
        };
      }

      return {
        valid: true,
        withinTimeLimit: true,
      };
    } catch (error) {
      loggers.app.warn('Failed to parse EXIF data', error as Error);
      // If EXIF parsing fails, assume photo doesn't have EXIF data (likely not from camera)
      return {
        valid: false,
        withinTimeLimit: false,
        message: 'Photo must be taken with your device camera, not uploaded from gallery.',
      };
    }
  }

  /**
   * Update photo validation outcome in database
   */
  private async updatePhotoValidation(
    photoId: string,
    result: PhotoValidationResult
  ): Promise<void> {
    await database.query(
      `
      UPDATE uploaded_photos
      SET 
        validation_outcome = $1,
        validation_details = $2
      WHERE photo_id = $3
    `,
      [
        result.outcome,
        JSON.stringify({
          checks: result.checks,
          warnings: result.warnings,
          rejectionReason: result.rejectionReason,
          userFriendlyMessage: result.userFriendlyMessage,
        }),
        photoId,
      ]
    );
  }
}

// Export singleton instance
export const photoValidationService = new PhotoValidationService();
