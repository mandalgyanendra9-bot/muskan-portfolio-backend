const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Booking = require("../models/Booking");
const ViolationLog = require("../models/ViolationLog");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const { serializeUser } = require("../utils/userResponse");
const { hasAdminAccess } = require("../utils/adminAccess");
const { getPlatformSettings } = require("../utils/earnings");
const mongoose = require("mongoose");

const adminOnly = [authMiddleware, adminMiddleware];

const normalizeAction = (value) => String(value || "").trim().toLowerCase();

router.get("/settings", async (req, res) => {
  try {
    const settings = await getPlatformSettings();
    res.json({
      watermarkProtectionEnabled: settings.watermarkProtectionEnabled !== false,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/violations", authMiddleware, async (req, res) => {
  try {
    const action = String(req.body.action || "").trim();
    if (!action) {
      return res.status(400).json({ message: "Action is required" });
    }

    const bookingId = req.body.bookingId || null;
    const targetUserId = req.body.targetUserId || null;

    if (bookingId && !mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json({ message: "Invalid bookingId" });
    }
    if (targetUserId && !mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ message: "Invalid target user" });
    }

    const log = await ViolationLog.create({
      userId: req.user.id,
      bookingId: bookingId || null,
      targetUserId: targetUserId || null,
      action,
      details: String(req.body.details || "").slice(0, 1000),
      page: String(req.body.page || "").slice(0, 120),
      source: String(req.body.source || "web").slice(0, 40),
      timestamp: req.body.timestamp ? new Date(req.body.timestamp) : new Date(),
    });

    const populated = await ViolationLog.findById(log._id)
      .populate("userId", "name email role profilePhotoUrl profileImage profilePhoto avatar photoUrl googlePhoto")
      .populate("bookingId", "meetingLink videoCallUrl startAt endAt timezone slotStart slotEnd status paymentStatus")
      .populate("targetUserId", "name email role profilePhotoUrl profileImage profilePhoto avatar photoUrl googlePhoto isBlocked blockedUsers blockedBy");

    res.status(201).json({ message: "Violation logged", violation: populated });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/violations", adminOnly, async (req, res) => {
  try {
    const logs = await ViolationLog.find()
      .populate("userId", "name email role profilePhotoUrl profileImage profilePhoto avatar photoUrl googlePhoto")
      .populate("bookingId", "meetingLink videoCallUrl startAt endAt timezone slotStart slotEnd status paymentStatus")
      .populate("targetUserId", "name email role profilePhotoUrl profileImage profilePhoto avatar photoUrl googlePhoto isBlocked blockedUsers blockedBy")
      .sort({ timestamp: -1 });

    res.json(logs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/block-user", authMiddleware, async (req, res) => {
  try {
    const targetUserId = String(req.body.targetUserId || "").trim();
    if (!targetUserId) {
      return res.status(400).json({ message: "Target user is required" });
    }
    if (targetUserId === req.user.id) {
      return res.status(400).json({ message: "You cannot block yourself" });
    }

    const currentUser = await User.findById(req.user.id);
    const targetUser = await User.findById(targetUserId);
    if (!currentUser || !targetUser) {
      return res.status(404).json({ message: "User not found" });
    }

    await Promise.all([
      User.updateOne({ _id: currentUser._id }, { $addToSet: { blockedUsers: targetUser._id } }),
      User.updateOne({ _id: targetUser._id }, { $addToSet: { blockedBy: currentUser._id } }),
    ]);

    await ViolationLog.create({
      userId: currentUser._id,
      targetUserId: targetUser._id,
      bookingId: req.body.bookingId || null,
      action: "block_user",
      details: String(req.body.reason || "Blocked from sensitive session").slice(0, 1000),
      page: String(req.body.page || "").slice(0, 120),
      source: String(req.body.source || "web").slice(0, 40),
      timestamp: new Date(),
    });

    res.json({
      message: `${targetUser.name} blocked successfully`,
      user: serializeUser(currentUser, req),
      targetUser: serializeUser(targetUser, req),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.delete("/block-user/:targetUserId", authMiddleware, async (req, res) => {
  try {
    const { targetUserId } = req.params;
    const currentUser = await User.findById(req.user.id);
    const targetUser = await User.findById(targetUserId);
    if (!currentUser || !targetUser) {
      return res.status(404).json({ message: "User not found" });
    }

    await Promise.all([
      User.updateOne({ _id: currentUser._id }, { $pull: { blockedUsers: targetUser._id } }),
      User.updateOne({ _id: targetUser._id }, { $pull: { blockedBy: currentUser._id } }),
    ]);

    res.json({
      message: `${targetUser.name} unblocked successfully`,
      user: serializeUser(currentUser, req),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put("/violations/:id/status", adminOnly, async (req, res) => {
  try {
    const status = normalizeAction(req.body.status);
    if (!["reviewed", "blocked", "dismissed", "open"].includes(status)) {
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

module.exports = router;
