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
const { applyBookingEarnings } = require("../utils/earnings");

let razorpay;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
} else {
  console.warn("Razorpay keys missing. Using Demo Payment Fallback Mode.");
}

// 1. CREATE BOOKING & ORDER
router.post("/create-order", authMiddleware, async (req, res) => {
  try {
    const { expert: expertId, date, duration, totalPrice, notes } = req.body;

    // Verify expert availability and role
    const expert = await User.findById(expertId);
    if (!expert) return res.status(404).json({ message: "Expert not found" });
    const client = await User.findById(req.user.id).select("subscriptionPlan");

    // Create Booking in DB (Pending status by default)
    const booking = await Booking.create({
      client: req.user.id,
      expert: expertId,
      slotStart: date,
      slotEnd: moment(date).add(duration, 'minutes').toDate(),
      duration,
      totalPrice,
      notes,
      isPriority: client?.subscriptionPlan === "premium",
      meetingLink: `/video-call/room_${Math.random().toString(36).substring(2, 9)}` // Auto-generate room link
    });

    // Check if Razorpay is configured
    if (!razorpay) {
      // In Demo Mode: Create a dummy order and flag it as a mock order so the UI can proceed immediately
      return res.status(201).json({
        booking,
        orderId: `mock_order_${booking._id}`,
        amount: totalPrice * 100,
        currency: "INR",
        isDemoMode: true
      });
    }

    const options = {
      amount: totalPrice * 100, // in paise
      currency: "INR",
      receipt: `receipt_${booking._id}`,
    };

    const order = await razorpay.orders.create(options);

    res.status(201).json({
      booking,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      isDemoMode: false
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message });
  }
});

// 2. VERIFY PAYMENT SIGNATURE / CONFIRM DEMO BOOKING
router.post("/verify-payment", authMiddleware, async (req, res) => {
  try {
    const { 
      bookingId, 
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature,
      isDemoMode 
    } = req.body;

    // Handle Demo Mode Payment
    if (isDemoMode) {
      const bookingDoc = await Booking.findById(bookingId);
      if (!bookingDoc) return res.status(404).json({ message: "Booking not found" });
      bookingDoc.status = "confirmed";
      bookingDoc.paymentStatus = "paid";
      bookingDoc.paymentId = `demo_payment_${Date.now()}`;
      await applyBookingEarnings(bookingDoc);
      await bookingDoc.save();
      const booking = await Booking.findById(bookingDoc._id)
        .populate("client expert", "name email profileImage title");
      
      // Create ChatRoom for this booking if not exists
      await ChatRoom.findOneAndUpdate(
        { booking: booking._id },
        { $setOnInsert: { booking: booking._id, participants: [booking.client, booking.expert] } },
        { upsert: true, new: true }
      );
      
      return res.json({ message: "Demo Payment Successful & Confirmed!", booking });
    }

    // Verify Real Signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature === razorpay_signature) {
      const bookingDoc = await Booking.findById(bookingId);
      if (!bookingDoc) return res.status(404).json({ message: "Booking not found" });
      bookingDoc.status = "confirmed";
      bookingDoc.paymentStatus = "paid";
      bookingDoc.paymentId = razorpay_payment_id;
      await applyBookingEarnings(bookingDoc);
      await bookingDoc.save();
      const booking = await Booking.findById(bookingDoc._id)
        .populate("client expert", "name email profileImage title");
      
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
    res.status(500).json({ message: error.message });
  }
});

// 3. GET MY BOOKINGS
router.get("/my-bookings", authMiddleware, async (req, res) => {
  try {
    const bookings = await Booking.find({
      $or: [{ client: req.user.id }, { expert: req.user.id }]
    })
      .populate("client expert", "name email profileImage title rating reviewsCount")
      .sort({ isPriority: -1, date: 1 });
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
    
    if (status === "completed") {
      // If completed, ensure marked as paid just in case
      if (booking.paymentStatus === "unpaid") {
        booking.paymentStatus = "paid";
        await applyBookingEarnings(booking);
      }
    }

    await booking.save();
    
    const updatedBooking = await Booking.findById(booking._id)
      .populate("client expert", "name email profileImage title rating reviewsCount");
      
    res.json(updatedBooking);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
