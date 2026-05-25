const PlatformSettings = require("../models/PlatformSettings");
const User = require("../models/User");

const DEFAULT_COMMISSION_PERCENT = 20;

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const getPlatformSettings = async () => {
  const fallbackPercent = Number(process.env.PLATFORM_COMMISSION_PERCENT || DEFAULT_COMMISSION_PERCENT);

  return PlatformSettings.findOneAndUpdate(
    { key: "platform" },
    { $setOnInsert: { commissionPercent: fallbackPercent } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

const getCommissionPercent = async () => {
  const settings = await getPlatformSettings();
  return Number(settings.commissionPercent ?? DEFAULT_COMMISSION_PERCENT);
};

const calculateBookingEarnings = (amount, commissionPercent = DEFAULT_COMMISSION_PERCENT) => {
  const grossAmount = roundMoney(amount);
  const platformCommission = roundMoney((grossAmount * commissionPercent) / 100);
  const expertEarning = roundMoney(grossAmount - platformCommission);

  return {
    grossAmount,
    platformCommission,
    expertEarning,
    commissionPercent,
  };
};

const getBookingEarnings = (booking, fallbackCommissionPercent = DEFAULT_COMMISSION_PERCENT) => {
  const storedCommissionPercent = booking.commissionPercent ?? fallbackCommissionPercent;
  const calculated = calculateBookingEarnings(booking.totalPrice, storedCommissionPercent);
  const hasStoredEarnings = (
    Number(booking.grossAmount) > 0 ||
    Number(booking.platformCommission) > 0 ||
    Number(booking.expertEarning) > 0
  );

  if (!hasStoredEarnings) return calculated;

  return {
    grossAmount: roundMoney(booking.grossAmount),
    platformCommission: roundMoney(booking.platformCommission),
    expertEarning: roundMoney(booking.expertEarning),
    commissionPercent: Number(storedCommissionPercent),
  };
};

const applyBookingEarnings = async (booking, amount = booking.totalPrice) => {
  const commissionPercent = await getCommissionPercent();
  const earnings = calculateBookingEarnings(amount, commissionPercent);

  booking.grossAmount = earnings.grossAmount;
  booking.platformCommission = earnings.platformCommission;
  booking.expertEarning = earnings.expertEarning;
  booking.commissionPercent = earnings.commissionPercent;
  booking.payoutStatus = "pending";

  return earnings;
};

const creditExpertWalletForBooking = async (booking) => {
  if (booking.expertWalletCredited) {
    return getBookingEarnings(booking);
  }

  const earnings = getBookingEarnings(booking);
  await User.findByIdAndUpdate(booking.expert, {
    $inc: {
      walletBalance: earnings.expertEarning,
      completedPaidBookings: 1,
    },
  });

  booking.expertWalletCredited = true;
  booking.expertWalletCreditedAt = new Date();

  return earnings;
};

module.exports = {
  DEFAULT_COMMISSION_PERCENT,
  applyBookingEarnings,
  calculateBookingEarnings,
  creditExpertWalletForBooking,
  getBookingEarnings,
  getCommissionPercent,
  getPlatformSettings,
  roundMoney,
};
