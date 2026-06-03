const express = require("express");
const router = express.Router();
const Booking = require("../models/Booking");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const moment = require('moment-timezone');
const Razorpay = require('razorpay');
const crypto = require("crypto");
const ChatRoom = require('../models/ChatRoom');
const { hasAdminAccess } = require("../utils/adminAccess");
const { applyBookingEarnings, creditExpertWalletForBooking } = require("../utils/earnings");
const { getAvailabilityWindowForDate, getExpertTimezone, parseTimeOnDate } = require("../utils/slotGenerator");
const {
  applyCanonicalBookingTimes,
  ensureBookingVideoCallUrl,
  formatBookingForResponse,
  formatBookingsForResponse,
  getBookingJoinDiagnostics,
  getCanonicalBookingTimes,
  normalizeBookingTimezone,
} = require("../utils/bookingTime");

const CALL_JOIN_EARLY_MINUTES = 5;

const bookingPopulateFields = "name email profilePhotoUrl profileImage profilePhoto avatar photoUrl googlePhoto title rating reviewsCount role";

const getBookingRoomId = (booking) => {
  return booking?._id?.toString?.() || "";
};

const getCallAccess = (booking) => {
  const now = Date.now();
  const { startAt, endAt, timezone } = getCanonicalBookingTimes(booking);
  const startsAt = startAt ? startAt.getTime() : 0;
  const endsAt = endAt ? endAt.getTime() : 0;
  const joinOpensAt = startsAt - CALL_JOIN_EARLY_MINUTES * 60 * 1000;
  const isConfirmedPaid = booking.status === "confirmed" && booking.paymentStatus === "paid";
  const joinDiagnostics = getBookingJoinDiagnostics(booking, now);

  return {
    roomId: getBookingRoomId(booking),
    startsAt: startAt,
    endsAt: endAt,
    timezone,
    joinOpensAt: new Date(joinOpensAt),
    graceEndsAt: endAt,
    remainingMs: Math.max(0, endsAt - now),
    canJoin: isConfirmedPaid && startsAt > 0 && endsAt > 0 && now >= joinOpensAt && now < endsAt,
    isEarly: isConfirmedPaid && now < joinOpensAt,
    isExpired: endsAt > 0 && (now >= endsAt || booking.status === "completed"),
    serverNow: joinDiagnostics.serverNow,
    joinReason: joinDiagnostics.joinReason,
    secondsUntilJoin: joinDiagnostics.secondsUntilJoin,
    secondsUntilEnd: joinDiagnostics.secondsUntilEnd,
  };
};

const canAccessBooking = async (booking, userId, options = {}) => {
  const clientObjectId = booking.clientId || booking.client;
  const expertObjectId = booking.expertId || booking.expert;
  const clientId = clientObjectId?.toString?.();
  const expertId = expertObjectId?.toString?.();
  const isClient = clientId === userId;
  const isExpert = expertId === userId;
  if (isClient || isExpert) {
    const currentUser = await User.findById(userId).select("blockedUsers blockedBy role email");
    const otherUserId = isClient ? expertId : clientId;
    const otherUser = await User.findById(otherUserId).select("blockedUsers blockedBy");

    const currentBlocked = (currentUser?.blockedUsers || []).some((id) => id.toString() === otherUserId);
    const currentBlockedBy = (currentUser?.blockedBy || []).some((id) => id.toString() === otherUserId);
    const otherBlockedCurrent = (otherUser?.blockedUsers || []).some((id) => id.toString() === userId);
    const otherBlockedByCurrent = (otherUser?.blockedBy || []).some((id) => id.toString() === userId);

    if (currentBlocked || currentBlockedBy || otherBlockedCurrent || otherBlockedByCurrent) {
      return false;
    }

    return true;
  }
  if (!options.allowAdmin) return false;
  const user = await User.findById(userId).select("email role");
  return hasAdminAccess(user);
};

const populateBooking = (query) => query.populate("client expert", bookingPopulateFields);

const cancelPendingBooking = async (booking, paymentStatus = "failed", reason = "") => {
  if (!booking) return null;
  if (booking.paymentStatus === "paid") return booking;

  booking.status = "cancelled";
  booking.bookingStatus = "cancelled";
  booking.paymentStatus = paymentStatus;
  booking.paymentFailureReason = reason ? String(reason).slice(0, 500) : "";
  await booking.save();
  return booking;
};

