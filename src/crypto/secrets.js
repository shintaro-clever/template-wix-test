// src/crypto/secrets.js
const crypto = require("crypto");

function keyBytes() {
  const key = process.env.SECRET_KEY || "";
  // テストは64文字(=32bytes hex相当)をセットしているので、まずhexとして解釈。
  if (/^[0-9a-fA-F]{64}$/.test(key)) {
    return Buffer.from(key, "hex");
  }
  // それ以外はSHA256で32bytes化（安定化目的）
  return crypto.createHash("sha256").update(String(key)).digest();
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // iv.tag.data を base64 で返す
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

function decrypt(payload) {
  const parts = String(payload).split(".");
  if (parts.length !== 3) throw new Error("invalid cipher payload");
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBytes(), iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(data), decipher.final()]);
  return out.toString("utf8");
}

module.exports = { encrypt, decrypt };
