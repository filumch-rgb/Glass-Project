import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App';

describe('Web scaffold', () => {
  it('renders the application shell', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: /glass claim assessment/i })
    ).toBeTruthy();
  });
});
