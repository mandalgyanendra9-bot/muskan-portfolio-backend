const mongoose = require("mongoose");

const payoutAuditLogSchema = new mongoose.Schema({
  admin: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  payout: { type: mongoose.Schema.Types.ObjectId, ref: "Payout", required: true },
  amount: { type: Number, required: true },
  transactionId: { type: String, default: "" },
  action: {
    type: String,
    enum: ["payout_approved", "payout_marked_paid", "payout_reopened", "payout_paid_edited"],
    required: true,
  },
  timestamp: { type: Date, default: Date.now },
}, { versionKey: false });

module.exports = mongoose.model("PayoutAuditLog", payoutAuditLogSchema);
