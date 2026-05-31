const mongoose = require("mongoose");
const Booking = require("../models/Booking");
const Payout = require("../models/Payout");
const { getBookingEarnings, getCommissionPercent, roundMoney } = require("./earnings");

const ACTIVE_PAYOUT_STATUSES = ["requested", "pending", "approved", "processing"];

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
  const commissionPercent = await getCommissionPercent();

  const [paidBookings, payoutRows] = await Promise.all([
    Booking.find({
      expert: expertObjectId,
      paymentStatus: "paid",
      payoutStatus: { $in: ["not_requested", "pending", "requested", "approved", "paid"] },
    }).select("totalPrice grossAmount platformCommission expertEarning commissionPercent payoutStatus"),
    Payout.aggregate([
      { $match: { expert: expertObjectId } },
      { $group: { _id: "$status", total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
  ]);

  const totals = paidBookings.reduce((acc, booking) => {
    const earnings = getBookingEarnings(booking, commissionPercent);
    acc.grossEarnings += earnings.grossAmount;
    acc.platformCommission += earnings.platformCommission;
    acc.totalEarnings += earnings.expertEarning;

    if (booking.payoutStatus === "pending" || booking.payoutStatus === "not_requested") {
      acc.availableBalance += earnings.expertEarning;
      acc.availablePlatformCommission += earnings.platformCommission;
      acc.availableBookingIds.push(booking._id);
    } else if (booking.payoutStatus === "requested" || booking.payoutStatus === "approved" || booking.payoutStatus === "processing") {
      acc.pendingEarnings += earnings.expertEarning;
    } else if (booking.payoutStatus === "paid") {
      acc.paidOutFromBookings += earnings.expertEarning;
    }

    return acc;
  }, {
    availableBalance: 0,
    availableBookingIds: [],
    availablePlatformCommission: 0,
    grossEarnings: 0,
    paidOutFromBookings: 0,
    pendingEarnings: 0,
    platformCommission: 0,
    totalEarnings: 0,
  });

  const payoutCounts = payoutRows.reduce((rows, row) => {
    rows[row._id] = {
      amount: roundMoney(row.total),
      count: row.count,
    };
    return rows;
  }, {});

  const paidOut = payoutCounts.paid?.amount || totals.paidOutFromBookings || 0;

  return {
    grossEarnings: roundMoney(totals.grossEarnings),
    totalEarnings: roundMoney(totals.totalEarnings),
    pendingEarnings: roundMoney(totals.pendingEarnings),
    availableBalance: roundMoney(totals.availableBalance),
    paidOut: roundMoney(paidOut),
    platformCommission: roundMoney(totals.platformCommission),
    platformCommissionPercent: commissionPercent,
    availableBookingIds: totals.availableBookingIds,
    availablePlatformCommission: roundMoney(totals.availablePlatformCommission),
    payoutCounts,
  };
};

module.exports = {
  ACTIVE_PAYOUT_STATUSES,
  getPayoutDetailsSnapshot,
  getPayoutSettings,
  getPayoutWallet,
  isPayoutSettingsComplete,
  roundMoney,
};
