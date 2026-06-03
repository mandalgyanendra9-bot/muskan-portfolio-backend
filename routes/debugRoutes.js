const express = require("express");
const crypto = require("crypto");
const Booking = require("../models/Booking");
const authMiddleware = require("../middleware/authMiddleware");
const { hasAdminAccess } = require("../utils/adminAccess");

const router = express.Router();

const ZEGO_TOKEN_EFFECTIVE_SECONDS = 60 * 60 * 2;
const ZEGO_LOGIN_PRIVILEGE = "1";
const ZEGO_PUBLISH_PRIVILEGE = "2";

const getIdString = (value) => {
  if (!value) return "";
  return String(value?._id || value);
};

const getBookingRoomId = (booking) => booking?._id?.toString?.() || "";

const getBookingParticipantIds = (booking) => ({
  clientId: getIdString(booking.clientId || booking.client),
  expertId: getIdString(booking.expertId || booking.expert),
});

const getZegoStreamId = (roomId, userId) => {
  const cleanRoomId = String(roomId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  const cleanUserId = String(userId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  return `vc_${cleanRoomId}_${cleanUserId}`.slice(0, 240);
};

const getZegoWebServerConfigured = () => {
  const rawServer = String(process.env.ZEGO_WEB_SERVER_URL || process.env.ZEGO_SERVER || process.env.ZEGO_SERVER_URL || "").trim();
  return rawServer
    .split(",")
    .map((server) => server.trim())
    .some((server) => /^(wss?|https?):\/\//i.test(server));
};

const getZegoRandomInt = () => crypto.randomInt(-2147483648, 2147483647);

const getZegoRandomIv = () => {
  const possible = "0123456789abcdefghijklmnopqrstuvwxyz";
  let iv = "";
  for (let index = 0; index < 16; index += 1) {
    iv += possible.charAt(crypto.randomInt(0, possible.length));
  }
  return iv;
};

const generateZegoToken04 = (appID, userID, serverSecret, effectiveTimeInSeconds, payload) => {
  if (!Number.isSafeInteger(appID) || appID <= 0) throw new Error("Zego app ID is invalid");
  if (!userID || String(userID).length > 64) throw new Error("Zego user ID is invalid");
  if (!serverSecret || serverSecret.length !== 32) throw new Error("Zego server secret is invalid");
  if (!Number.isInteger(effectiveTimeInSeconds) || effectiveTimeInSeconds <= 0) {
    throw new Error("Zego token lifetime is invalid");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = nowSeconds + effectiveTimeInSeconds;
  const tokenInfo = {
    app_id: appID,
    user_id: userID,
    nonce: getZegoRandomInt(),
    ctime: nowSeconds,
    expire: expiresAt,
    payload,
  };
  const iv = getZegoRandomIv();
  const ivBuffer = Buffer.from(iv);
  const cipher = crypto.createCipheriv("aes-256-cbc", serverSecret, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(tokenInfo), "utf8"),
    cipher.final(),
  ]);
  const binary = Buffer.alloc(8 + 2 + ivBuffer.length + 2 + encrypted.length);
  let offset = 0;

  binary.writeBigUInt64BE(BigInt(expiresAt), offset);
  offset += 8;
  binary.writeUInt16BE(ivBuffer.length, offset);
  offset += 2;
  ivBuffer.copy(binary, offset);
  offset += ivBuffer.length;
  binary.writeUInt16BE(encrypted.length, offset);
  offset += 2;
  encrypted.copy(binary, offset);

  return {
    token: `04${binary.toString("base64")}`,
    expiresAt,
  };
};

router.get("/zego-token/:bookingId", authMiddleware, async (req, res) => {
  res.set("Cache-Control", "no-store");

  const appId = Number(process.env.ZEGO_APP_ID || 0);
  const serverSecret = String(process.env.ZEGO_SERVER_SECRET || "").trim();
  const currentUserId = getIdString(req.user?.id || req.user?._id);
  const serverConfigured = getZegoWebServerConfigured();
  const usingServerSecret = serverSecret.length === 32;
  const baseDebug = {
    appId: Number.isSafeInteger(appId) && appId > 0 ? appId : 0,
    roomId: String(req.params.bookingId || ""),
    userId: currentUserId,
    tokenLength: 0,
    tokenPrefixFirst10: "",
    tokenExpiresAt: null,
    serverConfigured,
    usingServerSecret,
    tokenGenerated: false,
  };

  try {
    const booking = await Booking.findById(req.params.bookingId).catch(() => null);
    if (!booking) return res.status(404).json({ ...baseDebug, message: "Booking not found" });

    const { clientId, expertId } = getBookingParticipantIds(booking);
    const isParticipant = Boolean(currentUserId && (currentUserId === clientId || currentUserId === expertId));
    const isAdmin = hasAdminAccess(req.authUser);
    if (!isParticipant && !isAdmin) {
      return res.status(403).json({ ...baseDebug, message: "You are not authorized to debug this booking" });
    }

    const roomId = getBookingRoomId(booking);
    const streamID = getZegoStreamId(roomId, currentUserId);
    const payload = JSON.stringify({
      room_id: roomId,
      privilege: {
        [ZEGO_LOGIN_PRIVILEGE]: 1,
        [ZEGO_PUBLISH_PRIVILEGE]: 1,
      },
      stream_id_list: [streamID],
    });
    const { token, expiresAt } = generateZegoToken04(
      appId,
      currentUserId,
      serverSecret,
      ZEGO_TOKEN_EFFECTIVE_SECONDS,
      payload
    );

    return res.json({
      ...baseDebug,
      roomId,
      tokenLength: token.length,
      tokenPrefixFirst10: token.slice(0, 10),
      tokenExpiresAt: new Date(expiresAt * 1000).toISOString(),
      tokenGenerated: Boolean(token),
    });
  } catch (error) {
    console.error("[Zego Debug Token Error]", {
      bookingId: req.params.bookingId,
      currentUserId,
      message: error.message,
    });
    return res.status(500).json(baseDebug);
  }
});

module.exports = router;
