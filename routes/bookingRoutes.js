const express = require("express");
const router = express.Router();
const Booking = require("../models/Booking");
const authMiddleware = require("../middleware/authMiddleware");
const Razorpay = require("razorpay");
const crypto = require("crypto");

let razorpay;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
} else {
  console.warn("Razorpay keys missing. Payment features will be disabled.");
}

// 1. CREATE BOOKING & RAZORPAY ORDER
router.post("/create-order", authMiddleware, async (req, res) => {
  try {
    const { expert, date, duration, totalPrice, notes } = req.body;

    // Create Booking in DB (Pending)
    const booking = await Booking.create({
      client: req.user.id,
      expert,
      date,
      duration,
      totalPrice,
      notes
    });

    // Create Razorpay Order
    const options = {
      amount: totalPrice * 100, // amount in smallest currency unit (paise)
      currency: "INR",
      receipt: `receipt_${booking._id}`,
    };

    if (!razorpay) {
      return res.status(500).json({ message: "Payment system not configured" });
    }

    const order = await razorpay.orders.create(options);

    res.status(201).json({
      booking,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message });
  }
});

// 2. VERIFY PAYMENT SIGNATURE
router.post("/verify-payment", authMiddleware, async (req, res) => {
  try {
    const { 
      bookingId, 
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature 
    } = req.body;

    const body = razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature === razorpay_signature) {
      // Payment Successful
      const booking = await Booking.findByIdAndUpdate(
        bookingId,
        { 
          status: "confirmed", 
          paymentStatus: "paid", 
          paymentId: razorpay_payment_id 
        },
        { new: true }
      );
      res.json({ message: "Payment Verified Successfully", booking });
    } else {
      res.status(400).json({ message: "Invalid Signature" });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 3. GET MY BOOKINGS
router.get("/my-bookings", authMiddleware, async (req, res) => {
  try {
    const bookings = await Booking.find({
      $or: [{ client: req.user.id }, { expert: req.user.id }]
    }).populate("client expert", "name email profileImage title");
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
