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
  bookings: [{ type: mongoose.Schema.Types.ObjectId, ref: "Booking" }],
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
    enum: ["requested", "pending", "approved", "processing", "paid", "rejected"],
    default: "requested",
  },
  transactionId: { type: String, default: "" },
  transferMethod: { type: String, enum: ["", "upi", "bank", "other"], default: "" },
  transferProofUrl: { type: String, default: "" },
  proofFileName: { type: String, default: "" },
  proofMimeType: { type: String, default: "" },
  adminNote: { type: String, default: "" },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  approvedAt: { type: Date, default: null },
  processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  processedAt: { type: Date, default: null },
  paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  paidAt: { type: Date, default: null },
  paidFieldsLocked: { type: Boolean, default: false },
}, { timestamps: true });

payoutSchema.index(
  { transactionId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      transactionId: { $type: "string", $gt: "" },
    },
  }
);

module.exports = mongoose.model("Payout", payoutSchema);
