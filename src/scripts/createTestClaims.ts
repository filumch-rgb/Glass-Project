/**
 * Create Test Claims for Dashboard Demo
 * 
 * This script creates realistic test claims with various statuses,
 * confidence levels, and decisions to showcase the dashboard.
 */

import { database } from '../config/database';
import { loggers } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

interface TestClaim {
  claimNumber: string;
  insurerId: string;
  insurerName: string;
  policyholderName: string;
  policyholderMobile: string;
  policyholderEmail: string;
  insurerProvidedVin: string;
  internalStatus: string;
  externalStatus: string;
  receivedAt: Date;
  decision?: {
    outcome: string;
    decisionEligible: boolean;
    confidenceSummary: Record<string, number>;
    blockingReasons: string[];
    justification?: string;
  };
}

const testClaims: TestClaim[] = [
  // High confidence - Repair
  {
    claimNumber: 'CLM-2024-001',
    insurerId: 'abc-insurance',
    insurerName: 'ABC Insurance',
    policyholderName: 'John Smith',
    policyholderMobile: '+27821234567',
    policyholderEmail: 'john.smith@example.com',
    insurerProvidedVin: '1HGBH41JXMN109186',
    internalStatus: 'decision_complete',
    externalStatus: 'Result Ready',
    receivedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
    decision: {
      outcome: 'repair',
      decisionEligible: true,
      confidenceSummary: {
        damageAnalysis: 0.92,
        vinEnrichment: 0.88,
        photoQuality: 0.95,
      },
      blockingReasons: [],
      justification: 'Repair: Bullseye ~0.7" diameter, outside DPVA',
    },
  },
  // High confidence - Replace
  {
    claimNumber: 'CLM-2024-002',
    insurerId: 'xyz-insurance',
    insurerName: 'XYZ Insurance',
    policyholderName: 'Sarah Johnson',
    policyholderMobile: '+27829876543',
    policyholderEmail: 'sarah.j@example.com',
    insurerProvidedVin: '2HGBH41JXMN109187',
    internalStatus: 'decision_complete',
    externalStatus: 'Result Ready',
    receivedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
    decision: {
      outcome: 'replace',
      decisionEligible: true,
      confidenceSummary: {
        damageAnalysis: 0.89,
        vinEnrichment: 0.91,
        photoQuality: 0.87,
      },
      blockingReasons: [],
      justification: 'Replace: Star break ~3.5" diameter, outside DPVA — exceeds repairable size',
    },
  },
  // Medium confidence - Repair (should show yellow badge)
  {
    claimNumber: 'CLM-2024-003',
    insurerId: 'abc-insurance',
    insurerName: 'ABC Insurance',
    policyholderName: 'Michael Brown',
    policyholderMobile: '+27825551234',
    policyholderEmail: 'michael.b@example.com',
    insurerProvidedVin: '3HGBH41JXMN109188',
    internalStatus: 'decision_complete',
    externalStatus: 'Result Ready',
    receivedAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3 hours ago
    decision: {
      outcome: 'repair',
      decisionEligible: true,
      confidenceSummary: {
        damageAnalysis: 0.68,
        vinEnrichment: 0.72,
        photoQuality: 0.65,
      },
      blockingReasons: [],
      justification: 'Repair: Crack ~5" long, outside DPVA',
    },
  },
  // Low confidence - Manual Review (should show red badge and be flagged)
  {
    claimNumber: 'CLM-2024-004',
    insurerId: 'xyz-insurance',
    insurerName: 'XYZ Insurance',
    policyholderName: 'Emily Davis',
    policyholderMobile: '+27827778888',
    policyholderEmail: 'emily.d@example.com',
    insurerProvidedVin: '4HGBH41JXMN109189',
    internalStatus: 'awaiting_manual_review',
    externalStatus: 'Processing',
    receivedAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
    decision: {
      outcome: 'needs_manual_review',
      decisionEligible: false,
      confidenceSummary: {
        damageAnalysis: 0.52,
        vinEnrichment: 0.58,
        photoQuality: 0.48,
      },
      blockingReasons: ['Low confidence in damage assessment', 'Unclear photo quality'],
      justification: 'Decision cannot be automated. Blocking reasons: Confidence thresholds not met',
    },
  },
  // Photos in progress
  {
    claimNumber: 'CLM-2024-005',
    insurerId: 'abc-insurance',
    insurerName: 'ABC Insurance',
    policyholderName: 'David Wilson',
    policyholderMobile: '+27823334444',
    policyholderEmail: 'david.w@example.com',
    insurerProvidedVin: '5HGBH41JXMN109190',
    internalStatus: 'awaiting_photos',
    externalStatus: 'Photos In Progress',
    receivedAt: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
  },
  // Just received - Message sent
  {
    claimNumber: 'CLM-2024-006',
    insurerId: 'xyz-insurance',
    insurerName: 'XYZ Insurance',
    policyholderName: 'Lisa Anderson',
    policyholderMobile: '+27826667777',
    policyholderEmail: 'lisa.a@example.com',
    insurerProvidedVin: '6HGBH41JXMN109191',
    internalStatus: 'intake_received',
    externalStatus: 'Message Sent',
    receivedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
  },
  // High confidence - Replace with ADAS
  {
    claimNumber: 'CLM-2024-007',
    insurerId: 'abc-insurance',
    insurerName: 'ABC Insurance',
    policyholderName: 'Robert Taylor',
    policyholderMobile: '+27829990000',
    policyholderEmail: 'robert.t@example.com',
    insurerProvidedVin: '7HGBH41JXMN109192',
    internalStatus: 'decision_complete',
    externalStatus: 'Result Ready',
    receivedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    decision: {
      outcome: 'replace',
      decisionEligible: true,
      confidenceSummary: {
        damageAnalysis: 0.94,
        vinEnrichment: 0.96,
        photoQuality: 0.93,
      },
      blockingReasons: [],
      justification: 'Replace: Combination break ~2.5" diameter, in DPVA — DPVA size limit exceeded',
    },
  },
  // Insufficient evidence
  {
    claimNumber: 'CLM-2024-008',
    insurerId: 'xyz-insurance',
    insurerName: 'XYZ Insurance',
    policyholderName: 'Jennifer Martinez',
    policyholderMobile: '+27821112222',
    policyholderEmail: 'jennifer.m@example.com',
    insurerProvidedVin: '8HGBH41JXMN109193',
    internalStatus: 'awaiting_manual_review',
    externalStatus: 'Processing',
    receivedAt: new Date(Date.now() - 6 * 60 * 60 * 1000), // 6 hours ago
    decision: {
      outcome: 'insufficient_evidence',
      decisionEligible: false,
      confidenceSummary: {
        damageAnalysis: 0.45,
        vinEnrichment: 0.62,
        photoQuality: 0.38,
      },
      blockingReasons: ['Insufficient photo evidence', 'Unable to assess damage extent'],
      justification: 'Decision cannot be automated. Blocking reasons: Evidence sufficiency is insufficient',
    },
  },
];

