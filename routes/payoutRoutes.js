const express = require("express");
const router = express.Router();
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
    Payout.find({ expert: expert._id }).sort({ createdAt: -1 }).limit(10),
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
    const requestedAmount = roundMoney(req.body.amount || wallet.availableBalance);

    if (requestedAmount <= 0) {
      return res.status(400).json({ message: "No available balance to request" });
    }
    if (requestedAmount > wallet.availableBalance) {
      return res.status(400).json({ message: "Requested amount exceeds available balance" });
    }

    const requestedCommission = roundMoney(
      (requestedAmount * wallet.platformCommissionPercent) / Math.max(100 - wallet.platformCommissionPercent, 1)
    );

    const payout = await Payout.create({
      expert: expert._id,
      amount: requestedAmount,
      commission: requestedCommission,
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
    const pending = await Payout.find({ status: "pending" })
      .populate("expert", "name email upiId accountHolderName payoutMethod bankDetails")
      .sort({ createdAt: -1 });
    res.json(pending);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put("/:id/approve", adminOnly, async (req, res) => {
  try {
    const payout = await Payout.findById(req.params.id);
    if (!payout) return res.status(404).json({ message: "Payout not found" });
    if (payout.status !== "pending" && payout.status !== "approved") {
      return res.status(400).json({ message: "Payout is not awaiting payment" });
    }

    payout.status = "paid";
    payout.transactionId = req.body.transactionId || req.body.transactionReference || "";
    payout.processedBy = req.user.id;
    payout.processedAt = new Date();
    payout.paidAt = new Date();
    await payout.save();

    res.json({ message: "Payout marked as paid", payout });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
