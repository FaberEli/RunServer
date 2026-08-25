// RunServer Web UI — serves the project dashboard on http://127.0.0.1:12345
// Three route classes: static HTML, JSON APIs, action endpoints.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from './scanner.mjs';
import { discover as discoverProjects } from './discover.mjs';
import { listProjects, getProject } from './registry.mjs';
import { getDefaultManager } from './manager.mjs';
import { getWebPort, getPortOverride, setPortOverride, clearPortOverride } from './config.mjs';
import { log } from './logger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, 'web');
const HOST = process.env.RUNSERVER_HOST || '127.0.0.1';
// PORT comes from (in order): RUNSERVER_PORT env, config.json webPort, 12345.
const PORT = parseInt(process.env.RUNSERVER_PORT || '', 10)
  || (await getWebPort().catch(() => 12345))
  || 12345;
const SERVER_NAME = `RunServer/${(await readPackageVersion())}`;

async function readPackageVersion() {
  try {
    const pkg = JSON.parse(await readFile(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch { return '0.0.0'; }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendText(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

const manager = getDefaultManager();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method || 'GET';
  log.info(`${method} ${url.pathname}`);

  try {
    if (method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = await readFile(path.join(WEB_DIR, 'index.html'));
      return sendText(res, 200, html, MIME['.html']);
    }

    if (method === 'GET' && url.pathname === '/api/projects') {
      const projects = await scan();
      return sendJson(res, 200, { backend: manager.constructor.name, projects });
    }

    // SSE: server-sent events. Streams status updates every 2s so the Web
    // UI doesn't have to poll. Client connects with new EventSource('/api/events').
    if (method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(': runserver events stream\n\n');
      let aborted = false;
      req.on('close', () => { aborted = true; });
      const interval = setInterval(async () => {
        if (aborted) { clearInterval(interval); return; }
        try {
          const projects = await scan();
          res.write(`event: projects\ndata: ${JSON.stringify({ backend: manager.constructor.name, projects })}\n\n`);
        } catch (e) {
          res.write(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
        }
      }, 2000);
      // initial push so the client gets data without waiting 2s
      try {
        const projects = await scan();
        res.write(`event: projects\ndata: ${JSON.stringify({ backend: manager.constructor.name, projects })}\n\n`);
      } catch {}
      return; // do not call res.end() — keep the stream open
    }

    if (method === 'GET' && url.pathname === '/api/all-projects') {
      const all = await listProjects();
      return sendJson(res, 200, { projects: all.map((p) => ({ id: p.id, name: p.name, description: p.description })) });
    }

    const actionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/(start|stop|restart)$/);
    if (method === 'POST' && actionMatch) {
      const [, id, action] = actionMatch;
      const project = await getProject(id);
      if (!project) return sendText(res, 404, `unknown project: ${id}`);

      const spec = action === 'stop' ? null : await project.service();
      if (action !== 'stop' && !spec) {
        return sendText(res, 409, `${id}: project not installed or no service spec available`);
      }

      if (action === 'start') {
        await manager.start({ id, ...spec });
      } else if (action === 'stop') {
        await manager.stop(id);
      } else if (action === 'restart') {
        await manager.restart({ id, ...spec });
      }
      return sendJson(res, 200, { ok: true, id, action });
    }

    if (method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, name: SERVER_NAME, platform: process.platform, backend: manager.constructor.name });
    }

    // GET /api/discover?dir=/some/path — scan a directory for git repos
    // that could be registered as RunServer projects. Read-only.
    if (method === 'GET' && url.pathname === '/api/discover') {
      const dir = url.searchParams.get('dir') || process.env.RUNSERVER_DISCOVER_ROOT || '';
      try {
        const registered = new Set((await listProjects()).map((p) => p.id));
        const candidates = await discoverProjects(dir, { alreadyRegistered: registered });
        return sendJson(res, 200, { dir, count: candidates.length, candidates });
      } catch (e) {
        return sendText(res, 400, `discover failed: ${e.message}`);
      }
    }

    // GET /api/projects/:id/port — read current port override
    const portGetMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/port$/);
    if (method === 'GET' && portGetMatch) {
      const [, id] = portGetMatch;
      const project = await getProject(id);
      if (!project) return sendText(res, 404, `unknown project: ${id}`);
      const override = await getPortOverride(id);
      const spec = await project.service().catch(() => null);
      const defaultPort = spec ? extractPortFromSpecPublic(spec) : null;
      return sendJson(res, 200, { id, override, defaultPort });
    }

    // POST /api/projects/:id/port  body: { port: number | null }
    if (method === 'POST' && portGetMatch) {
      const [, id] = portGetMatch;
      const project = await getProject(id);
      if (!project) return sendText(res, 404, `unknown project: ${id}`);
      const body = await readBody(req);
      if (body.port == null) {
        await clearPortOverride(id);
        return sendJson(res, 200, { id, override: null });
      }
      const n = parseInt(body.port, 10);
      if (!Number.isFinite(n) || n < 1 || n > 65535) {
        return sendText(res, 400, `invalid port: ${body.port}`);
      }
      await setPortOverride(id, n);
      return sendJson(res, 200, { id, override: n });
    }

    return sendText(res, 404, 'not found');
  } catch (e) {
    log.error(`${method} ${url.pathname}: ${e.message}`);
    return sendJson(res, 500, { error: e.message });
  }
});

export async function startWeb() {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, () => {
      const addr = server.address();
      log.ok(`Web UI listening on http://${addr.address}:${addr.port}`);
      log.ok(`Backend: ${manager.constructor.name} on ${process.platform}`);
      resolve({ host: addr.address, port: addr.port, server });
    });
  });
}

export { server, HOST, PORT };

// Re-exported so the port-GET route above can use it without an import
// cycle in the scanner (which already imports manager ports).
import { extractPortFromSpec as extractPortFromSpecPublic } from './ports.mjs';
