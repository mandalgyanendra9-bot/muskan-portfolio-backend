const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  expert: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  expertId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  startAt: { type: Date, default: null },
  endAt: { type: Date, default: null },
  timezone: { type: String, default: "Asia/Kolkata" },
  date: { type: String, default: "" },
  startTime: { type: String, default: "" },
  endTime: { type: String, default: "" },
  slotStart: { type: Date, required: true },
  slotEnd: { type: Date, required: true },
  duration: { type: Number, default: 1 }, // minutes for new bookings; legacy bookings may be hours
  durationMinutes: { type: Number, default: 0 },
  perMinuteRate: { type: Number, default: 0 },
  totalPrice: { type: Number, required: true },
  totalAmount: { type: Number, default: 0 },
  grossAmount: { type: Number, default: 0 },
  platformCommission: { type: Number, default: 0 },
  expertEarning: { type: Number, default: 0 },
  commissionPercent: { type: Number, default: 20 },
  expertWalletCredited: { type: Boolean, default: false },
  expertWalletCreditedAt: { type: Date, default: null },
  payoutStatus: {
    type: String,
    enum: ["not_requested", "pending", "requested", "approved", "processing", "paid", "rejected"],
    default: "not_requested",
  },
  orderId: { type: String, default: "" },
  paymentFailureReason: { type: String, default: "" },
  isPriority: { type: Boolean, default: false },
  status: { 
    type: String, 
    enum: ["pending", "confirmed", "completed", "cancelled"], 
    default: "pending" 
  },
  bookingStatus: {
    type: String,
    enum: ["pending", "confirmed", "completed", "cancelled"],
    default: "pending",
  },
  paymentStatus: { 
    type: String, 
    enum: ["unpaid", "paid", "refunded", "failed", "cancelled"], 
    default: "unpaid" 
  },
  paymentId: { type: String },
  meetingLink: { type: String, default: "" },
  videoCallUrl: { type: String, default: "" },
  ratingGiven: { type: Boolean, default: false },
  notes: { type: String },
  createdAt: { type: Date, default: Date.now }
});

bookingSchema.index({ expert: 1, startAt: 1, endAt: 1 });
bookingSchema.index({ client: 1, startAt: 1 });

module.exports = mongoose.model("Booking", bookingSchema);
