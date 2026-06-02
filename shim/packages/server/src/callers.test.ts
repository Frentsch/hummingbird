import { describe, it, expect, beforeEach } from 'vitest';
import { callers } from './callers.js';

describe('callers Set', () => {
  beforeEach(() => callers.clear());

  it('starts empty', () => {
    expect(callers.size).toBe(0);
  });

  it('adds and checks a key', () => {
    callers.add('mykey');
    expect(callers.has('mykey')).toBe(true);
  });

  it('deletes a key', () => {
    callers.add('mykey');
    callers.delete('mykey');
    expect(callers.has('mykey')).toBe(false);
  });
});
