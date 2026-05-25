const mongoose = require("mongoose");
const Booking = require("../models/Booking");
const Payout = require("../models/Payout");

const PLATFORM_COMMISSION_PERCENT = Number(process.env.PLATFORM_COMMISSION_PERCENT || 20);
const ACTIVE_PAYOUT_STATUSES = ["pending", "approved"];

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const toObjectId = (id) => {
  if (id instanceof mongoose.Types.ObjectId) return id;
  return new mongoose.Types.ObjectId(id);
};

const getPayoutSettings = (user = {}) => ({
  payoutMethod: user.payoutMethod || "upi",
  upiId: user.upiId || "",
  accountHolderName: user.accountHolderName || "",
  bankAccountNumber: user.bankDetails?.accountNumber || "",
  ifscCode: user.bankDetails?.ifsc || "",
});

const getPayoutDetailsSnapshot = (settings) => ({
  payoutMethod: settings.payoutMethod || "upi",
  upiId: settings.upiId || "",
  accountHolderName: settings.accountHolderName || "",
  bankAccountNumber: settings.bankAccountNumber || "",
  ifscCode: settings.ifscCode || "",
});

const isPayoutSettingsComplete = (settings) => {
  if (!settings.accountHolderName?.trim()) return false;
  if (settings.payoutMethod === "bank") {
    return Boolean(settings.bankAccountNumber?.trim() && settings.ifscCode?.trim());
  }
  return Boolean(settings.upiId?.trim());
};

const getPayoutWallet = async (expertId) => {
  const expertObjectId = toObjectId(expertId);

  const [bookingRows, payoutRows] = await Promise.all([
    Booking.aggregate([
      {
        $match: {
          expert: expertObjectId,
          status: "completed",
          paymentStatus: "paid",
        },
      },
      { $group: { _id: null, grossEarnings: { $sum: "$totalPrice" } } },
    ]),
    Payout.aggregate([
      { $match: { expert: expertObjectId } },
      { $group: { _id: "$status", total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
  ]);

  const grossEarnings = roundMoney(bookingRows[0]?.grossEarnings || 0);
  const platformCommission = roundMoney((grossEarnings * PLATFORM_COMMISSION_PERCENT) / 100);
  const totalEarnings = roundMoney(grossEarnings - platformCommission);

  const payoutTotals = payoutRows.reduce((totals, row) => {
    totals[row._id] = {
      amount: roundMoney(row.total),
      count: row.count,
    };
    return totals;
  }, {});

  const pendingEarnings = ACTIVE_PAYOUT_STATUSES.reduce(
    (sum, status) => sum + (payoutTotals[status]?.amount || 0),
    0
  );
  const paidOut = payoutTotals.paid?.amount || 0;
  const availableBalance = roundMoney(Math.max(0, totalEarnings - pendingEarnings - paidOut));

  return {
    grossEarnings,
    totalEarnings,
    pendingEarnings: roundMoney(pendingEarnings),
    availableBalance,
    paidOut: roundMoney(paidOut),
    platformCommission,
    platformCommissionPercent: PLATFORM_COMMISSION_PERCENT,
    payoutCounts: payoutTotals,
  };
};

module.exports = {
  ACTIVE_PAYOUT_STATUSES,
  PLATFORM_COMMISSION_PERCENT,
  getPayoutDetailsSnapshot,
  getPayoutSettings,
  getPayoutWallet,
  isPayoutSettingsComplete,
  roundMoney,
};
