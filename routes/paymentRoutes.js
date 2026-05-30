const express = require("express");
const router = express.Router();
const Razorpay = require("razorpay");
const crypto = require("crypto");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const Booking = require("../models/Booking");
const authMiddleware = require("../middleware/authMiddleware");
const { applyBookingEarnings, creditExpertWalletForBooking } = require("../utils/earnings");

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
  console.warn("Razorpay keys missing. Platform checkout is disabled until keys are configured.");
}

router.post("/create-order", authMiddleware, async (req, res) => {
  try {
    const { amount, type, description, bookingId } = req.body;
    const numericAmount = Number(amount);

    if (!numericAmount || numericAmount <= 0 || !type) {
      return res.status(400).json({ message: "Valid amount and type are required" });
    }
    if (!razorpay) {
      console.error("[Razorpay Payment Config Missing]", {
        endpoint: "POST /api/payments/create-order",
        bookingId: bookingId || null,
        expertId: null,
        amount: Math.round(numericAmount * 100),
        type,
        ...getRazorpayConfigStatus(),
      });
      return res.status(500).json({ message: RAZORPAY_CONFIG_ERROR_MESSAGE });
    }

    const orderAmount = Math.round(numericAmount * 100);
    const orderLogContext = {
      endpoint: "POST /api/payments/create-order",
      bookingId: bookingId || null,
      expertId: null,
      amount: orderAmount,
      type,
      ...getRazorpayConfigStatus(),
    };

    console.info("[Razorpay Payment Create Order Request]", orderLogContext);

    let order;
    try {
      order = await razorpay.orders.create({
        amount: orderAmount,
        currency: "INR",
        receipt: `receipt_${Date.now()}`,
      });
    } catch (error) {
      const razorpayError = getSafeRazorpayErrorDetails(error);
      console.error("[Razorpay Payment Create Order Failed]", {
        ...orderLogContext,
        razorpayError,
        stack: error?.stack,
      });
      return res.status(getRazorpayResponseStatus(error)).json({
        message: "Razorpay order creation failed",
        razorpayError,
      });
    }
    const keyMode = getRazorpayMode(getRazorpayKeyId());

    console.info("[Razorpay Payment Order Created]", {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyMode,
      type,
    });

    const transaction = await Transaction.create({
      user: req.user.id,
      type,
      amount: numericAmount,
      status: "pending",
      razorpayOrderId: order.id,
      description,
      bookingId: bookingId || null,
    });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: getRazorpayKeyId(),
      keyMode,
      transactionId: transaction._id,
    });
  } catch (error) {
    console.error("[Payment Create Order Error]", {
      endpoint: "POST /api/payments/create-order",
      bookingId: req.body?.bookingId || null,
      expertId: null,
      amount: Math.round((Number(req.body?.amount) || 0) * 100) || null,
      type: req.body?.type || null,
      ...getRazorpayConfigStatus(),
      message: error?.message,
      stack: error?.stack,
    });
    res.status(500).json({ message: error.message });
  }
});

router.post("/verify", authMiddleware, async (req, res) => {
  const verifyLogContext = {
    endpoint: "POST /api/payments/verify",
    bookingId: null,
    expertId: null,
    amount: null,
    ...getRazorpayConfigStatus(),
  };

  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, transactionId } = req.body;

    if (!razorpay) {
      console.error("[Razorpay Payment Config Missing]", {
        endpoint: "POST /api/payments/verify",
        bookingId: null,
        expertId: null,
        amount: null,
        ...getRazorpayConfigStatus(),
      });
      return res.status(500).json({ message: RAZORPAY_CONFIG_ERROR_MESSAGE });
    }
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !transactionId) {
      return res.status(400).json({ message: "Razorpay payment verification details are required" });
    }

    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac("sha256", getRazorpayKeySecret())
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      await Transaction.findByIdAndUpdate(transactionId, { status: "failed" });
      return res.status(400).json({ message: "Invalid payment signature" });
    }

    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }
    verifyLogContext.bookingId = transaction.bookingId?.toString?.() || null;
    verifyLogContext.amount = Math.round((Number(transaction.amount) || 0) * 100) || null;

    transaction.status = "success";
    transaction.razorpayPaymentId = razorpay_payment_id;
    transaction.razorpaySignature = razorpay_signature;
    await transaction.save();

    const user = await User.findById(req.user.id);

    if (transaction.type === "wallet_topup") {
      user.walletBalance += transaction.amount;
      await user.save();
    } else if (transaction.type === "subscription") {
      user.subscriptionPlan = transaction.description?.toLowerCase().includes("premium") ? "premium" : "pro";
      const expires = new Date();
      expires.setDate(expires.getDate() + 30);
      user.subscriptionExpiresAt = expires;
      await user.save();
    } else if (transaction.type === "booking_payment" && transaction.bookingId) {
      const booking = await Booking.findById(transaction.bookingId);
      if (booking) {
        verifyLogContext.expertId = booking.expert?.toString?.() || null;
        booking.status = booking.status === "pending" ? "confirmed" : booking.status;
        booking.bookingStatus = booking.status;
        booking.paymentStatus = "paid";
        booking.paymentId = razorpay_payment_id;
        await applyBookingEarnings(booking, transaction.amount);
        await creditExpertWalletForBooking(booking);
        await booking.save();
      }
    }

    res.json({
      message: "Payment verified successfully",
      user,
      keyId: getRazorpayKeyId(),
      keyMode: getRazorpayMode(getRazorpayKeyId()),
    });
  } catch (error) {
    console.error("[Payment Verify Error]", {
      ...verifyLogContext,
      message: error?.message,
      stack: error?.stack,
    });
    res.status(500).json({ message: error.message });
  }
});

router.get("/history", authMiddleware, async (req, res) => {
  try {
    const transactions = await Transaction.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .populate("bookingId");

    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/withdraw", authMiddleware, (req, res) => {
  res.status(400).json({
    message: "Expert payouts must be requested from Payout Settings and processed manually by admin",
  });
});

router.post("/pay-wallet", authMiddleware, (req, res) => {
  res.status(400).json({ message: "Booking payments must use platform Razorpay Checkout" });
});

module.exports = router;
