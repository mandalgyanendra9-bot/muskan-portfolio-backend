const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Booking = require("../models/Booking");
const Message = require("../models/Message");
const Project = require("../models/Project");
const Payout = require("../models/Payout");
const PayoutAuditLog = require("../models/PayoutAuditLog");
const ViolationLog = require("../models/ViolationLog");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const uploadPayoutProof = require("../middleware/PayoutProofUpload");
const { isAdminEmail } = require("../utils/adminAccess");
const { serializeUser } = require("../utils/userResponse");
const { formatBookingForResponse, formatBookingsForResponse } = require("../utils/bookingTime");
const {
  applyBookingEarnings,
  creditExpertWalletForBooking,
  getBookingEarnings,
  getPlatformSettings,
  roundMoney,
} = require("../utils/earnings");

const BOOKING_STATUSES = ["pending", "confirmed", "completed", "cancelled"];
const PAYMENT_STATUSES = ["unpaid", "paid", "refunded", "failed", "cancelled"];
const PAYOUT_STATUSES = ["requested", "pending", "approved", "processing", "rejected", "paid"];
const ACTIVE_PAYOUT_STATUSES = ["requested", "pending", "approved", "processing"];
const VALID_TRANSFER_METHODS = ["upi", "bank", "other"];
const TRANSACTION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

const adminOnly = [authMiddleware, adminMiddleware];

const bookingPopulateFields = "name email profileImage title role";

const isProtectedAdmin = (user) => user?.role === "admin" || isAdminEmail(user?.email);

const csvEscape = (value = "") => `"${String(value ?? "").replace(/"/g, '""')}"`;

// GET ALL USERS
router.get("/users", adminOnly, async (req, res) => {
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 });
    res.json(users.map((user) => serializeUser(user, req)));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET SINGLE USER PROFILE FOR ADMIN VIEW
