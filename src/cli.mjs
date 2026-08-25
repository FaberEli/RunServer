// RunServer CLI — subcommands: web, start, stop, restart, status, list, scan, port, info.
import { parseArgs } from 'node:util';
import { startWeb } from './server.mjs';
import { scan } from './scanner.mjs';
import { listProjects, getProject } from './registry.mjs';
import { getDefaultManager, RUNSERVER_HOME } from './manager.mjs';
import { extractPortFromSpec } from './ports.mjs';
import { getPortOverride, setPortOverride, clearPortOverride, getWebPort, setWebPort, loadConfig } from './config.mjs';
import { log } from './logger.mjs';

function usage() {
  return `RunServer — local services manager

Usage:
  runserver web [--port N] [--host H]   Start the Web UI (default :12345)
  runserver start <project-id>          Start a registered project
  runserver stop <project-id>           Stop a running project
  runserver restart <project-id>        Restart a project
  runserver status [project-id]         Show all (or one) projects' status
  runserver list                        List all registered projects
  runserver scan                        Rescan local installations
  runserver port <project-id> [<port>]  Read or set a project's port override
  runserver web-port [<port>]           Read or set the Web UI port
  runserver info                        Show backend + paths
  runserver --help

Env:
  RUNSERVER_HOST=127.0.0.1
  RUNSERVER_PORT=12345
  RUNSERVER_HOME=~/.runserver
`;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      port: { type: 'string' },
      host: { type: 'string' },
    },
  });

  if (values.help || positionals.length === 0) {
    process.stdout.write(usage() + '\n');
    return;
  }
  if (values.version) {
    const pkg = await readPackageVersion();
    process.stdout.write(`runserver ${pkg}\n`);
    return;
  }

  const cmd = positionals[0];
  const arg = positionals[1];
  const manager = getDefaultManager();

  switch (cmd) {
    case 'web': {
      if (values.port) process.env.RUNSERVER_PORT = String(values.port);
      if (values.host) process.env.RUNSERVER_HOST = String(values.host);
      await startWeb();
      return new Promise(() => {});
    }
    case 'start': {
      if (!arg) throw new Error('start requires a project id');
      const project = await getProject(arg);
      if (!project) throw new Error(`unknown project: ${arg}`);
      const spec = { id: arg, ...(await project.service()) };
      if (!spec.command) throw new Error(`${arg}: not installed or no service spec`);
      const finalSpec = await manager.start(spec);
      const actualPort = finalSpec?._resolvedPort ?? extractPortFromSpec(spec);
      log.ok(`${arg}: started${actualPort ? ` on :${actualPort}` : ''}`);
      break;
    }
    case 'stop': {
      if (!arg) throw new Error('stop requires a project id');
      await manager.stop(arg);
      log.ok(`${arg}: stopped`);
      break;
    }
    case 'restart': {
      if (!arg) throw new Error('restart requires a project id');
      const project = await getProject(arg);
      if (!project) throw new Error(`unknown project: ${arg}`);
      const spec = { id: arg, ...(await project.service()) };
      if (!spec.command) throw new Error(`${arg}: not installed or no service spec`);
      await manager.restart(spec);
      log.ok(`${arg}: restarted`);
      break;
    }
    case 'status': {
      const projects = await scan();
      if (arg) {
        const p = projects.find((x) => x.id === arg);
        if (!p) {
          log.warn(`${arg}: not installed locally`);
        } else {
          process.stdout.write(JSON.stringify(p, null, 2) + '\n');
        }
      } else {
        if (!projects.length) {
          log.info('no installed projects. run `runserver list` to see registered ones.');
        } else {
          for (const p of projects) {
            const s = p.status.running ? `running (${p.status.pid || p.status.label || ''})` : 'stopped';
            process.stdout.write(`  ${p.id.padEnd(24)} ${s.padEnd(28)} ${p.version || ''}\n`);
          }
        }
      }
      break;
    }
    case 'list': {
      const all = await listProjects();
      for (const p of all) {
        process.stdout.write(`  ${p.id.padEnd(24)} ${p.name}\n`);
      }
      break;
    }
    case 'scan': {
      const projects = await scan();
      log.info(`scanned: ${projects.length} installed`);
      for (const p of projects) {
        process.stdout.write(`  ✓ ${p.id} ${p.version || ''}\n`);
      }
      break;
    }
    case 'port': {
      if (!arg) throw new Error('port requires a project id');
      const port = positionals[2];
      if (port === undefined) {
        const current = await getPortOverride(arg);
        process.stdout.write(current ? `${arg}: ${current}\n` : `${arg}: (no override)\n`);
      } else if (port === 'clear' || port === 'reset') {
        await clearPortOverride(arg);
        process.stdout.write(`${arg}: override cleared\n`);
      } else {
        const n = parseInt(port, 10);
        if (!Number.isFinite(n)) throw new Error(`invalid port: ${port}`);
        await setPortOverride(arg, n);
        process.stdout.write(`${arg}: port set to ${n}\n`);
      }
      break;
    }
    case 'web-port': {
      const port = positionals[1];
      if (port === undefined) {
        const current = await getWebPort();
        process.stdout.write(`web port: ${current}\n`);
      } else {
        const n = parseInt(port, 10);
        if (!Number.isFinite(n)) throw new Error(`invalid port: ${port}`);
        await setWebPort(n);
        process.stdout.write(`web port set to ${n}\n`);
      }
      break;
    }
    case 'info': {
      process.stdout.write(JSON.stringify({
        backend: manager.constructor.name,
        platform: process.platform,
        home: RUNSERVER_HOME,
        node: process.version,
      }, null, 2) + '\n');
      break;
    }
    case 'discover': {
      const { discover } = await import('./discover.mjs');
      const dir = arg || process.env.RUNSERVER_DISCOVER_ROOT || '';
      const registered = new Set((await listProjects()).map((p) => p.id));
      const candidates = await discover(dir, { alreadyRegistered: registered });
      log.info(`scanned ${dir}: ${candidates.length} candidate(s)`);
      for (const c of candidates) {
        if (c.registered) {
          process.stdout.write(`  ✓ ${c.id.padEnd(28)} [registered]  ${c.path}\n`);
        } else {
          process.stdout.write(`  ? ${c.id.padEnd(28)} ${(c.install.type || 'unknown').padEnd(8)}  ${c.path}\n`);
        }
      }
      break;
    }
    default:
      process.stderr.write(`unknown command: ${cmd}\n\n` + usage());
      process.exitCode = 2;
  }
}

async function readPackageVersion() {
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = path.dirname(fileURLToPath(import.meta.url));
  try {
    const text = await readFile(path.join(here, '..', 'package.json'), 'utf8');
    const pkg = JSON.parse(text);
    return (pkg && pkg.version) || '0.0.0';
  } catch { return '0.0.0'; }
}

main().catch((e) => {
  log.error(e.message);
  process.exit(1);
});
