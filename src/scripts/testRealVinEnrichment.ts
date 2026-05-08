/**
 * Real API Test Script for VIN Enrichment
 * 
 * This script makes REAL API calls to:
 * - Lightstone API (South Africa)
 * - Bayanaty API (Global - Vehicle Data + ADAS)
 * - NHTSA API (US/International)
 * 
 * Test VINs:
 * - MALAN51BLEM575556 (South African - Hyundai i10)
 * - 1HGBH41JXMN109186 (US - Honda Civic)
 */

import { config } from '../config';
import { loggers } from '../utils/logger';
import { LightstoneDecoder } from '../services/vinDecoders/lightstoneDecoder';
import { BayantyDecoder } from '../services/vinDecoders/bayantyDecoder';
import { NHTSADecoder } from '../services/vinDecoders/nhtsaDecoder';
import { vinEnrichmentService } from '../services/vinEnrichmentService';

// Test VINs
const SOUTH_AFRICAN_VIN = 'AAVZZZ6SZEU024494'; // Test VIN
const US_VIN = 'JN3MS37A9PW202929'; // Test US VIN

async function testLightstoneAPI() {
  console.log('\n========================================');
  console.log('🇿🇦 Testing Lightstone API (South Africa)');
  console.log('========================================\n');

  const decoder = new LightstoneDecoder();

  try {
    console.log(`VIN: ${SOUTH_AFRICAN_VIN}`);
    console.log('Calling Lightstone API...\n');

    const result = await decoder.decode(SOUTH_AFRICAN_VIN);

    if (result) {
      console.log('✅ SUCCESS! Vehicle data retrieved:\n');
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('⚠️  No vehicle data returned (null)');
    }
  } catch (error) {
    console.error('❌ ERROR:', (error as Error).message);
  }
}

async function testBayantyAPI() {
  console.log('\n========================================');
  console.log('🌍 Testing Bayanaty API (Global)');
  console.log('========================================\n');

  const decoder = new BayantyDecoder();

  try {
    console.log(`VIN: ${SOUTH_AFRICAN_VIN}`);
    console.log('Calling Bayanaty API for vehicle data...\n');

    const vehicleData = await decoder.decode(SOUTH_AFRICAN_VIN);

    if (vehicleData) {
      console.log('✅ SUCCESS! Vehicle data retrieved:\n');
      console.log(JSON.stringify(vehicleData, null, 2));
    } else {
      console.log('⚠️  No vehicle data returned (null)');
    }

    console.log('\n----------------------------------------');
    console.log('Calling Bayanaty API for ADAS data...\n');

    const adasData = await decoder.getAdasInfo(SOUTH_AFRICAN_VIN);

    if (adasData) {
      console.log('✅ SUCCESS! ADAS data retrieved:\n');
      console.log(JSON.stringify(adasData, null, 2));
    } else {
      console.log('⚠️  No ADAS data returned (null)');
    }
  } catch (error) {
    console.error('❌ ERROR:', (error as Error).message);
  }
}

async function testNHTSAAPI() {
  console.log('\n========================================');
  console.log('🇺🇸 Testing NHTSA API (US/International)');
  console.log('========================================\n');

  const decoder = new NHTSADecoder();

  try {
    console.log(`VIN: ${US_VIN}`);
    console.log('Calling NHTSA API...\n');

    const result = await decoder.decode(US_VIN);

    if (result) {
      console.log('✅ SUCCESS! Vehicle data retrieved:\n');
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('⚠️  No vehicle data returned (null)');
    }
  } catch (error) {
    console.error('❌ ERROR:', (error as Error).message);
  }
}

async function testFullEnrichmentSouthAfrica() {
  console.log('\n========================================');
  console.log('🔄 Testing Full VIN Enrichment (South Africa)');
  console.log('========================================\n');

  try {
    console.log(`VIN: ${SOUTH_AFRICAN_VIN}`);
    console.log('Geography: south_africa');
    console.log('Expected flow: Lightstone → Bayanaty (fallback) + Bayanaty (ADAS)\n');

    const result = await vinEnrichmentService.enrich({
      claimId: 'test-claim-sa-001',
      insurerProvidedVin: SOUTH_AFRICAN_VIN,
      geography: 'south_africa',
    });

    console.log('✅ SUCCESS! Full enrichment result:\n');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('❌ ERROR:', (error as Error).message);
  }
}

async function testFullEnrichmentNonSouthAfrica() {
  console.log('\n========================================');
  console.log('🔄 Testing Full VIN Enrichment (Non-South Africa)');
  console.log('========================================\n');

  try {
    console.log(`VIN: ${US_VIN}`);
    console.log('Geography: united_states');
    console.log('Expected flow: Bayanaty → NHTSA (fallback) + Bayanaty (ADAS)\n');

    const result = await vinEnrichmentService.enrich({
      claimId: 'test-claim-us-001',
      insurerProvidedVin: US_VIN,
      geography: 'united_states',
    });

    console.log('✅ SUCCESS! Full enrichment result:\n');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('❌ ERROR:', (error as Error).message);
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  VIN Enrichment Service - Real API Test                   ║');
  console.log('║  Testing with REAL API calls (not mocked)                 ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log('Configuration:');
  console.log(`- Lightstone API: ${config.externalApis.lightstone.apiUrl}`);
  console.log(`- Bayanaty API: ${config.externalApis.bayanaty.apiUrl}`);
  console.log(`- NHTSA API: ${config.externalApis.nhtsa.apiUrl}`);
  console.log(`- Max Retries: ${config.assessment.maxApiRetries}`);
  console.log(`- Retry Delay: ${config.assessment.retryInitialDelayMs}ms (exponential backoff)`);

  // Test individual APIs
  await testLightstoneAPI();
  await testBayantyAPI();
  await testNHTSAAPI();

  // Test full enrichment flows
  await testFullEnrichmentSouthAfrica();
  await testFullEnrichmentNonSouthAfrica();

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  All tests completed!                                      ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
}

// Run the tests
main().catch((error) => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
