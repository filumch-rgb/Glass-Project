import { ImapFlow, FetchMessageObject } from 'imapflow';
import * as cron from 'node-cron';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { database } from '../config/database';
import { loggers } from '../utils/logger';
import { EventService, EVENT_TYPES } from './eventService';
import { StatusService } from './statusService';
import { InternalStatus } from '../types';

/**
 * Email Intake Service for Glass Claim Assessment System
 * 
 * Polls IMAP inbox every 15 minutes for ALL emails (no subject requirement),
 * parses key:value format, validates fields, creates claims,
 * and moves emails to Completed/Failed folders.
 * 
 * Updated: Removed subject line requirement, made email and VIN mandatory
 */

export interface ParsedIntakeFields {
  insurerName: string;
  claimNumber: string;
  policyholderName: string;
  policyholderMobile: string;
  policyholderEmail: string;  // Now mandatory
  insurerProvidedVin: string;  // Now mandatory (was optional)
}

export interface ClaimEmail {
  messageId: string;
  subject: string;
  body: string;
  receivedAt: Date;
  sourceMetadata: Record<string, string>;
}

export interface ClaimCreationResult {
  claimId: string;
  intakeKey: string;
  internalStatus: InternalStatus;
  parseErrors?: string[];
}

export class EmailIntakeService {
  private cronJob: cron.ScheduledTask | null = null;
  private isPolling: boolean = false;

  /**
   * Generate intake key for idempotency
   * Uses sha256(messageId + claimNumber)
   * Public for testing
   */
  static generateIntakeKey(messageId: string, claimNumber: string): string {
    const data = `${messageId}:${claimNumber}`;
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Parse email body in key:value format
   * Expected format:
   * Insurer Name: ABC Insurance
   * Claim Number: CLM-2024-001234
   * ...
   * Public for testing
   */
  static parseEmailBody(body: string): Partial<ParsedIntakeFields> {
    const lines = body.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const parsed: Partial<ParsedIntakeFields> = {};

    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const key = line.substring(0, colonIndex).trim().toLowerCase();
      const value = line.substring(colonIndex + 1).trim();

      if (!value) continue;

      switch (key) {
        case 'insurer name':
          parsed.insurerName = value;
          break;
        case 'claim number':
          parsed.claimNumber = value;
          break;
        case 'policyholder name':
          parsed.policyholderName = value;
          break;
        case 'policyholder mobile':
          parsed.policyholderMobile = value;
          break;
        case 'policyholder email':
          parsed.policyholderEmail = value;
          break;
        case 'vin':
        case 'insurer provided vin':
          parsed.insurerProvidedVin = value;
          break;
      }
    }

    return parsed;
  }

