import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { loggers } from '../utils/logger';
import { database } from '../config/database';
import { eventService, EVENT_TYPES } from './eventService';
import { Journey } from '../types';

/**
 * Journey Service for Glass Claim Assessment System
 * Handles journey token management with security features
 * 
 * Features:
 * - Signed JWT journey tokens with claim scoping
 * - Token expiration (24 hours default from JOURNEY_TOKEN_EXPIRES_HOURS env var)
 * - Token revocation support
 * - Journey abandonment after timeout
 * - RBAC for journey access
 * - Store journey records in journeys table
 */

export interface JourneyTokenPayload {
  claimId: string;
  journeyId: string;
  channel: 'pwa' | 'whatsapp';
  exp: number;  // Unix timestamp
  jti: string;  // Unique token ID for revocation
}

export interface CreateJourneyRequest {
  claimId: string;
  channel: 'pwa' | 'whatsapp';
  sessionMetadata?: Record<string, unknown>;
}

export interface CreateJourneyResult {
  journeyId: string;
  token: string;
  journeyLink: string;
  expiresAt: Date;
}

export interface ValidateTokenResult {
  valid: boolean;
  journey?: Journey;
  error?: string;
}

export class JourneyService {
  private readonly JWT_SECRET: string;
  private readonly TOKEN_EXPIRES_HOURS: number;
  private readonly BASE_URL: string;

  constructor() {
    this.JWT_SECRET = config.security.jwtSecret;
    this.TOKEN_EXPIRES_HOURS = config.assessment.journeyTokenExpiresHours;
    this.BASE_URL = `http://localhost:${config.port}`;
  }

  /**
   * Create a new journey with signed JWT token
   * 
   * @param request - Journey creation parameters
   * @returns Journey result with token and link
   */
  async createJourney(request: CreateJourneyRequest): Promise<CreateJourneyResult> {
    const { claimId, channel, sessionMetadata = {} } = request;

    const journeyId = uuidv4();
    const tokenJti = uuidv4(); // Unique token ID for revocation
    const expiresAt = new Date(Date.now() + this.TOKEN_EXPIRES_HOURS * 60 * 60 * 1000);

    loggers.app.info('Creating journey', {
      claimId,
      journeyId,
      channel,
      expiresAt,
    });

    try {
      // Create JWT token payload
      const payload: JourneyTokenPayload = {
        claimId,
        journeyId,
        channel,
        exp: Math.floor(expiresAt.getTime() / 1000), // Unix timestamp in seconds
        jti: tokenJti,
      };

      // Sign JWT token
      const token = jwt.sign(payload, this.JWT_SECRET);

      // Store journey record in database
      await database.query(
        `
        INSERT INTO journeys (
          journey_id,
          claim_id,
          channel,
          token_jti,
          expires_at,
          session_metadata
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `,
        [journeyId, claimId, channel, tokenJti, expiresAt, JSON.stringify(sessionMetadata)]
      );

      // Generate journey link
      const journeyLink = `${this.BASE_URL}/journey/${token}`;

      // Emit journey.created event
      await eventService.emit({
        eventType: EVENT_TYPES.JOURNEY_CREATED,
        claimId,
        sourceService: 'journey-service',
        actorType: 'system',
        payload: {
          journeyId,
          channel,
          expiresAt: expiresAt.toISOString(),
        },
      });

      loggers.app.info('Journey created successfully', {
        claimId,
        journeyId,
        expiresAt,
      });

      return {
        journeyId,
        token,
        journeyLink,
        expiresAt,
      };
    } catch (error) {
      loggers.app.error('Failed to create journey', error as Error, {
        claimId,
        channel,
      });
      throw error;
    }
  }

