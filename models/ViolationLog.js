const mongoose = require("mongoose");

const violationLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", default: null },
  targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  action: { type: String, required: true, trim: true, maxlength: 120 },
  details: { type: String, default: "" },
  page: { type: String, default: "" },
  source: { type: String, default: "web" },
  status: {
    type: String,
    enum: ["open", "reviewed", "blocked", "dismissed"],
    default: "open",
  },
  timestamp: { type: Date, default: Date.now },
}, { versionKey: false });

module.exports = mongoose.model("ViolationLog", violationLogSchema);
