import { journeyService } from '../services/journeyService';
import { database } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

async function createJourney() {
  try {
    // Use ngrok URL if provided as argument, otherwise use localhost
    const baseUrl = process.argv[2] || 'http://localhost:3000';
    
    const result = await journeyService.createJourney({
      claimId: uuidv4(),
      channel: 'pwa',
    });

    // Replace localhost with custom base URL if provided
    const journeyLink = result.journeyLink.replace('http://localhost:3000', baseUrl);

    console.log('\n🎉 Fresh Journey Link Created!\n');
    console.log(journeyLink);
    console.log('\n✅ Copy this link and open it on your mobile phone!\n');
    console.log(`Expires at: ${result.expiresAt.toISOString()}\n`);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await database.close();
    process.exit(0);
  }
}

createJourney();
