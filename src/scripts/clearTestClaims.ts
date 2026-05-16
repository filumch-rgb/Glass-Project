import { database } from '../config/database';

async function clearTestClaims() {
  await database.query("DELETE FROM uploaded_photos WHERE claim_id::text IN (SELECT id::text FROM claim_inspections WHERE claim_number LIKE 'CLM-2024-%')");
  await database.query("DELETE FROM notification_deliveries WHERE claim_id IN (SELECT id::text FROM claim_inspections WHERE claim_number LIKE 'CLM-2024-%')");
  await database.query("DELETE FROM claim_inspections WHERE claim_number LIKE 'CLM-2024-%'");
  console.log('Cleared test claims');
  process.exit(0);
}

clearTestClaims().catch((e) => { console.error(e); process.exit(1); });
