const express = require("express");
const router = express.Router();
const Booking = require("../models/Booking");
const Payout = require("../models/Payout");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const {
  getPayoutDetailsSnapshot,
  getPayoutSettings,
  getPayoutWallet,
  isPayoutSettingsComplete,
  roundMoney,
} = require("../utils/payouts");

const adminOnly = [authMiddleware, adminMiddleware];
const VALID_PAYOUT_METHODS = ["upi", "bank"];
const ACTIVE_PAYOUT_STATUSES = ["pending", "approved"];

const requireExpert = async (req, res) => {
  const expert = await User.findById(req.user.id);
  if (!expert) {
    res.status(404).json({ message: "User not found" });
    return null;
  }
  if (expert.role !== "expert") {
    res.status(403).json({ message: "Only experts can manage payout settings" });
    return null;
  }
  return expert;
};

const normalizePayoutSettings = (body = {}) => {
  const payoutMethod = String(body.payoutMethod || "upi").toLowerCase();

  return {
    payoutMethod,
    upiId: String(body.upiId || "").trim(),
    accountHolderName: String(body.accountHolderName || "").trim(),
    bankAccountNumber: String(body.bankAccountNumber || body.accountNumber || "").trim(),
    ifscCode: String(body.ifscCode || body.ifsc || "").trim().toUpperCase(),
  };
};

const validatePayoutSettings = (settings) => {
  if (!VALID_PAYOUT_METHODS.includes(settings.payoutMethod)) {
    return "Payout method must be UPI or Bank";
  }
  if (!settings.accountHolderName) {
    return "Account holder name is required";
  }
  if (settings.payoutMethod === "upi" && !settings.upiId) {
    return "UPI ID is required";
  }
  if (settings.payoutMethod === "bank") {
    if (!settings.bankAccountNumber) return "Bank account number is required";
    if (!settings.ifscCode) return "IFSC code is required";
  }
  return null;
};

const getPayoutPayload = async (expert) => {
  const [wallet, requests] = await Promise.all([
    getPayoutWallet(expert._id),
    Payout.find({ expert: expert._id }).sort({ createdAt: -1 }),
  ]);

  const settings = getPayoutSettings(expert);
  return {
    settings,
    wallet,
    requests,
    settingsComplete: isPayoutSettingsComplete(settings),
  };
};

router.get("/me", authMiddleware, async (req, res) => {
  try {
    const expert = await requireExpert(req, res);
    if (!expert) return;

    res.json(await getPayoutPayload(expert));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put("/settings", authMiddleware, async (req, res) => {
  try {
    const expert = await requireExpert(req, res);
    if (!expert) return;

    const settings = normalizePayoutSettings(req.body);
    const validationMessage = validatePayoutSettings(settings);
    if (validationMessage) {
      return res.status(400).json({ message: validationMessage });
    }

    expert.upiId = settings.upiId;
    expert.accountHolderName = settings.accountHolderName;
    expert.payoutMethod = settings.payoutMethod;
    expert.bankDetails = {
      ...(expert.bankDetails?.toObject?.() || expert.bankDetails || {}),
      accountNumber: settings.bankAccountNumber,
      ifsc: settings.ifscCode,
    };

    await expert.save();

    res.json({
      message: "Payout details saved successfully",
      ...(await getPayoutPayload(expert)),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/request", authMiddleware, async (req, res) => {
  try {
    const expert = await requireExpert(req, res);
    if (!expert) return;

    const settings = getPayoutSettings(expert);
    if (!isPayoutSettingsComplete(settings)) {
      return res.status(400).json({ message: "Save complete payout details before requesting a payout" });
    }

    const wallet = await getPayoutWallet(expert._id);
    const requestedAmount = roundMoney(wallet.availableBalance);

    if (requestedAmount <= 0) {
      return res.status(400).json({ message: "No available balance to request" });
    }

    const payout = await Payout.create({
      expert: expert._id,
      bookings: wallet.availableBookingIds,
      amount: requestedAmount,
      commission: wallet.availablePlatformCommission,
      netAmount: requestedAmount,
      grossEarningsAtRequest: wallet.grossEarnings,
      totalEarningsAtRequest: wallet.totalEarnings,
      availableBalanceAtRequest: wallet.availableBalance,
      paidOutAtRequest: wallet.paidOut,
      platformCommissionPercent: wallet.platformCommissionPercent,
      payoutMethod: settings.payoutMethod,
      payoutDetails: getPayoutDetailsSnapshot(settings),
      status: "pending",
    });

    await Booking.updateMany(
      { _id: { $in: wallet.availableBookingIds }, expert: expert._id, payoutStatus: { $in: ["not_requested", "pending"] } },
      { $set: { payoutStatus: "requested" } }
    );

    res.status(201).json({
      message: "Payout request submitted for admin review",
      payout,
      ...(await getPayoutPayload(expert)),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/pending", adminOnly, async (req, res) => {
  try {
    const pending = await Payout.find({ status: { $in: ACTIVE_PAYOUT_STATUSES } })
      .populate("expert", "name email profileImage upiId accountHolderName payoutMethod bankDetails")
      .sort({ createdAt: -1 });
    res.json(pending);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put("/:id/approve", adminOnly, async (req, res) => {
  try {
    const transactionId = String(req.body.transactionId || req.body.transactionReference || "").trim();
    const payout = await Payout.findById(req.params.id);
    if (!payout) return res.status(404).json({ message: "Payout not found" });
    if (!ACTIVE_PAYOUT_STATUSES.includes(payout.status)) {
      return res.status(400).json({ message: "Payout is not awaiting payment" });
    }
    if (!transactionId) {
      return res.status(400).json({ message: "Transaction ID / UTR number is required to mark payout as paid" });
    }

    payout.status = "paid";
    payout.approvedBy = payout.approvedBy || req.user.id;
    payout.approvedAt = payout.approvedAt || new Date();
    payout.transactionId = transactionId;
    payout.processedBy = req.user.id;
    payout.processedAt = new Date();
    payout.paidAt = new Date();
    await payout.save();
    await Booking.updateMany(
      { _id: { $in: payout.bookings || [] }, expert: payout.expert },
      { $set: { payoutStatus: "paid" } }
    );

    res.json({ message: "Payout marked as paid", payout });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
