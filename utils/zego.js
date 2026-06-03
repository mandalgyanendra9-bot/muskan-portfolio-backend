const crypto = require("crypto");

const ZEGO_TOKEN_EFFECTIVE_SECONDS = 60 * 60 * 2;
const ZEGO_LOGIN_PRIVILEGE = 1;
const ZEGO_PUBLISH_PRIVILEGE = 2;

const getZegoAppConfig = () => {
  const appID = Number(process.env.ZEGO_APP_ID || 0);
  const serverSecret = String(process.env.ZEGO_SERVER_SECRET || "").trim();

  if (!Number.isSafeInteger(appID) || appID <= 0) {
    return { error: "Zego app ID is not configured" };
  }

  if (serverSecret.length !== 32) {
    return { error: "Zego server secret is not configured" };
  }

  return { appID, serverSecret, serverConfigured: true };
};

const getZegoWebServerConfig = () => {
  const rawServer = String(process.env.ZEGO_WEB_SERVER_URL || process.env.ZEGO_SERVER || process.env.ZEGO_SERVER_URL || "").trim();
  const servers = rawServer
    .split(",")
    .map((server) => server.trim())
    .filter((server) => server.length > 0)
    .map((server) => {
      if (/^(wss?|https?):\/\//i.test(server)) return server;
      return `wss://${server}`;
    });

  if (servers.length === 0) return { server: "", configured: false };
  return {
    server: servers.length === 1 ? servers[0] : servers,
    configured: true,
  };
};

const getZegoRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const makeRandomIv = () => {
  const str = "0123456789abcdefghijklmnopqrstuvwxyz";
  const result = [];
  for (let i = 0; i < 16; i++) {
    const r = Math.floor(Math.random() * str.length);
    result.push(str.charAt(r));
  }
  return result.join("");
};

const generateZegoToken04 = (appID, userID, serverSecret, effectiveTimeInSeconds, payload) => {
  if (!Number.isSafeInteger(appID) || appID <= 0) throw new Error("Zego app ID is invalid");
  if (!userID || typeof userID !== "string") throw new Error("Zego user ID is invalid");
  if (!serverSecret || serverSecret.length !== 32) throw new Error("Zego server secret must be a 32 byte string");
  if (!Number.isInteger(effectiveTimeInSeconds) || effectiveTimeInSeconds <= 0) {
    throw new Error("Zego token lifetime is invalid");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = nowSeconds + effectiveTimeInSeconds;
  const tokenInfo = {
    app_id: appID,
    user_id: userID,
    nonce: getZegoRandomInt(-2147483648, 2147483647),
    ctime: nowSeconds,
    expire: expiresAt,
    payload: payload || "",
  };

  const iv = makeRandomIv();
  const ivBuffer = Buffer.from(iv);

  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(serverSecret), ivBuffer);
  cipher.setAutoPadding(true);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(tokenInfo), "utf8"),
    cipher.final(),
  ]);

  const b1 = Buffer.alloc(8);
  b1.writeBigInt64BE(BigInt(expiresAt), 0);

  const b2 = Buffer.alloc(2);
  b2.writeUInt16BE(ivBuffer.length, 0);

  const b3 = Buffer.alloc(2);
  b3.writeUInt16BE(encrypted.length, 0);

  const binary = Buffer.concat([b1, b2, ivBuffer, b3, encrypted]);

  return {
    token: `04${binary.toString("base64")}`,
    expiresAt,
  };
};

const getZegoStreamId = (roomId, userId) => {
  const cleanRoomId = String(roomId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  const cleanUserId = String(userId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  return `vc_${cleanRoomId}_${cleanUserId}`.slice(0, 240);
};

module.exports = {
  ZEGO_TOKEN_EFFECTIVE_SECONDS,
  ZEGO_LOGIN_PRIVILEGE,
  ZEGO_PUBLISH_PRIVILEGE,
  getZegoAppConfig,
  getZegoWebServerConfig,
  generateZegoToken04,
  getZegoStreamId,
};
