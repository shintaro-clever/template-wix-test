function resolveHostPort(env = process.env) {
  const hostRaw = env && typeof env.HOST === 'string' ? env.HOST.trim() : '';
  const host = hostRaw || '127.0.0.1';
  const rawPort = (env && (env.PORT || env.HUB_PORT)) || '3100';
  const parsed = Number(rawPort);
  const port = Number.isFinite(parsed) && parsed > 0 ? parsed : 3100;
  return { host, port };
}

module.exports = {
  resolveHostPort
};
