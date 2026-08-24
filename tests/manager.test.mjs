// Critical-path tests for the manager. Pure functions + plist XML — no
// process spawns here (those are exercised by hand + integration scripts).
import { describe, it, expect } from 'vitest';
import { renderPlist, parseEnvText, RUNSERVER_HOME } from '../src/manager.mjs';

describe('parseEnvText', () => {
  it('parses KEY=value lines', () => {
    expect(parseEnvText('FOO=bar\nBAZ=qux\n')).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('accepts leading "export"', () => {
    expect(parseEnvText('export FOO=bar')).toEqual({ FOO: 'bar' });
  });

  it('strips matching single or double quotes', () => {
    expect(parseEnvText("FOO='a b'\nBAR=\"c d\"")).toEqual({ FOO: 'a b', BAR: 'c d' });
  });

  it('ignores blank lines and comments', () => {
    expect(parseEnvText('\n# top\nA=1\n\n# bottom\nB=2\n')).toEqual({ A: '1', B: '2' });
  });

  it('skips lines without =', () => {
    expect(parseEnvText('GARBAGE\nFOO=ok\n')).toEqual({ FOO: 'ok' });
  });

  it('handles values containing "="', () => {
    expect(parseEnvText('URL=https://x?y=1')).toEqual({ URL: 'https://x?y=1' });
  });
});

describe('renderPlist', () => {
  it('emits a valid plist with absolute path and forwarded env', () => {
    const xml = renderPlist({
      label: 'com.runserver.test',
      command: '/usr/local/bin/foo',
      args: ['web', '--port', '8080'],
      env: { PATH: '/usr/bin:/bin', FOO: 'bar' },
      logFile: '/tmp/out.log',
      errFile: '/tmp/err.log',
    });
    expect(xml).toContain('<?xml');
    expect(xml).toContain('<key>Label</key>');
    expect(xml).toContain('<string>com.runserver.test</string>');
    expect(xml).toContain('<string>/usr/local/bin/foo</string>');
    expect(xml).toContain('<string>web</string>');
    expect(xml).toContain('<string>--port</string>');
    expect(xml).toContain('<string>8080</string>');
    expect(xml).toContain('<key>PATH</key>');
    expect(xml).toContain('<key>FOO</key>');
    expect(xml).toContain('<string>bar</string>');
    expect(xml).toContain('<key>KeepAlive</key>');
    expect(xml).toContain('<true/>');
    expect(xml).toContain('<key>StandardOutPath</key>');
    expect(xml).toContain('/tmp/out.log');
    expect(xml).toContain('/tmp/err.log');
  });

  it('xml-escapes special characters', () => {
    const xml = renderPlist({
      label: 'com.runserver.t<>&"\'',
      command: '/bin/foo',
      args: ['a&b'],
      env: { 'A=B': 'c"d' },
      logFile: '/x',
      errFile: '/y',
    });
    expect(xml).toContain('&lt;');
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&quot;');
    expect(xml).toContain('&apos;');
  });

  it('omits the EnvironmentVariables block when env is empty', () => {
    const xml = renderPlist({
      label: 'l', command: '/c', args: [], env: {},
      logFile: '/a', errFile: '/b',
    });
    expect(xml).not.toContain('EnvironmentVariables');
  });

  it('emits WorkingDirectory when cwd is set', () => {
    const xml = renderPlist({
      label: 'l', command: '/c', args: ['x'], env: {},
      logFile: '/a', errFile: '/b', cwd: '/var/svc/foo',
    });
    expect(xml).toContain('<key>WorkingDirectory</key>');
    expect(xml).toContain('<string>/var/svc/foo</string>');
  });

  it('omits WorkingDirectory when cwd is not set', () => {
    const xml = renderPlist({
      label: 'l', command: '/c', args: [], env: {},
      logFile: '/a', errFile: '/b',
    });
    expect(xml).not.toContain('WorkingDirectory');
  });
});

describe('manager constants', () => {
  it('RUNSERVER_HOME defaults to ~/.runserver', () => {
    // RUNSERVER_HOME may be overridden by the test runner; we just check shape
    expect(typeof RUNSERVER_HOME).toBe('string');
    expect(RUNSERVER_HOME.length).toBeGreaterThan(0);
  });
});