  /**
   * Validate journey token and check if journey is active
   * 
   * @param token - JWT token to validate
   * @returns Validation result with journey data if valid
   */
  async validateToken(token: string): Promise<ValidateTokenResult> {
    try {
      // Verify JWT signature and decode payload
      const decoded = jwt.verify(token, this.JWT_SECRET) as JourneyTokenPayload;

      const { claimId, journeyId, jti } = decoded;

      // Retrieve journey from database
      const result = await database.query(
        `
        SELECT 
          id,
          journey_id,
          claim_id,
          channel,
          token_jti,
          expires_at,
          revoked,
          consent_captured,
          consent_captured_at,
          consent_version,
          legal_notice_version,
          session_metadata,
          created_at
        FROM journeys
        WHERE journey_id = $1 AND token_jti = $2
      `,
        [journeyId, jti]
      );

      if (result.rowCount === 0) {
        return {
          valid: false,
          error: 'Journey not found',
        };
      }

      const journey = this.mapRowToJourney(result.rows[0]);

      // Check if token is revoked
      if (journey.revoked) {
        return {
          valid: false,
          error: 'Token has been revoked',
        };
      }

      // Check if token is expired
      if (new Date() > journey.expiresAt) {
        // Mark journey as abandoned
        await this.abandonJourney(journeyId, 'token_expired');
        
        return {
          valid: false,
          error: 'Token has expired',
        };
      }

      return {
        valid: true,
        journey,
      };
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        return {
          valid: false,
          error: 'Invalid token signature',
        };
      }

      if (error instanceof jwt.TokenExpiredError) {
        return {
          valid: false,
          error: 'Token has expired',
        };
      }

      loggers.app.error('Token validation error', error as Error);
      return {
        valid: false,
        error: 'Token validation failed',
      };
    }
  }

  /**
   * Revoke a journey token
   * 
   * @param journeyId - Journey identifier
   * @param reason - Reason for revocation
   */
  async revokeToken(journeyId: string, reason: string): Promise<void> {
    loggers.app.info('Revoking journey token', {
      journeyId,
      reason,
    });

    try {
      await database.query(
        `
        UPDATE journeys
        SET revoked = true
        WHERE journey_id = $1
      `,
        [journeyId]
      );

      loggers.app.info('Journey token revoked', {
        journeyId,
        reason,
      });
    } catch (error) {
      loggers.app.error('Failed to revoke token', error as Error, {
        journeyId,
      });
      throw error;
    }
  }

  /**
   * Mark journey as abandoned
   * 
   * @param journeyId - Journey identifier
   * @param reason - Reason for abandonment
   */
  async abandonJourney(journeyId: string, reason: string): Promise<void> {
    loggers.app.info('Abandoning journey', {
      journeyId,
      reason,
    });

    try {
      // Get journey to retrieve claim ID
      const result = await database.query(
        `
        SELECT claim_id FROM journeys WHERE journey_id = $1
      `,
        [journeyId]
      );

      if (result.rowCount === 0) {
        loggers.app.warn('Journey not found for abandonment', { journeyId });
        return;
      }

      const claimId = result.rows[0].claim_id;

      // Emit claim.abandoned event
      await eventService.emit({
        eventType: EVENT_TYPES.CLAIM_ABANDONED,
        claimId,
        sourceService: 'journey-service',
        actorType: 'system',
        payload: {
          journeyId,
          reason,
          abandonedAt: new Date().toISOString(),
        },
      });

      // Update claim status to abandoned
      await database.query(
        `
        UPDATE claim_inspections
        SET internal_status = 'abandoned', updated_at = NOW()
        WHERE claim_number IN (
          SELECT claim_number FROM claim_inspections WHERE id::text = $1
        )
      `,
        [claimId]
      );

      loggers.app.info('Journey abandoned', {
        journeyId,
        claimId,
        reason,
      });
    } catch (error) {
      loggers.app.error('Failed to abandon journey', error as Error, {
        journeyId,
      });
      throw error;
    }
  }

  /**
   * Record consent capture for a journey
   * 
   * @param journeyId - Journey identifier
   * @param consentVersion - Version of consent captured
   * @param legalNoticeVersion - Version of legal notice shown
   */
  async captureConsent(
    journeyId: string,
    consentVersion: string,
    legalNoticeVersion: string
  ): Promise<void> {
    loggers.app.info('Capturing consent', {
      journeyId,
      consentVersion,
      legalNoticeVersion,
    });

    try {
      const consentCapturedAt = new Date();

      // Update journey with consent information
      await database.query(
        `
        UPDATE journeys
        SET 
          consent_captured = true,
          consent_captured_at = $1,
          consent_version = $2,
          legal_notice_version = $3
        WHERE journey_id = $4
      `,
        [consentCapturedAt, consentVersion, legalNoticeVersion, journeyId]
      );

      // Get claim ID for event emission
      const result = await database.query(
        `
        SELECT claim_id FROM journeys WHERE journey_id = $1
      `,
        [journeyId]
      );

      if (result.rowCount > 0) {
        const claimId = result.rows[0].claim_id;

        // Emit consent.captured event
        await eventService.emit({
          eventType: EVENT_TYPES.CONSENT_CAPTURED,
          claimId,
          sourceService: 'journey-service',
          actorType: 'claimant',
          payload: {
            journeyId,
            consentVersion,
            legalNoticeVersion,
            capturedAt: consentCapturedAt.toISOString(),
          },
        });

        // Update claim consent status
        await database.query(
          `
          UPDATE claim_inspections
          SET consent_captured = true, updated_at = NOW()
          WHERE id::text = $1
        `,
          [claimId]
        );
      }

      loggers.app.info('Consent captured successfully', {
        journeyId,
      });
    } catch (error) {
      loggers.app.error('Failed to capture consent', error as Error, {
        journeyId,
      });
      throw error;
    }
  }

  /**
   * Get journey by ID
   * 
   * @param journeyId - Journey identifier
   * @returns Journey data or null if not found
   */
  async getJourney(journeyId: string): Promise<Journey | null> {
    try {
      const result = await database.query(
        `
        SELECT 
          id,
          journey_id,
          claim_id,
          channel,
          token_jti,
          expires_at,
          revoked,
          consent_captured,
          consent_captured_at,
          consent_version,
          legal_notice_version,
          session_metadata,
          created_at
        FROM journeys
        WHERE journey_id = $1
      `,
        [journeyId]
      );

      if (result.rowCount === 0) {
        return null;
      }

      return this.mapRowToJourney(result.rows[0]);
    } catch (error) {
      loggers.app.error('Failed to get journey', error as Error, {
        journeyId,
      });
      throw error;
    }
  }

  /**
   * Get all journeys for a claim
   * 
   * @param claimId - Claim identifier
   * @returns Array of journeys
   */
  async getClaimJourneys(claimId: string): Promise<Journey[]> {
    try {
      const result = await database.query(
        `
        SELECT 
          id,
          journey_id,
          claim_id,
          channel,
          token_jti,
          expires_at,
          revoked,
          consent_captured,
          consent_captured_at,
          consent_version,
          legal_notice_version,
          session_metadata,
          created_at
        FROM journeys
        WHERE claim_id = $1
        ORDER BY created_at DESC
      `,
        [claimId]
      );

      return result.rows.map((row: any) => this.mapRowToJourney(row));
    } catch (error) {
      loggers.app.error('Failed to get claim journeys', error as Error, {
        claimId,
      });
      throw error;
    }
  }

  /**
   * Map database row to Journey object
   */
  private mapRowToJourney(row: any): Journey {
    return {
      id: row.id,
      journeyId: row.journey_id,
      claimId: row.claim_id,
      channel: row.channel,
      tokenJti: row.token_jti,
      expiresAt: row.expires_at,
      revoked: row.revoked,
      consentCaptured: row.consent_captured,
      consentCapturedAt: row.consent_captured_at,
      consentVersion: row.consent_version,
      legalNoticeVersion: row.legal_notice_version,
      sessionMetadata: row.session_metadata,
      createdAt: row.created_at,
    };
  }
}

// Export singleton instance
export const journeyService = new JourneyService();
