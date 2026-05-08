/**
 * Test NHTSA API only with US VIN
 */

import { NHTSADecoder } from '../services/vinDecoders/nhtsaDecoder';

async function main() {
  console.log('Testing NHTSA API with US VIN...\n');

  const decoder = new NHTSADecoder();
  const US_VIN = '1HGBH41JXMN109186'; // Honda Civic

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

main();
