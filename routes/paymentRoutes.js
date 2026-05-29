const express = require("express");
const router = express.Router();
const Razorpay = require("razorpay");
const crypto = require("crypto");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const Booking = require("../models/Booking");
const authMiddleware = require("../middleware/authMiddleware");
const { applyBookingEarnings, creditExpertWalletForBooking } = require("../utils/earnings");

let razorpay;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
} else {
  console.warn("Razorpay keys missing. Platform checkout is disabled until keys are configured.");
}

const getRazorpayMode = (keyId = "") => {
  const text = String(keyId || "");
  if (text.startsWith("rzp_test_")) return "test";
  if (text.startsWith("rzp_live_")) return "live";
  return "unknown";
};

router.post("/create-order", authMiddleware, async (req, res) => {
  try {
    const { amount, type, description, bookingId } = req.body;
    const numericAmount = Number(amount);

    if (!numericAmount || numericAmount <= 0 || !type) {
      return res.status(400).json({ message: "Valid amount and type are required" });
    }
    if (!razorpay) {
      return res.status(503).json({ message: "Platform Razorpay checkout is not configured yet" });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(numericAmount * 100),
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
    });
    const keyMode = getRazorpayMode(process.env.RAZORPAY_KEY_ID);

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
      keyId: process.env.RAZORPAY_KEY_ID,
      keyMode,
      transactionId: transaction._id,
    });
  } catch (error) {
    console.error("Create Order Error:", error);
    res.status(500).json({ message: error.message });
  }
});

router.post("/verify", authMiddleware, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, transactionId } = req.body;

    if (!razorpay) {
      return res.status(503).json({ message: "Platform Razorpay checkout is not configured yet" });
    }
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !transactionId) {
      return res.status(400).json({ message: "Razorpay payment verification details are required" });
    }

    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
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
      keyId: process.env.RAZORPAY_KEY_ID,
      keyMode: getRazorpayMode(process.env.RAZORPAY_KEY_ID),
    });
  } catch (error) {
    console.error("Verify Payment Error:", error);
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
