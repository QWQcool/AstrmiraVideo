import { describe, it, expect } from 'vitest';

describe('Backend Smoke Tests', () => {
  it('should define basic health payload contract', () => {
    const healthPayload = {
      status: 'ok',
      name: 'AstrmiraVideo Backend',
      version: '0.1.0',
    };
    expect(healthPayload.status).toBe('ok');
    expect(healthPayload.name).toBe('AstrmiraVideo Backend');
  });
});
