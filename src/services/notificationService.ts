import twilio from 'twilio';
import { config } from '../config';
import { loggers } from '../utils/logger';
import { database } from '../config/database';
import { eventService, EVENT_TYPES } from './eventService';

/**
 * Notification Service for Glass Claim Assessment System
 * Handles SMS and WhatsApp notifications via Twilio
 * 
 * Features:
 * - SMS notification via Twilio
 * - WhatsApp Business API integration (placeholder for now)
 * - Notification delivery tracking in notification_deliveries table
 * - Sends notification after claim is created with journey link
 */

export interface NotificationRequest {
  claimId: string;
  claimNumber: string;
  policyholderName: string;
  policyholderMobile: string;
  journeyLink: string;
  channel: 'sms' | 'whatsapp';
}

export interface NotificationResult {
  claimId: string;
  channel: 'sms' | 'whatsapp';
  sentAt: Date;
  providerMessageId?: string;
  status: 'sent' | 'failed';
  errorMessage?: string;
}

export class NotificationService {
  private twilioClient: twilio.Twilio | null = null;

  constructor() {
    // Initialize Twilio client if credentials are available
    const { accountSid, authToken } = config.notifications.twilio;
    
    if (accountSid && authToken) {
      this.twilioClient = twilio(accountSid, authToken);
      loggers.app.info('Twilio client initialized');
    } else {
      loggers.app.warn('Twilio credentials not configured - notifications will fail');
    }
  }

  /**
   * Send notification to policyholder with journey link
   * 
   * @param request - Notification request parameters
   * @returns Notification result with delivery status
   */
  async sendNotification(request: NotificationRequest): Promise<NotificationResult> {
    const { claimId, claimNumber, policyholderName, policyholderMobile, journeyLink, channel } = request;

    loggers.app.info('Sending notification', {
      claimId,
      channel,
      mobile: this.maskPhoneNumber(policyholderMobile),
    });

    try {
      let result: NotificationResult;

      if (channel === 'sms') {
        result = await this.sendSMS(request);
      } else {
        result = await this.sendWhatsApp(request);
      }

      // Store notification delivery record
      await this.storeNotificationDelivery(result);

      // Emit notification.sent event
      await eventService.emit({
        eventType: EVENT_TYPES.NOTIFICATION_SENT,
        claimId,
        sourceService: 'notification-service',
        actorType: 'system',
        payload: {
          channel,
          status: result.status,
          providerMessageId: result.providerMessageId,
        },
      });

      loggers.app.info('Notification sent successfully', {
        claimId,
        channel,
        status: result.status,
        providerMessageId: result.providerMessageId,
      });

      return result;
    } catch (error) {
      loggers.app.error('Failed to send notification', error as Error, {
        claimId,
        channel,
      });

      const failedResult: NotificationResult = {
        claimId,
        channel,
        sentAt: new Date(),
        status: 'failed',
        errorMessage: (error as Error).message,
      };

      // Store failed notification record
      await this.storeNotificationDelivery(failedResult);

      return failedResult;
    }
  }

  /**
   * Send SMS notification via Twilio
   */
  private async sendSMS(request: NotificationRequest): Promise<NotificationResult> {
    const { claimId, claimNumber, policyholderName, policyholderMobile, journeyLink } = request;

    if (!this.twilioClient) {
      throw new Error('Twilio client not initialized - check credentials');
    }

    const { phoneNumber } = config.notifications.twilio;
    if (!phoneNumber) {
      throw new Error('Twilio phone number not configured');
    }

    // Compose SMS message
    const message = this.composeSMSMessage(policyholderName, claimNumber, journeyLink);

    // Send SMS via Twilio
    const twilioMessage = await this.twilioClient.messages.create({
      body: message,
      from: phoneNumber,
      to: policyholderMobile,
    });

    return {
      claimId,
      channel: 'sms',
      sentAt: new Date(),
      providerMessageId: twilioMessage.sid,
      status: 'sent',
    };
  }

  /**
   * Send WhatsApp notification via Twilio WhatsApp Business API
   * Currently a placeholder - will be implemented when WhatsApp API is configured
   */
  private async sendWhatsApp(request: NotificationRequest): Promise<NotificationResult> {
    const { claimId, claimNumber, policyholderName, policyholderMobile, journeyLink } = request;

    if (!this.twilioClient) {
      throw new Error('Twilio client not initialized - check credentials');
    }

    const { phoneNumber } = config.notifications.twilio;
    if (!phoneNumber) {
      throw new Error('Twilio phone number not configured');
    }

    // Compose WhatsApp message
    const message = this.composeWhatsAppMessage(policyholderName, claimNumber, journeyLink);

    // Send WhatsApp message via Twilio
    // WhatsApp numbers must be prefixed with 'whatsapp:'
    const twilioMessage = await this.twilioClient.messages.create({
      body: message,
      from: `whatsapp:${phoneNumber}`,
      to: `whatsapp:${policyholderMobile}`,
    });

    return {
      claimId,
      channel: 'whatsapp',
      sentAt: new Date(),
      providerMessageId: twilioMessage.sid,
      status: 'sent',
    };
  }

  /**
   * Compose SMS message with journey link
   */
  private composeSMSMessage(policyholderName: string, claimNumber: string, journeyLink: string): string {
    return `Hi ${policyholderName},

Your glass claim ${claimNumber} has been received. Please click the link below to upload photos of the damage:

${journeyLink}

This link expires in 24 hours. If you have any questions, please contact our support team.

Thank you!`;
  }

  /**
   * Compose WhatsApp message with journey link
   */
  private composeWhatsAppMessage(policyholderName: string, claimNumber: string, journeyLink: string): string {
    return `Hi ${policyholderName},

Your glass claim *${claimNumber}* has been received. Please click the link below to upload photos of the damage:

${journeyLink}

This link expires in 24 hours. If you have any questions, please contact our support team.

Thank you!`;
  }

  /**
   * Store notification delivery record in database
   */
  private async storeNotificationDelivery(result: NotificationResult): Promise<void> {
    const { claimId, channel, sentAt, providerMessageId, status, errorMessage } = result;

    await database.query(
      `
      INSERT INTO notification_deliveries (
        claim_id,
        channel,
        provider_message_id,
        sent_at,
        status,
        error_details
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `,
      [
        claimId,
        channel,
        providerMessageId || null,
        sentAt,
        status,
        errorMessage ? JSON.stringify({ error: errorMessage }) : null,
      ]
    );
  }

  /**
   * Mask phone number for logging (PII-safe)
   */
  private maskPhoneNumber(phoneNumber: string): string {
    if (phoneNumber.length <= 4) {
      return '****';
    }
    return phoneNumber.slice(0, -4).replace(/./g, '*') + phoneNumber.slice(-4);
  }

  /**
   * Get notification delivery status for a claim
   */
  async getNotificationStatus(claimId: string): Promise<any[]> {
    const result = await database.query(
      `
      SELECT 
        id,
        claim_id,
        channel,
        provider_message_id,
        sent_at,
        delivered_at,
        opened_at,
        status,
        error_details
      FROM notification_deliveries
      WHERE claim_id = $1
      ORDER BY sent_at DESC
    `,
      [claimId]
    );

    return result.rows;
  }
}

// Export singleton instance
export const notificationService = new NotificationService();
