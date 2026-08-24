// Minimal logger with DEBUG/INFO/WARN/ERROR levels.
// RUNSERVER_QUIET suppresses everything except ERROR.
// RUNSERVER_LOG_LEVEL=debug|info|warn|error overrides the default (info).
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function shouldLog(level) {
  if (process.env.RUNSERVER_QUIET) return level === 'error';
  const v = (process.env.RUNSERVER_LOG_LEVEL || '').toLowerCase();
  const active = LEVELS[v] || LEVELS.info;
  return LEVELS[level] >= active;
}

const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

const write = (level, msg) => {
  if (!shouldLog(level)) return;
  process.stderr.write(`[${ts()}] ${level.padEnd(5)} ${msg}\n`);
};

export const log = {
  debug: (m) => write('debug', m),
  info: (m) => write('info', m),
  warn: (m) => write('warn', m),
  error: (m) => write('error', m),
  ok: (m) => write('info', `✓ ${m}`),
};
