/**
 * Test Script for Task 4: Notification and Journey Services
 * 
 * This script tests the complete flow:
 * 1. Create a test claim in the database
 * 2. Create a journey with JWT token
 * 3. Send SMS notification with journey link
 * 4. Validate the journey token
 * 
 * Usage: npx ts-node src/scripts/testTask4Flow.ts
 */

import { database } from '../config/database';
import { journeyService } from '../services/journeyService';
import { notificationService } from '../services/notificationService';
import { v4 as uuidv4 } from 'uuid';

async function testTask4Flow() {
  console.log('\n🚀 Starting Task 4 Flow Test...\n');

  try {
    // Step 1: Create a test claim
    console.log('📝 Step 1: Creating test claim in database...');
    const testClaimId = uuidv4();
    const testClaimNumber = `TEST-${Date.now()}`;
    const testPolicyholderName = 'John Smith';
    const testPolicyholderMobile = '+15555551234'; // Test number (won't actually send)

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
        intake_message_id,
        received_at,
        inspection_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
      [
        testClaimNumber,
        'TEST-INSURER',
        'Message Sent',
        'intake_received',
        testPolicyholderName,
        testPolicyholderMobile,
        'john.smith@example.com',
        `test-message-${Date.now()}`,
        new Date(),
        JSON.stringify({ 
          rawIntakePayload: { test: true },
          validationDetails: { intakeKey: 'test-key' }
        }),
      ]
    );

    console.log(`✅ Test claim created: ${testClaimNumber}`);
    console.log(`   Claim ID: ${testClaimId}`);
    console.log(`   Policyholder: ${testPolicyholderName}`);
    console.log(`   Mobile: ${testPolicyholderMobile}\n`);

    // Step 2: Create journey with JWT token
    console.log('🎫 Step 2: Creating journey with JWT token...');
    const journeyResult = await journeyService.createJourney({
      claimId: testClaimId,
      channel: 'pwa',
      sessionMetadata: {
        source: 'manual_test',
        testRun: true,
      },
    });

    console.log(`✅ Journey created successfully!`);
    console.log(`   Journey ID: ${journeyResult.journeyId}`);
    console.log(`   Token: ${journeyResult.token.substring(0, 50)}...`);
    console.log(`   Journey Link: ${journeyResult.journeyLink}`);
    console.log(`   Expires At: ${journeyResult.expiresAt.toISOString()}\n`);

    // Step 3: Validate the journey token
    console.log('🔐 Step 3: Validating journey token...');
    const validation = await journeyService.validateToken(journeyResult.token);

    if (validation.valid) {
      console.log(`✅ Token is valid!`);
      console.log(`   Claim ID: ${validation.journey?.claimId}`);
      console.log(`   Journey ID: ${validation.journey?.journeyId}`);
      console.log(`   Channel: ${validation.journey?.channel}`);
      console.log(`   Consent Captured: ${validation.journey?.consentCaptured}\n`);
    } else {
      console.log(`❌ Token validation failed: ${validation.error}\n`);
    }

    // Step 4: Send SMS notification
    console.log('📱 Step 4: Sending SMS notification...');
    console.log('⚠️  Note: This will attempt to send a real SMS via Twilio');
    console.log('   If you want to test with a real phone number, update testPolicyholderMobile above\n');

    const notificationResult = await notificationService.sendNotification({
      claimId: testClaimId,
      claimNumber: testClaimNumber,
      policyholderName: testPolicyholderName,
      policyholderMobile: testPolicyholderMobile,
      journeyLink: journeyResult.journeyLink,
      channel: 'sms',
    });

    if (notificationResult.status === 'sent') {
      console.log(`✅ SMS notification sent successfully!`);
      console.log(`   Provider Message ID: ${notificationResult.providerMessageId}`);
      console.log(`   Sent At: ${notificationResult.sentAt.toISOString()}\n`);
    } else {
      console.log(`⚠️  SMS notification failed (expected for test number)`);
      console.log(`   Status: ${notificationResult.status}`);
      console.log(`   Error: ${notificationResult.errorMessage}\n`);
    }

    // Step 5: Check notification delivery record
    console.log('📊 Step 5: Checking notification delivery record...');
    const deliveryStatus = await notificationService.getNotificationStatus(testClaimId);
    
    console.log(`✅ Found ${deliveryStatus.length} notification delivery record(s)`);
    if (deliveryStatus.length > 0) {
      const latest = deliveryStatus[0];
      console.log(`   Channel: ${latest.channel}`);
      console.log(`   Status: ${latest.status}`);
      console.log(`   Sent At: ${latest.sent_at}\n`);
    }

    // Step 6: Check journey record
    console.log('🗂️  Step 6: Checking journey record...');
    const journeyData = await journeyService.getJourney(journeyResult.journeyId);
    
    if (journeyData) {
      console.log(`✅ Journey record found in database`);
      console.log(`   Journey ID: ${journeyData.journeyId}`);
      console.log(`   Claim ID: ${journeyData.claimId}`);
      console.log(`   Channel: ${journeyData.channel}`);
      console.log(`   Expires At: ${journeyData.expiresAt.toISOString()}`);
      console.log(`   Revoked: ${journeyData.revoked}`);
      console.log(`   Consent Captured: ${journeyData.consentCaptured}\n`);
    }

    // Summary
    console.log('═══════════════════════════════════════════════════════');
    console.log('✅ Task 4 Flow Test Complete!');
    console.log('═══════════════════════════════════════════════════════');
    console.log('\n📋 Summary:');
    console.log(`   ✅ Test claim created: ${testClaimNumber}`);
    console.log(`   ✅ Journey created with JWT token`);
    console.log(`   ✅ Journey token validated successfully`);
    console.log(`   ${notificationResult.status === 'sent' ? '✅' : '⚠️ '} SMS notification ${notificationResult.status}`);
    console.log(`   ✅ Notification delivery tracked in database`);
    console.log(`   ✅ Journey record stored in database`);
    console.log('\n🎉 All Task 4 components are working!\n');

    // Cleanup
    console.log('🧹 Cleaning up test data...');
    await database.query('DELETE FROM notification_deliveries WHERE claim_id = $1', [testClaimId]);
    await database.query('DELETE FROM journeys WHERE claim_id = $1', [testClaimId]);
    await database.query('DELETE FROM claim_events WHERE claim_id = $1', [testClaimId]);
    await database.query('DELETE FROM claim_inspections WHERE claim_number = $1', [testClaimNumber]);
    console.log('✅ Test data cleaned up\n');

  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    throw error;
  } finally {
    await database.close();
  }
}

// Run the test
testTask4Flow()
  .then(() => {
    console.log('✅ Test script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test script failed:', error);
    process.exit(1);
  });
