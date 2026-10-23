import { describe, expect, it } from 'vitest';
import { getProvider } from './registry.js';

describe('registry imported provider', () => {
  it('imported 只用于历史，不是可生成 provider', () => {
    expect(getProvider('imported')).toBeNull();
  });
});
