// Minimal logger — keeps the runserver output predictable across CLI + web contexts.
const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

const write = (level, msg) => {
  if (process.env.RUNSERVER_QUIET && level !== 'error') return;
  process.stderr.write(`[${ts()}] ${level.padEnd(5)} ${msg}\n`);
};

export const log = {
  info: (m) => write('info', m),
  warn: (m) => write('warn', m),
  error: (m) => write('error', m),
  ok: (m) => write('ok', m),
};
