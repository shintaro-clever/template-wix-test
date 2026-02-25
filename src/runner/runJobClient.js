const http = require("http");
const https = require("https");

function shouldIncludeDepth(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function buildRunJobPayload({ inputs = {}, ...rest }) {
  const normalizedInputs = { ...(inputs || {}) };
  if (!shouldIncludeDepth(normalizedInputs.depth)) {
    delete normalizedInputs.depth;
  }
  return {
    ...rest,
    inputs: normalizedInputs,
  };
}

function postJson({ url, socketPath, path, payload, headers = {}, timeoutMs = 10000 }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload || {});
    let client = http;
    let options = {};
    if (socketPath) {
      let targetPath = path || "/";
      if (!path && url) {
        const parsed = new URL(url, "http://localhost");
        targetPath = `${parsed.pathname}${parsed.search}`;
      }
      options = {
        method: "POST",
        socketPath,
        path: targetPath,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(body),
          ...headers,
        },
      };
    } else {
      const target = new URL(url);
      const isHttps = target.protocol === "https:";
      client = isHttps ? https : http;
      options = {
        method: "POST",
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(body),
          ...headers,
        },
      };
    }
    const req = client.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers || {},
          body: text,
        });
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("request timeout"));
    });
    req.write(body);
    req.end();
  });
}

async function runJobClient(options = {}) {
  const { url, inputs, headers, timeoutMs, socketPath, path, ...rest } = options;
  if (!socketPath && !url) {
    throw new Error("url is required");
  }
  const payload = buildRunJobPayload({ inputs, ...rest });
  return postJson({ url, socketPath, path, payload, headers, timeoutMs });
}

module.exports = {
  runJobClient,
  buildRunJobPayload,
};
