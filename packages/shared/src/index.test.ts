import { describe, expect, it } from 'vitest';

import type { JsonObject } from './index.js';

describe('Shared scaffold', () => {
  it('exports JSON-compatible typing helpers', () => {
    const sample: JsonObject = { status: 'ready' };

    expect(sample).toEqual({ status: 'ready' });
  });
});