const isMutualBlock = async (userId, otherUserId) => {
  const [currentUser, otherUser] = await Promise.all([
    User.findById(userId).select("blockedUsers blockedBy"),
    User.findById(otherUserId).select("blockedUsers blockedBy"),
  ]);

  return Boolean(
    (currentUser?.blockedUsers || []).some((id) => id.toString() === otherUserId) ||
    (currentUser?.blockedBy || []).some((id) => id.toString() === otherUserId) ||
    (otherUser?.blockedUsers || []).some((id) => id.toString() === userId) ||
    (otherUser?.blockedBy || []).some((id) => id.toString() === userId)
  );
};

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const getExpertPerMinuteRate = (expert = {}) => roundMoney(
  Number(expert.perMinuteRate) > 0
    ? Number(expert.perMinuteRate)
    : Number(expert.pricePerMinute) > 0
      ? Number(expert.pricePerMinute)
      : Number(expert.hourlyRate || 0) / 60
);

const calculateBookingPrice = (expert, durationMinutes) =>
  roundMoney(getExpertPerMinuteRate(expert) * durationMinutes);

const normalizeDurationMinutes = (value) => {
  const duration = Number(value);
  if (!Number.isInteger(duration) || duration < 1 || duration > 240) return null;
  return duration;
};

const getClientSubmittedAmount = (body = {}) => {
  const value = body.totalAmount ?? body.totalPrice;
  if (value === undefined || value === null || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? roundMoney(amount) : null;
};

const getBookingSelection = (body = {}, expert = {}) => {
  const timezone = normalizeBookingTimezone(body.timezone || getExpertTimezone(expert));
  let start;
  let end;
  let durationMinutes = normalizeDurationMinutes(body.durationMinutes ?? body.duration);

  if (body.startAt) {
    start = moment(body.startAt).tz(timezone);
    if (!start.isValid()) {
      return { error: "Valid booking slot is required" };
    }
    if (body.endAt) {
      end = moment(body.endAt).tz(timezone);
      if (!end.isValid() || !end.isAfter(start)) {
        return { error: "Valid booking slot is required" };
      }
      durationMinutes = normalizeDurationMinutes(Math.round(end.diff(start, "minutes", true)));
    } else {
      if (!durationMinutes) {
        return { error: "Invalid duration selected." };
      }
      end = start.clone().add(durationMinutes, "minutes");
    }
  } else if (body.date && body.startTime) {
    const rawDate = String(body.date || "").trim();
    const dateOnly = rawDate.includes("T")
      ? moment(rawDate).tz(timezone).format("YYYY-MM-DD")
      : rawDate;
    start = parseTimeOnDate(dateOnly, body.startTime, timezone);
    if (!start.isValid()) {
      return { error: "Valid booking slot is required" };
    }
    if (!durationMinutes) {
      return { error: "Invalid duration selected." };
    }
    end = start.clone().add(durationMinutes, "minutes");
  } else {
    if (!body.slotStart && !body.date) {
      return { error: "Valid booking slot is required" };
    }
    start = body.slotStart ? moment(body.slotStart).tz(timezone) : moment(body.date).tz(timezone);
    if (!start.isValid()) {
      return { error: "Valid booking slot is required" };
    }

    if (body.slotEnd) {
      end = moment(body.slotEnd).tz(timezone);
      if (!end.isValid() || !end.isAfter(start)) {
        return { error: "Valid booking slot is required" };
      }
      durationMinutes = normalizeDurationMinutes(Math.round(end.diff(start, "minutes", true)));
    } else {
      if (!durationMinutes) {
        return { error: "Invalid duration selected." };
      }
      end = start.clone().add(durationMinutes, "minutes");
    }
  }

  if (!durationMinutes) {
    return { error: "Invalid duration selected." };
  }

  return {
    start,
    end,
    date: start.format("YYYY-MM-DD"),
    startTime: start.format("HH:mm"),
    endTime: end.format("HH:mm"),
    durationMinutes,
    timezone,
  };
};

const getRazorpayKeyId = () => String(process.env.RAZORPAY_KEY_ID || "").trim();
const getRazorpayKeySecret = () => String(process.env.RAZORPAY_KEY_SECRET || "").trim();

const getRazorpayMode = (keyId = "") => {
  const text = String(keyId || "");
  if (text.startsWith("rzp_test_")) return "test";
  if (text.startsWith("rzp_live_")) return "live";
  return "unknown";
};

const getRazorpayConfigStatus = () => {
  const keyId = getRazorpayKeyId();
  const secret = getRazorpayKeySecret();
  return {
    hasKeyId: Boolean(keyId),
    hasSecret: Boolean(secret),
    keyMode: getRazorpayMode(keyId),
  };
};

const getSafeRazorpayErrorDetails = (error) => ({
  message: error?.error?.description || error?.error?.reason || error?.message || "Razorpay request failed",
  statusCode: error?.statusCode || error?.error?.statusCode || error?.response?.status || null,
  code: error?.error?.code || error?.code || null,
});

const getRazorpayResponseStatus = (error) => {
  const statusCode = Number(getSafeRazorpayErrorDetails(error).statusCode);
  return statusCode >= 400 && statusCode < 500 ? statusCode : 502;
};

const RAZORPAY_CONFIG_ERROR_MESSAGE = "Razorpay live keys are not configured on backend.";

let razorpay;
if (getRazorpayKeyId() && getRazorpayKeySecret()) {
  razorpay = new Razorpay({
    key_id: getRazorpayKeyId(),
    key_secret: getRazorpayKeySecret(),
  });
} else {
  console.warn("Razorpay keys missing. Booking checkout is disabled until platform Razorpay keys are configured.");
}

// 1. CREATE BOOKING & ORDER
router.post("/create-order", authMiddleware, async (req, res) => {
  let booking = null;
  try {
    const { expert: expertId, totalPrice, totalAmount, notes } = req.body;
    if (!razorpay) {
      console.error("[Razorpay Booking Config Missing]", {
        endpoint: "POST /api/bookings/create-order",
        expertId: expertId || null,
        bookingId: null,
        amount: Math.round((Number(totalAmount ?? totalPrice) || 0) * 100) || null,
        ...getRazorpayConfigStatus(),
      });
      return res.status(500).json({ message: RAZORPAY_CONFIG_ERROR_MESSAGE });
    }

    // Verify expert availability and role
    const expert = await User.findById(expertId);
    if (!expert) return res.status(404).json({ message: "Expert not found" });
    if (expert.role !== "expert") return res.status(400).json({ message: "Selected user is not an expert" });
    if (!expert.isAvailable) return res.status(400).json({ message: "Expert is not accepting bookings right now" });

    const bookingSelection = getBookingSelection(req.body, expert);
    if (bookingSelection.error === "Invalid duration selected.") {
      return res.status(400).json({ message: "Invalid duration selected." });
    }
    if (bookingSelection.error) {
      return res.status(400).json({ message: bookingSelection.error });
    }

    const now = moment().tz(bookingSelection.timezone);
    if (bookingSelection.start.isSameOrBefore(now)) {
      return res.status(400).json({ message: "Please select a future time." });
    }

    const availabilityWindow = getAvailabilityWindowForDate(expert, bookingSelection.date);
    if (
      !availabilityWindow ||
      bookingSelection.start.isBefore(availabilityWindow.start) ||
      bookingSelection.end.isAfter(availabilityWindow.end)
    ) {
      return res.status(400).json({ message: "Selected time is outside expert availability." });
    }

    const bookingConflict = await Booking.exists({
      $or: [{ expert: expertId }, { expertId }],
      status: { $ne: "cancelled" },
      paymentStatus: { $nin: ["failed", "cancelled", "refunded"] },
      slotStart: { $lt: bookingSelection.end.toDate() },
      slotEnd: { $gt: bookingSelection.start.toDate() },
    });
    if (bookingConflict) {
      return res.status(409).json({ message: "This time is already booked." });
    }

    if (await isMutualBlock(req.user.id, expertId)) {
      return res.status(403).json({ message: "Booking blocked due to user privacy settings" });
    }

    const client = await User.findById(req.user.id).select("subscriptionPlan");
    const perMinuteRate = getExpertPerMinuteRate(expert);
    const numericTotalPrice = calculateBookingPrice(expert, bookingSelection.durationMinutes);
    const clientSubmittedAmount = getClientSubmittedAmount(req.body);

    if (!perMinuteRate || perMinuteRate <= 0 || !numericTotalPrice || numericTotalPrice <= 0) {
      return res.status(400).json({ message: "Expert booking price is not configured yet" });
    }
    if (clientSubmittedAmount !== null && Math.abs(clientSubmittedAmount - numericTotalPrice) > 0.01) {
      return res.status(400).json({ message: "Booking amount does not match expert per-minute pricing." });
    }

    // Create Booking in DB (Pending status by default)
    booking = await Booking.create({
      client: req.user.id,
      clientId: req.user.id,
      expert: expertId,
      expertId,
      startAt: bookingSelection.start.toDate(),
      endAt: bookingSelection.end.toDate(),
      timezone: bookingSelection.timezone,
      date: bookingSelection.date,
      startTime: bookingSelection.startTime,
      endTime: bookingSelection.endTime,
      slotStart: bookingSelection.start.toDate(),
      slotEnd: bookingSelection.end.toDate(),
      duration: bookingSelection.durationMinutes,
      durationMinutes: bookingSelection.durationMinutes,
      perMinuteRate,
      totalPrice: numericTotalPrice,
      totalAmount: numericTotalPrice,
      notes,
      isPriority: client?.subscriptionPlan === "premium",
      meetingLink: "",
      videoCallUrl: "",
    });

    const orderAmount = Math.round(numericTotalPrice * 100);
    const options = {
      amount: orderAmount,
      currency: "INR",
      receipt: `receipt_${booking._id}`,
      notes: {
        bookingId: booking._id.toString(),
        expertId: expertId.toString(),
        clientId: req.user.id.toString(),
      },
    };

    const orderLogContext = {
      endpoint: "POST /api/bookings/create-order",
      bookingId: booking._id.toString(),
      expertId: expertId.toString(),
      amount: orderAmount,
      durationMinutes: booking.durationMinutes,
      perMinuteRate: booking.perMinuteRate,
      ...getRazorpayConfigStatus(),
    };

    console.info("[Razorpay Booking Create Order Request]", orderLogContext);

    let order;
    try {
      order = await razorpay.orders.create(options);
    } catch (error) {
      const razorpayError = getSafeRazorpayErrorDetails(error);
      await cancelPendingBooking(booking, "failed", razorpayError.message).catch(() => {});
      console.error("[Razorpay Booking Create Order Failed]", {
        ...orderLogContext,
        razorpayError,
        stack: error?.stack,
      });
      return res.status(getRazorpayResponseStatus(error)).json({
        message: "Razorpay order creation failed",
        razorpayError,
      });
    }
    const razorpayMode = getRazorpayMode(getRazorpayKeyId());

    console.info("[Razorpay Booking Order Created]", {
      bookingId: booking._id.toString(),
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyMode: razorpayMode,
    });

    booking.orderId = order.id;
    booking.paymentStatus = "unpaid";
    booking.bookingStatus = booking.status;
    ensureBookingVideoCallUrl(booking);
    await booking.save();

    res.status(201).json({
      booking: formatBookingForResponse(booking),
      orderId: order.id,
      amount: order.amount,
      totalAmount: numericTotalPrice,
      perMinuteRate: booking.perMinuteRate,
      durationMinutes: booking.durationMinutes,
      currency: order.currency,
      keyId: getRazorpayKeyId(),
      keyMode: razorpayMode,
    });
  } catch (error) {
    if (booking) {
      await cancelPendingBooking(booking, "failed", error.message).catch(() => {});
    }
    console.error("[Booking Create Order Error]", {
      endpoint: "POST /api/bookings/create-order",
      bookingId: booking?._id?.toString?.() || null,
      expertId: req.body?.expert || null,
      amount: Math.round((Number(req.body?.totalAmount ?? req.body?.totalPrice) || 0) * 100) || null,
      ...getRazorpayConfigStatus(),
      message: error?.message,
      stack: error?.stack,
    });
    res.status(400).json({ message: error.message });
  }
});

// 2. VERIFY PAYMENT SIGNATURE
router.post("/verify-payment", authMiddleware, async (req, res) => {
  const verifyLogContext = {
    endpoint: "POST /api/bookings/verify-payment",
    bookingId: req.body?.bookingId || null,
    expertId: null,
    amount: null,
    ...getRazorpayConfigStatus(),
  };

  try {
    const { 
      bookingId, 
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature
    } = req.body;

    if (!razorpay) {
      console.error("[Razorpay Booking Config Missing]", {
        endpoint: "POST /api/bookings/verify-payment",
        bookingId: bookingId || null,
        expertId: null,
        amount: null,
        ...getRazorpayConfigStatus(),
      });
      return res.status(500).json({ message: RAZORPAY_CONFIG_ERROR_MESSAGE });
    }
    if (!bookingId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: "Razorpay payment verification details are required" });
    }

    const bookingDoc = await Booking.findById(bookingId);
    if (!bookingDoc) return res.status(404).json({ message: "Booking not found" });
    if (String(bookingDoc.clientId || bookingDoc.client) !== String(req.user.id)) {
      return res.status(403).json({ message: "You are not authorized to verify this booking payment" });
    }
    verifyLogContext.expertId = bookingDoc.expert?.toString?.() || null;
    verifyLogContext.amount = Math.round((Number(bookingDoc.totalPrice) || 0) * 100) || null;

    if (bookingDoc.paymentStatus === "paid" && bookingDoc.paymentId === razorpay_payment_id) {
      const booking = await populateBooking(Booking.findById(bookingDoc._id));
      return res.json({ message: "Payment already verified", booking: formatBookingForResponse(booking) });
    }

    if (bookingDoc.orderId && bookingDoc.orderId !== razorpay_order_id) {
      return res.status(400).json({ message: "Order mismatch for this booking" });
    }

    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac("sha256", getRazorpayKeySecret())
      .update(body.toString())
      .digest("hex");

    if (expectedSignature === razorpay_signature) {
      bookingDoc.clientId = bookingDoc.clientId || bookingDoc.client;
      bookingDoc.expertId = bookingDoc.expertId || bookingDoc.expert;
      bookingDoc.status = "confirmed";
      bookingDoc.bookingStatus = "confirmed";
      bookingDoc.paymentStatus = "paid";
      bookingDoc.paymentId = razorpay_payment_id;
      bookingDoc.paymentFailureReason = "";
      bookingDoc.orderId = bookingDoc.orderId || razorpay_order_id;
      const canonicalTimes = getCanonicalBookingTimes(bookingDoc);
      if (canonicalTimes.startAt && canonicalTimes.endAt) {
        bookingDoc.startAt = canonicalTimes.startAt;
        bookingDoc.endAt = canonicalTimes.endAt;
        bookingDoc.timezone = canonicalTimes.timezone;
      }
      ensureBookingVideoCallUrl(bookingDoc);
      await applyBookingEarnings(bookingDoc);
      await creditExpertWalletForBooking(bookingDoc);
      await bookingDoc.save();
      const booking = await populateBooking(Booking.findById(bookingDoc._id));
      
      // Create ChatRoom for this booking if not exists
      await ChatRoom.findOneAndUpdate(
        { booking: booking._id },
        { $setOnInsert: { booking: booking._id, participants: [booking.client, booking.expert] } },
        { upsert: true, new: true }
      );
      
      res.json({ message: "Payment Verified Successfully", booking: formatBookingForResponse(booking) });
    } else {
      res.status(400).json({ message: "Invalid Signature" });
    }
  } catch (error) {
    console.error("[Booking Verify Payment Error]", {
      ...verifyLogContext,
      message: error?.message,
      stack: error?.stack,
    });
    res.status(500).json({ message: error.message });
  }
});

