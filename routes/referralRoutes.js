const express = require("express");
const router = express.Router();
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const {
  REFERRER_REWARD_COINS,
  NEW_USER_REWARD_COINS,
  applyReferralReward,
  ensureReferralCode,
  normalizeReferralCode,
} = require("../utils/referrals");

const safeReferralUserSelect = "name email profileImage createdAt";

router.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate("referredBy", safeReferralUserSelect);
    if (!user) return res.status(404).json({ message: "User not found" });

    const referralCode = await ensureReferralCode(user);
    const referredUsers = await User.find({ referredBy: user._id })
      .select(safeReferralUserSelect)
      .sort({ createdAt: -1 })
      .limit(20);

    res.json({
      referralCode,
      referralPath: `/register?ref=${referralCode}`,
      rewards: {
        referrerCoins: REFERRER_REWARD_COINS,
        newUserCoins: NEW_USER_REWARD_COINS,
      },
      referredBy: user.referredBy,
      referredUsers,
      stats: {
        referralCount: user.referralCount || referredUsers.length,
        referralRewardCoins: user.referralRewardCoins || 0,
        coinBalance: user.coinBalance || 0,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/apply", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.referredBy) {
      return res.status(400).json({ message: "A referral has already been applied to this account" });
    }

    const code = normalizeReferralCode(req.body.referralCode);
    if (!code) return res.status(400).json({ message: "Referral code is required" });

    const result = await applyReferralReward(user, code);
    if (!result.applied) {
      return res.status(400).json({ message: "Invalid referral code" });
    }

    res.json({
      message: `Referral applied. ${NEW_USER_REWARD_COINS} coins added to your account.`,
      rewards: result.rewards,
      user: await User.findById(user._id).select("-password -emailVerifyToken -resetPasswordToken -resetPasswordExpires"),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
