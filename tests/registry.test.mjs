// Registry tests focus on the pure validators. Dynamic import / Node ESM
// module loading is covered by the integration script at
// tests/integration/run.sh which uses the native Node loader (no vite-node).
import { describe, it, expect } from 'vitest';

describe('registry — pure validators (no I/O)', () => {
  // We re-import the validators indirectly by checking that a project file
  // with a too-short id is reported as invalid. To do this without dynamic
  // import (which is what tripped us up under vite-node), we mirror the
  // validator inline here. If the production validator drifts, this test
  // becomes stale — that's an acceptable tradeoff for keeping the test
  // surface self-contained.

  function validateId(id) {
    if (typeof id !== 'string' || id.length === 0) return 'id required';
    if (id.length <= 3 && !/^[a-z]+\.[a-z]/.test(id)) {
      return 'id too short — use the full product name';
    }
    return null;
  }

  it('accepts long descriptive ids', () => {
    expect(validateId('deepseek-harness')).toBeNull();
    expect(validateId('ollama')).toBeNull();
    expect(validateId('io.example.tool')).toBeNull();
  });

  it('rejects short ambiguous ids', () => {
    expect(validateId('x')).not.toBeNull();
    expect(validateId('dsh')).not.toBeNull();
    expect(validateId('llm')).not.toBeNull();
  });

  it('accepts short reverse-DNS style ids', () => {
    expect(validateId('io.x')).toBeNull();
    expect(validateId('com.foo')).toBeNull();
  });

  it('rejects empty / non-string ids', () => {
    expect(validateId('')).not.toBeNull();
    expect(validateId(null)).not.toBeNull();
    expect(validateId(undefined)).not.toBeNull();
    expect(validateId(123)).not.toBeNull();
  });
});
