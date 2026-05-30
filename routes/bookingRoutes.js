const express = require("express");
const router = express.Router();
const Booking = require("../models/Booking");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const moment = require('moment');
const Razorpay = require('razorpay');
const crypto = require("crypto");
const ChatRoom = require('../models/ChatRoom');
const { hasAdminAccess } = require("../utils/adminAccess");
const { applyBookingEarnings, creditExpertWalletForBooking } = require("../utils/earnings");

const CALL_JOIN_EARLY_MINUTES = 10;
const CALL_GRACE_AFTER_END_MINUTES = 5;

const bookingPopulateFields = "name email profilePhotoUrl profileImage profilePhoto avatar photoUrl googlePhoto title rating reviewsCount role";

const getBookingRoomId = (booking) => {
  const link = booking?.meetingLink || "";
  return link.split("/").filter(Boolean).pop() || "";
};

const getCallAccess = (booking) => {
  const now = Date.now();
  const startsAt = new Date(booking.slotStart).getTime();
  const endsAt = new Date(booking.slotEnd).getTime();
  const joinOpensAt = startsAt - CALL_JOIN_EARLY_MINUTES * 60 * 1000;
  const graceEndsAt = endsAt + CALL_GRACE_AFTER_END_MINUTES * 60 * 1000;
  const isConfirmedPaid = booking.status === "confirmed" && booking.paymentStatus === "paid";

  return {
    roomId: getBookingRoomId(booking),
    startsAt: booking.slotStart,
    endsAt: booking.slotEnd,
    joinOpensAt: new Date(joinOpensAt),
    graceEndsAt: new Date(graceEndsAt),
    remainingMs: Math.max(0, endsAt - now),
    canJoin: isConfirmedPaid && now >= joinOpensAt && now <= graceEndsAt,
    isEarly: isConfirmedPaid && now < joinOpensAt,
    isExpired: now > graceEndsAt || booking.status === "completed",
  };
};

