const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  type: {
    type: String,
    enum: ["wallet_topup", "booking_payment", "subscription", "withdrawal"],
    required: true,
  },
  amount: { type: Number, required: true },
  currency: { type: String, default: "INR" },
  status: {
    type: String,
    enum: ["pending", "success", "failed", "processing"],
    default: "pending",
  },
  
  // Withdrawal specific
  bankDetails: {
    accountNumber: { type: String },
    ifsc: { type: String },
    bankName: { type: String },
  },

  // Payment Gateway references
  razorpayOrderId: { type: String },
  razorpayPaymentId: { type: String },
  razorpaySignature: { type: String },

  // Relation to other collections (optional)
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking" },
  description: { type: String }, // e.g. "Pro Plan Subscription"

  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Transaction", transactionSchema);
