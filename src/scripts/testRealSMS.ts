/**
 * Test Script: Send Real SMS to Your Phone
 * 
 * This will send an actual SMS to your verified phone number
 * Make sure to update YOUR_PHONE_NUMBER below
 * 
 * Usage: npx ts-node src/scripts/testRealSMS.ts
 */

import { database } from '../config/database';
import { journeyService } from '../services/journeyService';
import { notificationService } from '../services/notificationService';
import { v4 as uuidv4 } from 'uuid';

async function testRealSMS() {
  console.log('\n📱 Testing Real SMS Notification...\n');

  // ⚠️ UPDATE THIS WITH YOUR VERIFIED PHONE NUMBER
  const YOUR_PHONE_NUMBER = '+27824141221'; // Format: +1234567890 (include country code)

  try {
    const testClaimId = uuidv4();
    const testClaimNumber = `REAL-TEST-${Date.now()}`;

    // Create journey
    console.log('🎫 Creating journey...');
    const journeyResult = await journeyService.createJourney({
      claimId: testClaimId,
      channel: 'pwa',
    });

    console.log(`✅ Journey created: ${journeyResult.journeyLink}\n`);

    // Send SMS
    console.log(`📱 Sending SMS to ${YOUR_PHONE_NUMBER}...`);
    const notificationResult = await notificationService.sendNotification({
      claimId: testClaimId,
      claimNumber: testClaimNumber,
      policyholderName: 'Test User',
      policyholderMobile: YOUR_PHONE_NUMBER,
      journeyLink: journeyResult.journeyLink,
      channel: 'sms',
    });

    if (notificationResult.status === 'sent') {
      console.log('\n✅ SMS SENT SUCCESSFULLY!');
      console.log(`   Check your phone: ${YOUR_PHONE_NUMBER}`);
      console.log(`   Message ID: ${notificationResult.providerMessageId}`);
      console.log(`\n📱 You should receive an SMS with the journey link!`);
    } else {
      console.log('\n❌ SMS failed to send');
      console.log(`   Error: ${notificationResult.errorMessage}`);
    }

    // Cleanup
    console.log('\n🧹 Cleaning up...');
    await database.query('DELETE FROM notification_deliveries WHERE claim_id = $1', [testClaimId]);
    await database.query('DELETE FROM journeys WHERE claim_id = $1', [testClaimId]);
    await database.query('DELETE FROM claim_events WHERE claim_id = $1', [testClaimId]);

  } catch (error) {
    console.error('\n❌ Error:', error);
  } finally {
    await database.close();
  }
}

testRealSMS();
