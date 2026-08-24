import { describe, it, beforeAll } from 'vitest';
import { mkdtempSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let tmpProjectsDir;
beforeAll(() => {
  tmpProjectsDir = mkdtempSync(path.join(tmpdir(), 'rs-test-'));
  cpSync(path.resolve(__dirname, '../src/projects/deepseek-harness.mjs'),
         path.join(tmpProjectsDir, 'deepseek-harness.mjs'));
  process.env.RUNSERVER_PROJECTS_DIR = tmpProjectsDir;
});

describe('debug4', () => {
  it('manual import of tmpdir project', async () => {
    const files = readdirSync(tmpProjectsDir);
    console.log('files:', files);
    for (const f of files) {
      const url = pathToFileURL(path.join(tmpProjectsDir, f)).href;
      console.log('  url:', url);
      try {
        const mod = await import(url);
        console.log('  keys:', Object.keys(mod));
        console.log('  project:', mod.project?.id, mod.project?.name);
      } catch (e) {
        console.log('  err:', e.message);
      }
    }
  });
});
