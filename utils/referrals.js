const crypto = require("crypto");
const User = require("../models/User");

const REFERRER_REWARD_COINS = 150;
const NEW_USER_REWARD_COINS = 100;

const normalizeReferralCode = (value = "") =>
  String(value)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 16);

const buildReferralBase = (user = {}) => {
  const source = user.name || user.email || "USER";
  const base = normalizeReferralCode(source).slice(0, 6);
  return base || "USER";
};

const generateReferralCode = async (user = {}) => {
  const base = buildReferralBase(user);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
    const code = normalizeReferralCode(`${base}${suffix}`);
    const existing = await User.exists({ referralCode: code });
    if (!existing) return code;
  }

  return normalizeReferralCode(`${base}${Date.now().toString(36)}`);
};

const ensureReferralCode = async (user) => {
  if (!user) return null;
  if (user.referralCode) return user.referralCode;

  user.referralCode = await generateReferralCode(user);
  await user.save();
  return user.referralCode;
};

const applyReferralReward = async (newUser, referralCode) => {
  const code = normalizeReferralCode(referralCode);
  if (!newUser || !code || newUser.referredBy) return { applied: false };

  const referrer = await User.findOne({ referralCode: code });
  if (!referrer || referrer._id.toString() === newUser._id.toString()) {
    return { applied: false };
  }

  newUser.referredBy = referrer._id;
  newUser.coinBalance = (Number(newUser.coinBalance) || 0) + NEW_USER_REWARD_COINS;
  await newUser.save();

  referrer.coinBalance = (Number(referrer.coinBalance) || 0) + REFERRER_REWARD_COINS;
  referrer.referralCount = (Number(referrer.referralCount) || 0) + 1;
  referrer.referralRewardCoins = (Number(referrer.referralRewardCoins) || 0) + REFERRER_REWARD_COINS;
  await referrer.save();

  return {
    applied: true,
    referrer,
    rewards: {
      referrerCoins: REFERRER_REWARD_COINS,
      newUserCoins: NEW_USER_REWARD_COINS,
    },
  };
};

module.exports = {
  REFERRER_REWARD_COINS,
  NEW_USER_REWARD_COINS,
  normalizeReferralCode,
  generateReferralCode,
  ensureReferralCode,
  applyReferralReward,
};
