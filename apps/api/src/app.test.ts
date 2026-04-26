import { describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

describe('API scaffold', () => {
  it('exposes a health endpoint', async () => {
    const app = await buildApp({ logger: false });

    const response = await app.inject({
      method: 'GET',
      url: '/health'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      service: 'glass-claim-assessment-api',
      status: 'ok'
    });

    await app.close();
  });
});
