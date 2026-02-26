const { PassThrough } = require("stream");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function requestLocal(handler, { method = "GET", url = "/", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = new PassThrough();
    req.method = method;
    req.url = url;
    req.headers = headers;
    req.setEncoding = () => {};
    req.on("error", reject);

    const res = new PassThrough();
    const resHeaders = {};
    let statusCode = 200;
    res.setHeader = (key, value) => {
      resHeaders[String(key).toLowerCase()] = value;
    };
    res.writeHead = (code, hdrs = {}) => {
      statusCode = code;
      Object.entries(hdrs).forEach(([k, v]) => {
        resHeaders[String(k).toLowerCase()] = v;
      });
    };
    const chunks = [];
    res.write = (chunk) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return true;
    };
    res.end = (chunk) => {
      if (chunk) {
        res.write(chunk);
      }
      res.emit("finish");
      resolve({
        statusCode,
        headers: resHeaders,
        body: Buffer.concat(chunks),
      });
      return true;
    };
    res.on("error", reject);

    handler(req, res);
    process.nextTick(() => {
      if (body) {
        req.write(body);
      }
      req.end();
    });
  });
}

module.exports = {
  assert,
  requestLocal,
};