  /**
   * Validate parsed intake fields
   * Returns array of validation errors (empty if valid)
   * 
   * Required fields:
   * - Insurer Name
   * - Claim Number
   * - Policyholder Name
   * - Policyholder Mobile
   * - Policyholder Email (now mandatory)
   * - VIN (now mandatory)
   * 
   * Public for testing
   */
  static validateIntakeFields(fields: Partial<ParsedIntakeFields>): string[] {
    const errors: string[] = [];
    const requiredFields: (keyof ParsedIntakeFields)[] = [
      'insurerName',
      'claimNumber',
      'policyholderName',
      'policyholderMobile',
      'policyholderEmail',
      'insurerProvidedVin',
    ];

    for (const field of requiredFields) {
      if (!fields[field]) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    return errors;
  }

  /**
   * Check if claim already exists (idempotency check)
   * Checks both database and IMAP Completed folder
   * Public for testing
   */
  static async claimExists(intakeKey: string, messageId: string): Promise<boolean> {
    // Check database
    const result = await database.query(
      'SELECT 1 FROM claim_inspections WHERE intake_message_id = $1 LIMIT 1',
      [messageId]
    );

    if (result.rowCount > 0) {
      loggers.app.debug('Claim already exists in database', { intakeKey, messageId });
      return true;
    }

    return false;
  }

  /**
   * Derive external status from internal status
   * Uses StatusService to ensure consistency
   * Public for testing
   */
  static deriveExternalStatus(internalStatus: InternalStatus): string {
    return StatusService.deriveExternalStatus(internalStatus);
  }

  /**
   * Create claim record in database
   * Public for testing
   */
  static async createClaim(
    claimEmail: ClaimEmail,
    fields: ParsedIntakeFields
  ): Promise<ClaimCreationResult> {
    const claimId = uuidv4();
    const intakeKey = this.generateIntakeKey(claimEmail.messageId, fields.claimNumber);
    const internalStatus: InternalStatus = 'intake_received';
    const externalStatus = this.deriveExternalStatus(internalStatus);

    // Derive insurer_id from insurer name (simple slug for now)
    const insurerId = fields.insurerName.toLowerCase().replace(/\s+/g, '-');

    const inspectionData = {
      rawIntakePayload: {
        ...fields,
        messageId: claimEmail.messageId,
        subject: claimEmail.subject,
        receivedAt: claimEmail.receivedAt.toISOString(),
      },
      validationDetails: {
        intakeKey,
        validatedAt: new Date().toISOString(),
      },
    };

    try {
      await database.query(
        `
        INSERT INTO claim_inspections (
          claim_number,
          insurer_id,
          external_status,
          internal_status,
          policyholder_name,
          policyholder_mobile,
          policyholder_email,
          insurer_provided_vin,
          intake_message_id,
          received_at,
          consent_captured,
          inspection_data
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
        [
          fields.claimNumber,
          insurerId,
          externalStatus,
          internalStatus,
          fields.policyholderName,
          fields.policyholderMobile,
          fields.policyholderEmail,
          fields.insurerProvidedVin,
          claimEmail.messageId,
          claimEmail.receivedAt,
          false, // consent_captured
          JSON.stringify(inspectionData),
        ]
      );

      // Emit intake_received event
      await EventService.emit({
        eventType: EVENT_TYPES.INTAKE_RECEIVED,
        claimId,
        sourceService: 'email-intake',
        actorType: 'system',
        payload: {
          claimNumber: fields.claimNumber,
          insurerId: insurerId,
          insurerName: fields.insurerName,
          intakeKey,
        },
      });

      loggers.app.info('Claim created successfully', {
        claimId,
        claimNumber: fields.claimNumber,
        insurerId: insurerId,
        insurerName: fields.insurerName,
      });

      return {
        claimId,
        intakeKey,
        internalStatus,
      };
    } catch (error) {
      loggers.app.error('Failed to create claim', error as Error, {
        claimNumber: fields.claimNumber,
      });
      throw error;
    }
  }

  /**
   * Process a single email
   */
  private static async processEmail(client: ImapFlow, message: FetchMessageObject): Promise<void> {
    const messageId = message.envelope?.messageId || `${message.uid}`;
    const subject = message.envelope?.subject || '';
    
    // Extract body text from source
    let body = '';
    if (message.source) {
      const sourceText = message.source.toString();
      // Simple extraction - look for the body after headers
      const bodyStartIndex = sourceText.indexOf('\r\n\r\n');
      if (bodyStartIndex !== -1) {
        body = sourceText.substring(bodyStartIndex + 4).trim();
      } else {
        body = sourceText;
      }
    }
    
    const receivedAt = message.envelope?.date || new Date();

    loggers.app.debug('Processing email', { messageId, subject });

    // Parse email body
    const parsed = this.parseEmailBody(body);
    const validationErrors = this.validateIntakeFields(parsed);

    if (validationErrors.length > 0) {
      loggers.app.warn('Email validation failed', { messageId, validationErrors });

      // Move to Failed folder
      await client.messageMove(message.uid, config.imap.failedFolder);

      // Emit intake_failed event
      await EventService.emit({
        eventType: EVENT_TYPES.INTAKE_FAILED,
        claimId: 'unknown',
        sourceService: 'email-intake',
        actorType: 'system',
        payload: {
          messageId,
          validationErrors,
        },
      });

      return;
    }

    const fields = parsed as ParsedIntakeFields;
    const intakeKey = this.generateIntakeKey(messageId, fields.claimNumber);

    // Check idempotency
    const exists = await this.claimExists(intakeKey, messageId);
    if (exists) {
      loggers.app.info('Claim already processed (idempotency)', { intakeKey, messageId });
      // Move to Completed folder (already processed)
      await client.messageMove(message.uid, config.imap.completedFolder);
      return;
    }

    // Create claim
    const claimEmail: ClaimEmail = {
      messageId,
      subject,
      body,
      receivedAt,
      sourceMetadata: {
        from: message.envelope?.from?.[0]?.address || '',
        to: message.envelope?.to?.[0]?.address || '',
      },
    };

    try {
      await this.createClaim(claimEmail, fields);

      // Move to Completed folder
      await client.messageMove(message.uid, config.imap.completedFolder);

      loggers.app.info('Email processed successfully', { messageId, intakeKey });
    } catch (error) {
      loggers.app.error('Failed to process email', error as Error, { messageId });

      // Move to Failed folder
      await client.messageMove(message.uid, config.imap.failedFolder);
    }
  }

  /**
   * Poll IMAP inbox for new emails
   * Processes ALL emails in inbox (no subject line requirement)
   */
  private static async pollInbox(): Promise<void> {
    const client = new ImapFlow({
      host: config.imap.host,
      port: config.imap.port,
      secure: true,
      auth: {
        user: config.imap.user,
        pass: config.imap.password,
      },
      logger: false,
    });

    try {
      await client.connect();
      loggers.app.debug('Connected to IMAP server');

      // Ensure folders exist
      try {
        await client.mailboxCreate(config.imap.completedFolder);
      } catch (error) {
        // Folder might already exist
      }

      try {
        await client.mailboxCreate(config.imap.failedFolder);
      } catch (error) {
        // Folder might already exist
      }

      // Select inbox
      await client.mailboxOpen(config.imap.mailbox);

      // Search for ALL unseen/unprocessed emails (no subject requirement)
      const messages = await client.search({ seen: false });

      if (!messages || (Array.isArray(messages) && messages.length === 0)) {
        loggers.app.debug('No new emails found');
        return;
      }

      const messageArray = Array.isArray(messages) ? messages : [];
      loggers.app.info('Found new emails to process', { count: messageArray.length });

      // Process each message
      for await (const message of client.fetch(messageArray, {
        envelope: true,
        bodyStructure: true,
        source: true,
      })) {
        await this.processEmail(client, message);
      }
    } catch (error) {
      loggers.app.error('IMAP polling failed', error as Error);
    } finally {
      await client.logout();
      loggers.app.debug('Disconnected from IMAP server');
    }
  }

  /**
   * Start the email intake poller with cron schedule
   * Runs every 15 minutes by default
   */
  start(): void {
    if (this.cronJob) {
      loggers.app.warn('Email intake poller already running');
      return;
    }

    // Cron expression: every 15 minutes
    const cronExpression = `*/${config.imap.pollIntervalMinutes} * * * *`;

    this.cronJob = cron.schedule(cronExpression, async () => {
      if (this.isPolling) {
        loggers.app.debug('Previous poll still in progress, skipping');
        return;
      }

      this.isPolling = true;
      try {
        loggers.app.info('Starting email intake poll');
        await EmailIntakeService.pollInbox();
        loggers.app.info('Email intake poll completed');
      } catch (error) {
        loggers.app.error('Email intake poll failed', error as Error);
      } finally {
        this.isPolling = false;
      }
    });

    loggers.app.info('Email intake poller started', {
      interval: `${config.imap.pollIntervalMinutes} minutes`,
    });
  }

  /**
   * Stop the email intake poller
   */
  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      loggers.app.info('Email intake poller stopped');
    }
  }

  /**
   * Manually trigger a poll (for testing)
   */
  async triggerPoll(): Promise<void> {
    if (this.isPolling) {
      throw new Error('Poll already in progress');
    }

    this.isPolling = true;
    try {
      await EmailIntakeService.pollInbox();
    } finally {
      this.isPolling = false;
    }
  }
}

// Export singleton instance
export const emailIntakeService = new EmailIntakeService();
