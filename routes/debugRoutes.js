const express = require("express");
const crypto = require("crypto");
const Booking = require("../models/Booking");
const authMiddleware = require("../middleware/authMiddleware");
const { hasAdminAccess } = require("../utils/adminAccess");
const {
  ZEGO_TOKEN_EFFECTIVE_SECONDS,
  ZEGO_LOGIN_PRIVILEGE,
  ZEGO_PUBLISH_PRIVILEGE,
  getZegoAppConfig,
  getZegoWebServerConfig,
  generateZegoToken04,
  getZegoStreamId,
} = require("../utils/zego");

const router = express.Router();

const getIdString = (value) => {
  if (!value) return "";
  return String(value?._id || value);
};

const getBookingRoomId = (booking) => booking?._id?.toString?.() || "";

const getBookingParticipantIds = (booking) => ({
  clientId: getIdString(booking.clientId || booking.client),
  expertId: getIdString(booking.expertId || booking.expert),
});

router.get("/zego-token/:bookingId", authMiddleware, async (req, res) => {
  res.set("Cache-Control", "no-store");

  const zegoConfig = getZegoAppConfig();
  const appId = zegoConfig.appID || 0;
  const serverSecret = zegoConfig.serverSecret || "";
  const currentUserId = getIdString(req.user?.id || req.user?._id);
  const zegoWebServer = getZegoWebServerConfig();
  const serverConfigured = zegoWebServer.configured;
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
      stream_id_list: null,
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
