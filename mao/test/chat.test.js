import { describe, it, expect } from 'vitest';
import { extractBuildRequest } from '../src/chat.js';

describe('extractBuildRequest', () => {
  it('returns null without marker', () => expect(extractBuildRequest('just chatting')).toBeNull());
  it('extracts marker at line start', () => {
    const t = 'Sure, that sounds good.\nBUILD_REQUEST: Add GET /health and GET /users to the app.';
    expect(extractBuildRequest(t)).toBe('Add GET /health and GET /users to the app.');
  });
  it('last marker wins', () => {
    const t = 'BUILD_REQUEST: first\nmore text\nBUILD_REQUEST: second';
    expect(extractBuildRequest(t)).toBe('second');
  });
  it('ignores marker mid-line', () => {
    expect(extractBuildRequest('he said BUILD_REQUEST: nope')).toBeNull();
  });
});
