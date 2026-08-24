// Logger tests: level filtering + level env override.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('logger levels', () => {
  let writeSpy;
  let stderrLines;

  beforeEach(async () => {
    stderrLines = [];
    writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
      stderrLines.push(String(s));
      return true;
    });
  });

  afterEach(() => {
    writeSpy.mockRestore();
    delete process.env.RUNSERVER_LOG_LEVEL;
    delete process.env.RUNSERVER_QUIET;
  });

  it('debug is suppressed at default (info) level', async () => {
    const { log } = await import('../src/logger.mjs');
    log.debug('should be hidden');
    log.info('should show');
    expect(stderrLines.some((l) => l.includes('should be hidden'))).toBe(false);
    expect(stderrLines.some((l) => l.includes('should show'))).toBe(true);
  });

  it('debug shows when RUNSERVER_LOG_LEVEL=debug', async () => {
    process.env.RUNSERVER_LOG_LEVEL = 'debug';
    // Re-import to pick up the new env
    vi.resetModules();
    const { log } = await import('../src/logger.mjs');
    log.debug('now visible');
    expect(stderrLines.some((l) => l.includes('now visible'))).toBe(true);
  });

  it('RUNSERVER_QUIET suppresses everything but error', async () => {
    process.env.RUNSERVER_QUIET = '1';
    vi.resetModules();
    const { log } = await import('../src/logger.mjs');
    log.debug('aa-msg'); log.info('bb-msg'); log.warn('cc-msg'); log.error('dd-msg');
    // use unique substrings so trailing-whitespace edge cases don't bite
    expect(stderrLines.some((l) => l.includes('aa-msg'))).toBe(false);
    expect(stderrLines.some((l) => l.includes('bb-msg'))).toBe(false);
    expect(stderrLines.some((l) => l.includes('cc-msg'))).toBe(false);
    expect(stderrLines.some((l) => l.includes('dd-msg'))).toBe(true);
  });
});
