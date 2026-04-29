import { journeyService } from '../services/journeyService';
import { database } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

async function createJourney() {
  try {
    const result = await journeyService.createJourney({
      claimId: uuidv4(),
      channel: 'pwa',
    });

    console.log('\n🎉 Fresh Journey Link Created!\n');
    console.log(result.journeyLink);
    console.log('\n✅ Copy this link and open it in your browser!\n');
    console.log(`Expires at: ${result.expiresAt.toISOString()}\n`);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await database.close();
    process.exit(0);
  }
}

createJourney();
