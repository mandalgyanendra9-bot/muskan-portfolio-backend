const express = require("express");
const router = express.Router();
const Razorpay = require("razorpay");
const crypto = require("crypto");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const Booking = require("../models/Booking");
const authMiddleware = require("../middleware/authMiddleware");
const { applyBookingEarnings } = require("../utils/earnings");

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ─── CREATE ORDER ─────────────────────────────────────────────────────────────
router.post("/create-order", authMiddleware, async (req, res) => {
  try {
    const { amount, type, description, bookingId } = req.body;
    
    if (!amount || !type) {
      return res.status(400).json({ message: "Amount and type are required" });
    }

    const options = {
      amount: Math.round(amount * 100), // Razorpay expects amount in paise
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
    };

    const order = await razorpay.orders.create(options);

    // Save pending transaction
    const transaction = await Transaction.create({
      user: req.user.id,
      type,
      amount,
      status: "pending",
      razorpayOrderId: order.id,
      description,
      bookingId: bookingId || null,
    });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      transactionId: transaction._id,
    });
  } catch (error) {
    console.error("Create Order Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ─── VERIFY PAYMENT ───────────────────────────────────────────────────────────
router.post("/verify", authMiddleware, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, transactionId } = req.body;

    // Verify signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest("hex");

    const isAuthentic = expectedSignature === razorpay_signature;

    if (!isAuthentic) {
      await Transaction.findByIdAndUpdate(transactionId, { status: "failed" });
      return res.status(400).json({ message: "Invalid payment signature" });
    }

    // Payment is valid
    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    transaction.status = "success";
    transaction.razorpayPaymentId = razorpay_payment_id;
    transaction.razorpaySignature = razorpay_signature;
    await transaction.save();

    const user = await User.findById(req.user.id);

    // Handle based on transaction type
    if (transaction.type === "wallet_topup") {
      user.walletBalance += transaction.amount;
      await user.save();
    } else if (transaction.type === "subscription") {
      // Logic for subscription (e.g. 30 days)
      user.subscriptionPlan = transaction.description.toLowerCase().includes("premium") ? "premium" : "pro";
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
        await booking.save();

        const expert = await User.findById(booking.expert);
        if (expert) {
          expert.completedPaidBookings = (expert.completedPaidBookings || 0) + 1;

          await expert.save();
        }
      }
    }

    res.json({ message: "Payment verified successfully", user });
  } catch (error) {
    console.error("Verify Payment Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ─── GET PAYMENT HISTORY ──────────────────────────────────────────────────────
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

// ─── WITHDRAW FUNDS ───────────────────────────────────────────────────────────
router.post("/withdraw", authMiddleware, async (req, res) => {
  try {
    const { amount, bankDetails } = req.body;
    
    if (!amount || amount < 100) {
      return res.status(400).json({ message: "Minimum withdrawal is ₹100" });
    }

    const user = await User.findById(req.user.id);
    if (user.walletBalance < amount) {
      return res.status(400).json({ message: "Insufficient wallet balance" });
    }

    // Deduct balance immediately
    user.walletBalance -= amount;
    await user.save();

    const transaction = await Transaction.create({
      user: req.user.id,
      type: "withdrawal",
      amount,
      status: "processing", // Admin handles processing later
      bankDetails,
      description: "Wallet Withdrawal",
    });

    res.json({ message: "Withdrawal request submitted", transaction, walletBalance: user.walletBalance });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ─── PAY FROM WALLET (For Bookings) ───────────────────────────────────────────
router.post("/pay-wallet", authMiddleware, async (req, res) => {
  try {
    const { amount, bookingId } = req.body;

    const user = await User.findById(req.user.id);
    if (user.walletBalance < amount) {
      return res.status(400).json({ message: "Insufficient wallet balance" });
    }

    user.walletBalance -= amount;
    await user.save();

    const transaction = await Transaction.create({
      user: req.user.id,
      type: "booking_payment",
      amount,
      status: "success",
      description: "Paid via Wallet",
      bookingId,
    });

    const booking = await Booking.findById(bookingId);
    if (booking) {
      booking.paymentStatus = "paid";
      await applyBookingEarnings(booking, amount);
      await booking.save();
      
      const expert = await User.findById(booking.expert);
      if (expert) {
        expert.completedPaidBookings = (expert.completedPaidBookings || 0) + 1;
        await expert.save();
      }
    }

    res.json({ message: "Paid from wallet successfully", user });
  } catch (error) {
    console.error('Pay Wallet error:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
