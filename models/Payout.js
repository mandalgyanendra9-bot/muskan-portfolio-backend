const mongoose = require("mongoose");

const payoutDetailsSnapshotSchema = new mongoose.Schema({
  payoutMethod: { type: String, enum: ["upi", "bank"], default: "upi" },
  upiId: { type: String, default: "" },
  accountHolderName: { type: String, default: "" },
  bankAccountNumber: { type: String, default: "" },
  ifscCode: { type: String, default: "" },
}, { _id: false });

const payoutSchema = new mongoose.Schema({
  expert: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  amount: { type: Number, required: true },
  commission: { type: Number, default: 0 },
  netAmount: { type: Number, required: true },
  grossEarningsAtRequest: { type: Number, default: 0 },
  totalEarningsAtRequest: { type: Number, default: 0 },
  availableBalanceAtRequest: { type: Number, default: 0 },
  paidOutAtRequest: { type: Number, default: 0 },
  platformCommissionPercent: { type: Number, default: 20 },
  payoutMethod: { type: String, enum: ["upi", "bank"], default: "upi" },
  payoutDetails: { type: payoutDetailsSnapshotSchema, default: () => ({}) },
  status: {
    type: String,
    enum: ["pending", "approved", "paid", "rejected"],
    default: "pending",
  },
  transactionId: { type: String, default: "" },
  adminNote: { type: String, default: "" },
  processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  processedAt: { type: Date, default: null },
  paidAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model("Payout", payoutSchema);