const canAccessBooking = async (booking, userId) => {
  const isClient = booking.client.toString() === userId;
  const isExpert = booking.expert.toString() === userId;
  if (isClient || isExpert) {
    const currentUser = await User.findById(userId).select("blockedUsers blockedBy role email");
    const otherUserId = isClient ? booking.expert.toString() : booking.client.toString();
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
  const user = await User.findById(userId).select("email role");
  return hasAdminAccess(user);
};

const populateBooking = (query) => query.populate("client expert", bookingPopulateFields);

const cancelPendingBooking = async (booking, paymentStatus = "failed", reason = "") => {
  if (!booking) return null;
  if (booking.paymentStatus === "paid") return booking;

  booking.status = "cancelled";
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

const calculateBookingPrice = (expert, durationMinutes, clientTotalPrice) => {
  const pricePerMinute = Number(expert.pricePerMinute) > 0
    ? Number(expert.pricePerMinute)
    : Number(expert.hourlyRate || 0) / 60;
  const computed = Math.round(pricePerMinute * durationMinutes);
  const clientPrice = Math.round(Number(clientTotalPrice) || 0);
  return computed > 0 ? computed : clientPrice;
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
    const { expert: expertId, date, slotStart, slotEnd, duration, totalPrice, notes } = req.body;
    const startDate = new Date(slotStart || date);
    const requestedDuration = Math.max(1, Math.round(Number(duration) || 0));
    const endDate = slotEnd
      ? new Date(slotEnd)
      : moment(startDate).add(requestedDuration, 'minutes').toDate();
    const durationMinutes = Math.max(
      1,
      Math.round((endDate.getTime() - startDate.getTime()) / 60000) || requestedDuration
    );

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
      return res.status(400).json({ message: "Valid booking slot is required" });
    }
    if (!razorpay) {
      console.error("[Razorpay Booking Config Missing]", {
        endpoint: "POST /api/bookings/create-order",
        expertId: expertId || null,
        bookingId: null,
        amount: Math.round((Number(totalPrice) || 0) * 100) || null,
        ...getRazorpayConfigStatus(),
      });
      return res.status(500).json({ message: RAZORPAY_CONFIG_ERROR_MESSAGE });
    }

    // Verify expert availability and role
    const expert = await User.findById(expertId);
    if (!expert) return res.status(404).json({ message: "Expert not found" });
    if (expert.role !== "expert") return res.status(400).json({ message: "Selected user is not an expert" });
    if (!expert.isAvailable) return res.status(400).json({ message: "Expert is not accepting bookings right now" });

    const bookingConflict = await Booking.exists({
      expert: expertId,
      status: { $ne: "cancelled" },
      slotStart: { $lt: endDate },
      slotEnd: { $gt: startDate },
    });
    if (bookingConflict) {
      return res.status(409).json({ message: "This slot is already booked. Please choose another time." });
    }

    if (await isMutualBlock(req.user.id, expertId)) {
      return res.status(403).json({ message: "Booking blocked due to user privacy settings" });
    }

    const client = await User.findById(req.user.id).select("subscriptionPlan");
    const numericTotalPrice = calculateBookingPrice(expert, durationMinutes, totalPrice);

    if (!numericTotalPrice || numericTotalPrice <= 0) {
      return res.status(400).json({ message: "Expert booking price is not configured yet" });
    }

    // Create Booking in DB (Pending status by default)
    booking = await Booking.create({
      client: req.user.id,
      expert: expertId,
      slotStart: startDate,
      slotEnd: endDate,
      duration: durationMinutes,
      totalPrice: numericTotalPrice,
      notes,
      isPriority: client?.subscriptionPlan === "premium",
      meetingLink: `/video-call/room_${Math.random().toString(36).substring(2, 9)}` // Auto-generate room link
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
    await booking.save();

    res.status(201).json({
      booking,
      orderId: order.id,
      amount: order.amount,
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
      amount: Math.round((Number(req.body?.totalPrice) || 0) * 100) || null,
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
    verifyLogContext.expertId = bookingDoc.expert?.toString?.() || null;
    verifyLogContext.amount = Math.round((Number(bookingDoc.totalPrice) || 0) * 100) || null;

    if (bookingDoc.paymentStatus === "paid" && bookingDoc.paymentId === razorpay_payment_id) {
      const booking = await populateBooking(Booking.findById(bookingDoc._id));
      return res.json({ message: "Payment already verified", booking });
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
      bookingDoc.status = "confirmed";
      bookingDoc.paymentStatus = "paid";
      bookingDoc.paymentId = razorpay_payment_id;
      bookingDoc.paymentFailureReason = "";
      bookingDoc.orderId = bookingDoc.orderId || razorpay_order_id;
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
      
      res.json({ message: "Payment Verified Successfully", booking });
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
      return res.json({ message: "Booking already paid", booking: populated });
    }

    if (booking.orderId && razorpay_order_id && booking.orderId !== razorpay_order_id) {
      return res.status(400).json({ message: "Order mismatch for this booking" });
    }

    const updated = await cancelPendingBooking(booking, normalizedStatus, reason || "");
    const populated = await populateBooking(Booking.findById(updated._id));
    res.json({
      message: `Payment marked ${normalizedStatus}`,
      booking: populated,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 3. GET BOOKING DETAILS BY VIDEO ROOM
router.get("/room/:roomId", authMiddleware, async (req, res) => {
  try {
    const roomId = req.params.roomId;
    const bookingDoc = await Booking.findOne({ meetingLink: `/video-call/${roomId}` });
    if (!bookingDoc) return res.status(404).json({ message: "Meeting room not found" });

    const hasAccess = await canAccessBooking(bookingDoc, req.user.id);
    if (!hasAccess) return res.status(403).json({ message: "You are not authorized for this meeting" });

    const booking = await populateBooking(Booking.findById(bookingDoc._id));
    res.json({ booking, callAccess: getCallAccess(bookingDoc) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 4. AUTO-COMPLETE A BOOKING WHEN THE BOOKED CALL TIME ENDS
router.put("/room/:roomId/complete", authMiddleware, async (req, res) => {
  try {
    const roomId = req.params.roomId;
    const booking = await Booking.findOne({ meetingLink: `/video-call/${roomId}` });
    if (!booking) return res.status(404).json({ message: "Meeting room not found" });

    const hasAccess = await canAccessBooking(booking, req.user.id);
    if (!hasAccess) return res.status(403).json({ message: "You are not authorized for this meeting" });

    const endsAt = new Date(booking.slotEnd).getTime();
    if (Date.now() < endsAt) {
      return res.status(400).json({ message: "This call is still inside the booked time" });
    }

    if (booking.status === "confirmed") {
      booking.status = "completed";
      await booking.save();
    }

    const updatedBooking = await populateBooking(Booking.findById(booking._id));
    res.json({
      message: "Booked call time ended. Booking marked completed.",
      booking: updatedBooking,
      callAccess: getCallAccess(updatedBooking),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 3. GET MY BOOKINGS
router.get("/my-bookings", authMiddleware, async (req, res) => {
  try {
    const bookings = await Booking.find({
      $or: [{ client: req.user.id }, { expert: req.user.id }]
    })
      .populate("client expert", bookingPopulateFields)
      .sort({ isPriority: -1, slotStart: 1 });
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 4. UPDATE BOOKING STATUS (Accept/Reject/Complete/Cancel)
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
    
    await booking.save();
    
    const updatedBooking = await populateBooking(Booking.findById(booking._id));
      
    res.json(updatedBooking);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
