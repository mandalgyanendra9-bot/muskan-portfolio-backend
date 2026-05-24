const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  expert: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  slotStart: { type: Date, required: true },
  slotEnd: { type: Date, required: true },
  duration: { type: Number, default: 1 }, // in hours
  totalPrice: { type: Number, required: true },
  isPriority: { type: Boolean, default: false },
  status: { 
    type: String, 
    enum: ["pending", "confirmed", "completed", "cancelled"], 
    default: "pending" 
  },
  paymentStatus: { 
    type: String, 
    enum: ["unpaid", "paid", "refunded"], 
    default: "unpaid" 
  },
  paymentId: { type: String },
  meetingLink: { type: String, default: "" },
  ratingGiven: { type: Boolean, default: false },
  notes: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Booking", bookingSchema);