async function createTestClaims() {
  try {
    loggers.app.info('Creating test claims for dashboard demo...');

    for (const claim of testClaims) {
      const claimId = uuidv4();
      const messageId = `test-${claimId}@example.com`;
      
      const inspectionData: any = {
        rawIntakePayload: {
          insurerName: claim.insurerName,
          claimNumber: claim.claimNumber,
          policyholderName: claim.policyholderName,
          policyholderMobile: claim.policyholderMobile,
          policyholderEmail: claim.policyholderEmail,
          insurerProvidedVin: claim.insurerProvidedVin,
          messageId,
          receivedAt: claim.receivedAt.toISOString(),
        },
        validationDetails: {
          intakeKey: `test-key-${claimId}`,
          validatedAt: claim.receivedAt.toISOString(),
        },
      };

      // Add decision if present
      if (claim.decision) {
        inspectionData.decision = claim.decision;
      }

      // Insert claim
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
          inspection_data,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `,
        [
          claim.claimNumber,
          claim.insurerId,
          claim.externalStatus,
          claim.internalStatus,
          claim.policyholderName,
          claim.policyholderMobile,
          claim.policyholderEmail,
          claim.insurerProvidedVin,
          messageId,
          claim.receivedAt,
          claim.internalStatus !== 'intake_received', // consent captured for all except just received
          JSON.stringify(inspectionData),
          claim.receivedAt,
          new Date(),
        ]
      );

      // Create notification delivery record (simulate SMS sent)
      if (claim.internalStatus !== 'intake_received') {
        await database.query(
          `
          INSERT INTO notification_deliveries (
            claim_id,
            channel,
            provider_message_id,
            sent_at,
            status
          ) VALUES ($1, $2, $3, $4, $5)
        `,
          [
            claimId,
            'sms',
            `SM${Math.random().toString(36).substr(2, 9)}`,
            new Date(claim.receivedAt.getTime() + 2 * 60 * 1000), // 2 minutes after received
            'sent',
          ]
        );
      }

      loggers.app.info(`Created test claim: ${claim.claimNumber}`, {
        status: claim.externalStatus,
        decision: claim.decision?.outcome,
      });
    }

    loggers.app.info(`✅ Successfully created ${testClaims.length} test claims!`);
    loggers.app.info('🎉 Dashboard is ready to view at: http://localhost:3000/dashboard');
    loggers.app.info('🔑 Access code: glass2024');

  } catch (error) {
    loggers.app.error('Failed to create test claims', error as Error);
    throw error;
  } finally {
    await database.close();
  }
}

// Run the script
createTestClaims().catch((error) => {
  console.error('Script failed:', error);
  process.exit(1);
});