router.post("/payment-status", authMiddleware, async (req, res) => {
  try {
    const { bookingId, razorpay_order_id, status, reason } = req.body;
    const normalizedStatus = String(status || "").toLowerCase();

    if (!bookingId || !["failed", "cancelled"].includes(normalizedStatus)) {
      return res.status(400).json({ message: "Valid bookingId and payment status are required" });
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    if (booking.paymentStatus === "paid") {
      const populated = await populateBooking(Booking.findById(booking._id));
      return res.json({ message: "Booking already paid", booking: formatBookingForResponse(populated) });
    }

    if (booking.orderId && razorpay_order_id && booking.orderId !== razorpay_order_id) {
      return res.status(400).json({ message: "Order mismatch for this booking" });
    }

    const updated = await cancelPendingBooking(booking, normalizedStatus, reason || "");
    const populated = await populateBooking(Booking.findById(updated._id));
    res.json({
      message: `Payment marked ${normalizedStatus}`,
      booking: formatBookingForResponse(populated),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 3. GET BOOKING DETAILS BY VIDEO ROOM
router.get("/room/:roomId", authMiddleware, async (req, res) => {
  try {
    const roomId = req.params.roomId;
    const bookingDoc = await Booking.findById(roomId).catch(() => null)
      || await Booking.findOne({ meetingLink: `/video-call/${roomId}` });
    if (!bookingDoc) return res.status(404).json({ message: "Meeting room not found" });

    const hasAccess = await canAccessBooking(bookingDoc, req.user.id);
    if (!hasAccess) return res.status(403).json({ message: "You are not authorized for this meeting" });
    const callAccess = getCallAccess(bookingDoc);
    const canLoadEndedPaidBooking = bookingDoc.status === "completed" && bookingDoc.paymentStatus === "paid" && callAccess.isExpired;
    if ((bookingDoc.status !== "confirmed" || bookingDoc.paymentStatus !== "paid") && !canLoadEndedPaidBooking) {
      return res.status(403).json({ message: "This meeting is available only after confirmed payment" });
    }

    const booking = await populateBooking(Booking.findById(bookingDoc._id));
    res.json({ booking: formatBookingForResponse(booking), callAccess });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 4. AUTO-COMPLETE A BOOKING WHEN THE BOOKED CALL TIME ENDS
router.put("/room/:roomId/complete", authMiddleware, async (req, res) => {
  try {
    const roomId = req.params.roomId;
    const booking = await Booking.findById(roomId).catch(() => null)
      || await Booking.findOne({ meetingLink: `/video-call/${roomId}` });
    if (!booking) return res.status(404).json({ message: "Meeting room not found" });

    const hasAccess = await canAccessBooking(booking, req.user.id);
    if (!hasAccess) return res.status(403).json({ message: "You are not authorized for this meeting" });
    if (!["confirmed", "completed"].includes(booking.status) || booking.paymentStatus !== "paid") {
      return res.status(403).json({ message: "Only confirmed paid bookings can be completed from the meeting room" });
    }

    const { endAt } = getCanonicalBookingTimes(booking);
    const endsAt = endAt ? endAt.getTime() : 0;
    if (Date.now() < endsAt) {
      return res.status(400).json({ message: "This call is still inside the booked time" });
    }

    if (booking.status === "confirmed") {
      booking.status = "completed";
      booking.bookingStatus = "completed";
      booking.completedAt = booking.completedAt || new Date();
      await booking.save();
    } else if (booking.status === "completed" && !booking.completedAt) {
      booking.completedAt = new Date();
      await booking.save();
    }

    const updatedBooking = await populateBooking(Booking.findById(booking._id));
    res.json({
      message: "Booked call time ended. Booking marked completed.",
      booking: formatBookingForResponse(updatedBooking),
      callAccess: getCallAccess(updatedBooking),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 3. GET MY BOOKINGS
router.get("/my-bookings", authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const query = req.authUser?.role === "expert"
      ? { $or: [{ expertId: userId }, { expert: userId }] }
      : { $or: [{ clientId: userId }, { client: userId }] };

    const bookings = await Booking.find(query)
      .populate("client expert", bookingPopulateFields)
      .sort({ isPriority: -1, startAt: 1, slotStart: 1 });

    res.json(formatBookingsForResponse(bookings));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 4. GET BOOKING DETAILS
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const bookingDoc = await Booking.findById(req.params.id);
    if (!bookingDoc) return res.status(404).json({ message: "Booking not found" });

    const hasAccess = await canAccessBooking(bookingDoc, req.user.id);
    if (!hasAccess) return res.status(403).json({ message: "You are not authorized to view this booking" });

    const booking = await populateBooking(Booking.findById(bookingDoc._id));
    res.json({
      booking: formatBookingForResponse(booking),
      callAccess: getCallAccess(bookingDoc),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 5. UPDATE BOOKING STATUS (Accept/Reject/Complete/Cancel)
router.put("/:id/status", authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    if (!["pending", "confirmed", "completed", "cancelled"].includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    // Authorization: User must be either client or expert of this booking
    const isClient = booking.client.toString() === req.user.id;
    const isExpert = booking.expert.toString() === req.user.id;
    
    // Admin check
    const user = await User.findById(req.user.id).select("email role");
    const isAdmin = hasAdminAccess(user);


    if (!isClient && !isExpert && !isAdmin) {
      return res.status(403).json({ message: "You are not authorized to edit this booking" });
    }

    // Business rules:
    // Experts can accept/reject pending bookings, or mark them completed.
    // Clients can cancel their bookings.
    booking.status = status;
    booking.bookingStatus = status;
    
    await booking.save();
    
    const updatedBooking = await populateBooking(Booking.findById(booking._id));
      
    res.json(formatBookingForResponse(updatedBooking));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