router.get("/users/:id", adminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    const projectsCount = await Project.countDocuments({ user: user._id });
    const payload = serializeUser(user, req, {
      projectsCount,
    });

    res.json(payload);
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
      user: serializeUser(user, req),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ASSIGN USER ROLE
router.put("/user/:id/role", adminOnly, async (req, res) => {
  try {
    const requestedRole = String(req.body.role || "").trim().toLowerCase();
    if (!["client", "expert", "admin"].includes(requestedRole)) {
      return res.status(400).json({ message: "Invalid role selected" });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (isProtectedAdmin(user)) {
      return res.status(400).json({ message: "Super admin role cannot be changed" });
    }

    user.role = requestedRole;
    if (requestedRole !== "expert") {
      user.isApproved = false;
    }
    await user.save();

    res.json({
      message: `${user.name} role updated to ${requestedRole}`,
      user: serializeUser(user, req),
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
      user: serializeUser(user, req),
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
      user: serializeUser(user, req),
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
    res.json(formatBookingsForResponse(payments));
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
    const hasCommissionPercent = req.body.commissionPercent !== undefined && req.body.commissionPercent !== null && req.body.commissionPercent !== "";
    const hasWatermarkFlag = req.body.watermarkProtectionEnabled !== undefined && req.body.watermarkProtectionEnabled !== null;
    if (!hasCommissionPercent && !hasWatermarkFlag) {
      return res.status(400).json({ message: "At least one setting must be provided" });
    }

    const settings = await getPlatformSettings();
    if (hasCommissionPercent) {
      const commissionPercent = Number(req.body.commissionPercent);
      if (Number.isNaN(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
        return res.status(400).json({ message: "Commission percentage must be between 0 and 100" });
      }
      settings.commissionPercent = commissionPercent;
    }

    if (hasWatermarkFlag) {
      const value = req.body.watermarkProtectionEnabled;
      settings.watermarkProtectionEnabled = value === true || value === "true" || value === 1 || value === "1";
    }

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
      .populate("approvedBy", "name email")
      .populate("processedBy", "name email")
      .populate("paidBy", "name email")
      .sort({ createdAt: -1 });
    res.json(payouts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// DOWNLOAD PAYOUT REPORT AS CSV
router.get("/payouts/report", adminOnly, async (req, res) => {
  try {
    const payouts = await Payout.find()
      .populate("expert", "name email upiId accountHolderName payoutMethod bankDetails")
      .populate("approvedBy", "name email")
      .populate("processedBy", "name email")
      .populate("paidBy", "name email")
      .sort({ createdAt: -1 });

    const rows = [
      [
        "Requested At",
        "Expert",
        "Email",
        "Amount",
        "Commission",
        "Status",
        "Method",
        "Account Holder",
        "UPI",
        "Bank Account",
        "IFSC",
        "Transfer Method",
        "Transaction ID",
        "Transfer Proof",
        "Approved By",
        "Approved At",
        "Processed By",
        "Paid By",
        "Admin Note",
        "Paid At",
      ],
      ...payouts.map((payout) => {
        const details = payout.payoutDetails || {};
        const method = details.payoutMethod || payout.payoutMethod || payout.expert?.payoutMethod || "upi";
        return [
          payout.createdAt?.toISOString?.() || "",
          payout.expert?.name || "",
          payout.expert?.email || "",
          payout.amount || payout.netAmount || 0,
          payout.commission || 0,
          payout.status || "",
          method,
          details.accountHolderName || payout.expert?.accountHolderName || "",
          details.upiId || payout.expert?.upiId || "",
          details.bankAccountNumber || payout.expert?.bankDetails?.accountNumber || "",
          details.ifscCode || payout.expert?.bankDetails?.ifsc || "",
          payout.transferMethod || "",
          payout.transactionId || "",
          payout.transferProofUrl || "",
          payout.approvedBy?.name || "",
          payout.approvedAt?.toISOString?.() || "",
          payout.processedBy?.name || "",
          payout.paidBy?.name || "",
          payout.adminNote || "",
          payout.paidAt?.toISOString?.() || "",
        ];
      }),
    ];

    const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="payout-report-${Date.now()}.csv"`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// UPDATE PAYOUT REQUEST STATUS
router.put("/payouts/:id/status", adminOnly, uploadPayoutProof.single("transferProof"), async (req, res) => {
  try {
    const { status, transactionId, adminNote, transferMethod, transferProofUrl, proofUrl } = req.body;
    const cleanTransactionId = String(transactionId || "").trim();
    const cleanAdminNote = String(adminNote || "").trim();
    const normalizedTransferMethod = String(transferMethod || "").trim().toLowerCase();
    const uploadedProofUrl = req.file ? `/uploads/payout-proofs/${req.file.filename}` : "";
    const cleanTransferProofUrl = uploadedProofUrl || String(transferProofUrl || proofUrl || "").trim();
    const isSuperAdmin = isAdminEmail(req.adminUser?.email);

    if (!PAYOUT_STATUSES.includes(status)) {
      return res.status(400).json({ message: "Invalid payout status" });
    }

    const payout = await Payout.findById(req.params.id);
    if (!payout) return res.status(404).json({ message: "Payout not found" });
    const previousStatus = payout.status;

    if (previousStatus === "paid" && !isSuperAdmin) {
      return res.status(403).json({ message: "Paid payout transfer fields are locked. Only the super admin can edit or reopen." });
    }
    if (status === "approved" && !["requested", "pending"].includes(previousStatus)) {
      return res.status(400).json({ message: "Only requested payouts can be approved first" });
    }
    if (status === "processing" && previousStatus !== "approved") {
      return res.status(400).json({ message: "Only approved payouts can move to processing" });
    }
    if (status === "paid") {
      if (!["approved", "processing"].includes(previousStatus) && !(isSuperAdmin && previousStatus === "paid")) {
        return res.status(400).json({ message: "Approve payout before marking it paid" });
      }
      if (!VALID_TRANSFER_METHODS.includes(normalizedTransferMethod)) {
        return res.status(400).json({ message: "Transfer method must be UPI, Bank, or Other" });
      }
      if (!TRANSACTION_ID_PATTERN.test(cleanTransactionId)) {
        return res.status(400).json({
          message: "Transaction ID must be 8-64 characters and use only letters, numbers, dash, or underscore",
        });
      }
      if (!cleanTransferProofUrl && !payout.transferProofUrl) {
        return res.status(400).json({ message: "Transfer proof image/PDF upload or proof URL is required before marking paid" });
      }
      if (!cleanAdminNote) {
        return res.status(400).json({ message: "Admin note is required when marking payout paid" });
      }
      const duplicate = await Payout.findOne({
        _id: { $ne: payout._id },
        transactionId: cleanTransactionId,
      }).select("_id");
      if (duplicate) {
        return res.status(409).json({ message: "This transaction ID is already used on another payout" });
      }
    }
    if (status === "rejected" && previousStatus === "paid" && !isSuperAdmin) {
      return res.status(403).json({ message: "Only the super admin can reopen a paid payout" });
    }

    payout.status = status;
    payout.adminNote = cleanAdminNote || payout.adminNote || "";
    payout.processedBy = req.user.id;
    payout.processedAt = new Date();

    if (status === "approved") {
      payout.approvedBy = req.user.id;
      payout.approvedAt = new Date();
      payout.transactionId = "";
      payout.transferMethod = "";
      payout.transferProofUrl = "";
      payout.proofFileName = "";
      payout.proofMimeType = "";
      payout.paidBy = null;
      payout.paidAt = null;
      payout.paidFieldsLocked = false;
      await PayoutAuditLog.create({
        admin: req.user.id,
        payout: payout._id,
        amount: payout.amount || payout.netAmount || 0,
        transactionId: "",
        action: "payout_approved",
        timestamp: new Date(),
      });
    } else if (status === "processing") {
      payout.approvedBy = payout.approvedBy || req.user.id;
      payout.approvedAt = payout.approvedAt || new Date();
    } else if (status === "paid") {
      payout.approvedBy = payout.approvedBy || req.user.id;
      payout.approvedAt = payout.approvedAt || new Date();
      payout.transactionId = cleanTransactionId;
      payout.transferMethod = normalizedTransferMethod;
      payout.transferProofUrl = cleanTransferProofUrl || payout.transferProofUrl;
      payout.proofFileName = req.file?.originalname || payout.proofFileName || "";
      payout.proofMimeType = req.file?.mimetype || payout.proofMimeType || "";
      payout.paidBy = req.user.id;
      payout.paidAt = new Date();
      payout.paidFieldsLocked = true;
      await PayoutAuditLog.create({
        admin: req.user.id,
        payout: payout._id,
        amount: payout.amount || payout.netAmount || 0,
        transactionId: cleanTransactionId,
        action: previousStatus === "paid" ? "payout_paid_edited" : "payout_marked_paid",
        timestamp: new Date(),
      });
    } else if (status === "rejected") {
      payout.approvedBy = null;
      payout.approvedAt = null;
      if (previousStatus === "paid" && isSuperAdmin) {
        await PayoutAuditLog.create({
          admin: req.user.id,
          payout: payout._id,
          amount: payout.amount || payout.netAmount || 0,
          transactionId: payout.transactionId || "",
          action: "payout_reopened",
          timestamp: new Date(),
        });
      }
      payout.transactionId = "";
      payout.transferMethod = "";
      payout.transferProofUrl = "";
      payout.proofFileName = "";
      payout.proofMimeType = "";
      payout.paidBy = null;
      payout.paidAt = null;
      payout.paidFieldsLocked = false;
    } else if (status === "requested" || status === "pending") {
      payout.approvedBy = null;
      payout.approvedAt = null;
      payout.transactionId = "";
      payout.transferMethod = "";
      payout.transferProofUrl = "";
      payout.proofFileName = "";
      payout.proofMimeType = "";
      payout.paidBy = null;
      payout.paidAt = null;
      payout.paidFieldsLocked = false;
    }

    await payout.save();

    const bookingStatus = status === "paid"
      ? "paid"
      : status === "rejected"
        ? "pending"
        : status === "processing"
          ? "processing"
        : status === "approved"
          ? "approved"
          : "requested";

    await Booking.updateMany(
      { _id: { $in: payout.bookings || [] }, expert: payout.expert },
      { $set: { payoutStatus: bookingStatus } }
    );

    const updatedPayout = await Payout.findById(payout._id)
      .populate("expert", "name email profileImage upiId accountHolderName payoutMethod bankDetails")
      .populate("approvedBy", "name email")
      .populate("processedBy", "name email")
      .populate("paidBy", "name email");

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
      .sort({ startAt: -1, slotStart: -1, createdAt: -1 });
    res.json(formatBookingsForResponse(bookings));
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
      booking.bookingStatus = status;
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

    res.json({ message: "Booking updated successfully", booking: formatBookingForResponse(updatedBooking) });
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

// GET VIOLATION LOGS
router.get("/violations", adminOnly, async (req, res) => {
  try {
    const violations = await ViolationLog.find()
      .populate("userId", "name email role profilePhotoUrl profileImage profilePhoto avatar photoUrl googlePhoto")
      .populate("bookingId", "meetingLink videoCallUrl startAt endAt timezone slotStart slotEnd status paymentStatus")
      .populate("targetUserId", "name email role profilePhotoUrl profileImage profilePhoto avatar photoUrl googlePhoto isBlocked blockedUsers blockedBy")
      .sort({ timestamp: -1 });

    res.json(violations);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// MARK VIOLATION STATUS
router.put("/violations/:id/status", adminOnly, async (req, res) => {
  try {
    const { status } = req.body;
    if (!["open", "reviewed", "blocked", "dismissed"].includes(status)) {
      return res.status(400).json({ message: "Invalid violation status" });
    }

    const violation = await ViolationLog.findById(req.params.id);
    if (!violation) return res.status(404).json({ message: "Violation not found" });

    violation.status = status;
    await violation.save();
    res.json({ message: "Violation updated", violation });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// BLOCK REPORTED USER
router.post("/violations/:id/block", adminOnly, async (req, res) => {
  try {
    const violation = await ViolationLog.findById(req.params.id).populate("targetUserId");
    if (!violation) return res.status(404).json({ message: "Violation not found" });
    if (!violation.targetUserId) {
      return res.status(400).json({ message: "Violation has no target user" });
    }

    const user = await User.findById(violation.targetUserId._id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (isProtectedAdmin(user)) {
      return res.status(400).json({ message: "Admin accounts cannot be blocked" });
    }

    user.isBlocked = true;
    await user.save();

    violation.status = "blocked";
    await violation.save();

    res.json({
      message: `${user.name} blocked successfully`,
      user: serializeUser(user, req),
      violation,
    });
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
      latestBookings: formatBookingsForResponse(latestBookings),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
