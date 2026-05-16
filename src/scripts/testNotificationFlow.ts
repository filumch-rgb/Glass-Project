/**
 * Test script for automatic notification flow
 * 
 * This script tests the complete flow:
 * 1. Claim creation from email intake
 * 2. Automatic journey creation
 * 3. Automatic SMS notification with retry logic
 */

import { EmailIntakeService, ClaimEmail, ParsedIntakeFields } from '../services/emailIntakeService';
import { database } from '../config/database';
import { loggers } from '../utils/logger';

async function testNotificationFlow() {
  try {
    loggers.app.info('Starting notification flow test');

    // Test data
    const claimEmail: ClaimEmail = {
      messageId: `test-${Date.now()}@example.com`,
      subject: 'Test Claim',
      body: 'Test email body',
      receivedAt: new Date(),
      sourceMetadata: {
        from: 'test@insurer.com',
        to: 'glassscans769@gmail.com',
      },
    };

    const fields: ParsedIntakeFields = {
      insurerName: 'Test Insurance Co',
      claimNumber: `TEST-${Date.now()}`,
      policyholderName: 'John Test',
      policyholderMobile: '+1234567890', // Replace with real number for actual test
      policyholderEmail: 'john.test@example.com',
      insurerProvidedVin: '1HGBH41JXMN109186',
    };

    loggers.app.info('Creating claim with automatic notification', {
      claimNumber: fields.claimNumber,
    });

    // Create claim (this will automatically trigger journey creation and notification)
    const result = await EmailIntakeService.createClaim(claimEmail, fields);

    loggers.app.info('Claim created successfully', {
      claimId: result.claimId,
      intakeKey: result.intakeKey,
      internalStatus: result.internalStatus,
    });

    // Wait a moment for async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Query the database to verify notification was sent
    const notificationResult = await database.query(
      `
      SELECT 
        channel,
        provider_message_id,
        sent_at,
        status,
        error_details
      FROM notification_deliveries
      WHERE claim_id = $1
      ORDER BY sent_at DESC
      LIMIT 1
    `,
      [result.claimId]
    );

    if (notificationResult.rowCount > 0) {
      const notification = notificationResult.rows[0];
      loggers.app.info('Notification delivery record found', {
        channel: notification.channel,
        status: notification.status,
        providerMessageId: notification.provider_message_id,
        sentAt: notification.sent_at,
      });

      if (notification.status === 'sent') {
        loggers.app.info('✅ Notification sent successfully!');
      } else {
        loggers.app.error('❌ Notification failed', new Error('Notification not sent'), {
          errorDetails: notification.error_details,
        });
      }
    } else {
      loggers.app.warn('⚠️  No notification delivery record found');
    }

    // Query journey to verify it was created
    const journeyResult = await database.query(
      `
      SELECT 
        journey_id,
        channel,
        expires_at,
        created_at
      FROM journeys
      WHERE claim_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
      [result.claimId]
    );

    if (journeyResult.rowCount > 0) {
      const journey = journeyResult.rows[0];
      loggers.app.info('Journey record found', {
        journeyId: journey.journey_id,
        channel: journey.channel,
        expiresAt: journey.expires_at,
      });
      loggers.app.info('✅ Journey created successfully!');
    } else {
      loggers.app.warn('⚠️  No journey record found');
    }

    loggers.app.info('Test completed successfully');
  } catch (error) {
    loggers.app.error('Test failed', error as Error);
    throw error;
  } finally {
    await database.close();
  }
}

// Run the test
testNotificationFlow().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
