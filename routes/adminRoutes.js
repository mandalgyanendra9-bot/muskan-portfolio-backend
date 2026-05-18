const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Booking = require("../models/Booking");
const Review = require("../models/Review");
const authMiddleware = require("../middleware/authMiddleware");

// Admin Role Check Middleware
const adminCheck = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "Admin resource. Access denied." });
    }
    next();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 1. GET ALL USERS (Admin only)
router.get("/users", authMiddleware, adminCheck, async (req, res) => {
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 2. TOGGLE EXPERT APPROVAL STATUS (Admin only)
router.put("/expert/:id/approve", authMiddleware, adminCheck, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.role !== "expert") {
      return res.status(400).json({ message: "User is not an expert" });
    }

    user.isApproved = !user.isApproved;
    await user.save();
    
    res.json({ message: `Expert ${user.isApproved ? 'Approved' : 'Disapproved'} successfully`, user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 3. DELETE USER (Admin only)
router.delete("/user/:id", authMiddleware, adminCheck, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 4. GET ALL PAYMENTS (Admin only)
router.get("/payments", authMiddleware, adminCheck, async (req, res) => {
  try {
    const payments = await Booking.find({ paymentStatus: "paid" })
      .populate("client expert", "name email")
      .sort({ createdAt: -1 });
    res.json(payments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 5. GET DETAILED ANALYTICS (Admin only)
router.get("/analytics", authMiddleware, adminCheck, async (req, res) => {
  try {
    const [totalUsers, experts, clients, bookings, completedBookings] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: "expert" }),
      User.countDocuments({ role: { $in: ["client", "user"] } }),
      Booking.countDocuments(),
      Booking.find({ status: "completed", paymentStatus: "paid" })
    ]);

    // Calculate total revenue
    const revenueSum = completedBookings.reduce((sum, b) => sum + b.totalPrice, 0);

    // Calculate conversion / approval ratios
    const approvedExperts = await User.countDocuments({ role: "expert", isApproved: true });
    
    // Fetch latest bookings
    const latestBookings = await Booking.find()
      .populate("client expert", "name email profileImage")
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({
      metrics: {
        totalUsers,
        totalExperts: experts,
        totalClients: clients,
        totalBookings: bookings,
        totalRevenue: revenueSum,
        approvedExperts,
        pendingApprovals: experts - approvedExperts,
      },
      latestBookings
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
