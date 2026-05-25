const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Booking = require("../models/Booking");
const Message = require("../models/Message");
const Payout = require("../models/Payout");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const { isAdminEmail } = require("../utils/adminAccess");
const {
  applyBookingEarnings,
  creditExpertWalletForBooking,
  getBookingEarnings,
  getPlatformSettings,
  roundMoney,
} = require("../utils/earnings");

const BOOKING_STATUSES = ["pending", "confirmed", "completed", "cancelled"];
const PAYMENT_STATUSES = ["unpaid", "paid", "refunded"];
const PAYOUT_STATUSES = ["pending", "approved", "rejected", "paid"];

const adminOnly = [authMiddleware, adminMiddleware];

const bookingPopulateFields = "name email profileImage title role";

const isProtectedAdmin = (user) => user?.role === "admin" || isAdminEmail(user?.email);

// GET ALL USERS
router.get("/users", adminOnly, async (req, res) => {
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// TOGGLE USER BLOCK STATUS
router.put("/user/:id/block", adminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (isProtectedAdmin(user)) {
      return res.status(400).json({ message: "Admin accounts cannot be blocked" });
    }

    user.isBlocked = !user.isBlocked;
    await user.save();

    res.json({
      message: `${user.name} ${user.isBlocked ? "blocked" : "unblocked"} successfully`,
      user,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// TOGGLE EMAIL VERIFICATION STATUS
router.put("/user/:id/verify", adminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.isEmailVerified = !user.isEmailVerified;
    if (user.isEmailVerified) user.emailVerifyToken = null;
    await user.save();

    res.json({
      message: `${user.name} ${user.isEmailVerified ? "verified" : "marked unverified"} successfully`,
      user,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// TOGGLE EXPERT PROFILE APPROVAL STATUS
router.put("/expert/:id/approve", adminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.role !== "expert") {
      return res.status(400).json({ message: "User is not an expert" });
    }

    user.isApproved = !user.isApproved;
    await user.save();

    res.json({
      message: `Expert ${user.isApproved ? "approved" : "approval suspended"} successfully`,
      user,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// DELETE USER
router.delete("/user/:id", adminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (isProtectedAdmin(user)) {
      return res.status(400).json({ message: "Admin accounts cannot be deleted" });
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET ALL PAID BOOKINGS / PAYMENT RECORDS
router.get("/payments", adminOnly, async (req, res) => {
  try {
    const payments = await Booking.find({ paymentStatus: "paid" })
      .populate("client expert", "name email")
      .sort({ createdAt: -1 });
    res.json(payments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET ADMIN PLATFORM SETTINGS
router.get("/settings", adminOnly, async (req, res) => {
  try {
    const settings = await getPlatformSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// UPDATE ADMIN PLATFORM SETTINGS
router.put("/settings", adminOnly, async (req, res) => {
  try {
    const commissionPercent = Number(req.body.commissionPercent);
    if (Number.isNaN(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
      return res.status(400).json({ message: "Commission percentage must be between 0 and 100" });
    }

    const settings = await getPlatformSettings();
    settings.commissionPercent = commissionPercent;
    await settings.save();

    res.json({ message: "Admin settings updated", settings });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET ALL PAYOUT REQUESTS
router.get("/payouts", adminOnly, async (req, res) => {
  try {
    const payouts = await Payout.find()
      .populate("expert", "name email profileImage upiId accountHolderName payoutMethod bankDetails")
      .populate("processedBy", "name email")
      .sort({ createdAt: -1 });
    res.json(payouts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// UPDATE PAYOUT REQUEST STATUS
router.put("/payouts/:id/status", adminOnly, async (req, res) => {
  try {
    const { status, transactionId, adminNote } = req.body;

    if (!PAYOUT_STATUSES.includes(status)) {
      return res.status(400).json({ message: "Invalid payout status" });
    }

    const payout = await Payout.findById(req.params.id);
    if (!payout) return res.status(404).json({ message: "Payout not found" });

    payout.status = status;
    payout.adminNote = adminNote || payout.adminNote || "";
    payout.processedBy = req.user.id;
    payout.processedAt = new Date();

    if (status === "paid") {
      payout.transactionId = transactionId || payout.transactionId || "";
      payout.paidAt = new Date();
    } else if (status !== "paid") {
      payout.paidAt = null;
    }

    await payout.save();

    const bookingStatus = status === "paid"
      ? "paid"
      : status === "rejected"
        ? "pending"
        : status === "approved"
          ? "approved"
          : "requested";

    await Booking.updateMany(
      { _id: { $in: payout.bookings || [] }, expert: payout.expert },
      { $set: { payoutStatus: bookingStatus } }
    );

    const updatedPayout = await Payout.findById(payout._id)
      .populate("expert", "name email profileImage upiId accountHolderName payoutMethod bankDetails")
      .populate("processedBy", "name email");

    res.json({ message: `Payout marked ${status}`, payout: updatedPayout });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET ALL BOOKINGS
router.get("/bookings", adminOnly, async (req, res) => {
  try {
    const bookings = await Booking.find()
      .populate("client expert", bookingPopulateFields)
      .sort({ date: -1, createdAt: -1 });
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// UPDATE BOOKING STATUS AND PAYMENT STATUS
router.put("/booking/:id/status", adminOnly, async (req, res) => {
  try {
    const { status, paymentStatus } = req.body;
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    if (status) {
      if (!BOOKING_STATUSES.includes(status)) {
        return res.status(400).json({ message: "Invalid booking status" });
      }
      booking.status = status;
    }

    if (paymentStatus) {
      if (!PAYMENT_STATUSES.includes(paymentStatus)) {
        return res.status(400).json({ message: "Invalid payment status" });
      }
      booking.paymentStatus = paymentStatus;
      if (paymentStatus === "paid") {
        await applyBookingEarnings(booking);
        await creditExpertWalletForBooking(booking);
      }
    }

    await booking.save();
    const updatedBooking = await Booking.findById(booking._id)
      .populate("client expert", bookingPopulateFields);

    res.json({ message: "Booking updated successfully", booking: updatedBooking });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET REPORTS AND COMPLAINTS
router.get("/reports", adminOnly, async (req, res) => {
  try {
    const reports = await Message.find().sort({ createdAt: -1 });
    res.json(reports);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// MARK REPORT READ/UNREAD
router.put("/report/:id/read", adminOnly, async (req, res) => {
  try {
    const report = await Message.findById(req.params.id);
    if (!report) return res.status(404).json({ message: "Report not found" });

    report.isRead = !report.isRead;
    await report.save();
    res.json(report);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// DELETE REPORT
router.delete("/report/:id", adminOnly, async (req, res) => {
  try {
    await Message.findByIdAndDelete(req.params.id);
    res.json({ message: "Report deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET DETAILED ANALYTICS
router.get("/analytics", adminOnly, async (req, res) => {
  try {
    const settings = await getPlatformSettings();
    const [
      totalUsers,
      totalExperts,
      totalClients,
      totalBookings,
      totalPaidBookings,
      approvedExperts,
      blockedUsers,
      verifiedUsers,
      unreadReports,
      paidBookingsForRevenue,
      paidOutRows,
      bookingStatusRows,
      paymentStatusRows,
      latestBookings,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: "expert" }),
      User.countDocuments({ role: "client" }),
      Booking.countDocuments(),
      Booking.countDocuments({ paymentStatus: "paid" }),
      User.countDocuments({ role: "expert", isApproved: true }),
      User.countDocuments({ isBlocked: true }),
      User.countDocuments({ isEmailVerified: true }),
      Message.countDocuments({ isRead: false }),
      Booking.find({ paymentStatus: "paid" }).select("totalPrice grossAmount platformCommission expertEarning commissionPercent payoutStatus"),
      Payout.aggregate([
        { $match: { status: "paid" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      Booking.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Booking.aggregate([
        { $group: { _id: "$paymentStatus", count: { $sum: 1 } } },
      ]),
      Booking.find()
        .populate("client expert", bookingPopulateFields)
        .sort({ createdAt: -1 })
        .limit(6),
    ]);

    const toCountMap = (rows) => rows.reduce((acc, row) => {
      acc[row._id || "unknown"] = row.count;
      return acc;
    }, {});

    const revenueMetrics = paidBookingsForRevenue.reduce((acc, booking) => {
      const earnings = getBookingEarnings(booking, settings.commissionPercent);
      acc.totalRevenue += earnings.grossAmount;
      acc.platformCommissionEarned += earnings.platformCommission;
      acc.totalExpertEarnings += earnings.expertEarning;
      if (booking.payoutStatus !== "paid") {
        acc.expertEarningsPending += earnings.expertEarning;
      }
      return acc;
    }, {
      expertEarningsPending: 0,
      platformCommissionEarned: 0,
      totalExpertEarnings: 0,
      totalRevenue: 0,
    });

    const paidOut = roundMoney(paidOutRows[0]?.total || 0);

    res.json({
      metrics: {
        totalUsers,
        totalExperts,
        totalClients,
        totalBookings,
        totalPaidBookings,
        totalRevenue: roundMoney(revenueMetrics.totalRevenue),
        platformCommissionEarned: roundMoney(revenueMetrics.platformCommissionEarned),
        totalExpertEarnings: roundMoney(revenueMetrics.totalExpertEarnings),
        expertEarningsPending: roundMoney(revenueMetrics.expertEarningsPending),
        paidOut,
        commissionPercent: settings.commissionPercent,
        approvedExperts,
        pendingApprovals: totalExperts - approvedExperts,
        blockedUsers,
        verifiedUsers,
        unreadReports,
        bookingStatusCounts: toCountMap(bookingStatusRows),
        paymentStatusCounts: toCountMap(paymentStatusRows),
      },
      latestBookings,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
