const mongoose = require("mongoose");

const liveMessageSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  name: { type: String, default: "Viewer" },
  message: { type: String, required: true, maxlength: 300 },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const liveGiftSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  name: { type: String, default: "Viewer" },
  giftId: { type: String, required: true },
  giftName: { type: String, required: true },
  coins: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const liveStreamSchema = new mongoose.Schema({
  host: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  title: { type: String, required: true, trim: true, maxlength: 100 },
  category: { type: String, default: "Portfolio Live", trim: true, maxlength: 60 },
  roomId: { type: String, required: true, unique: true },
  status: { type: String, enum: ["live", "ended"], default: "live" },
  viewerCount: { type: Number, default: 0 },
  peakViewers: { type: Number, default: 0 },
  totalCoins: { type: Number, default: 0 },
  chatMessages: [liveMessageSchema],
  gifts: [liveGiftSchema],
  startedAt: { type: Date, default: Date.now },
  endedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model("LiveStream", liveStreamSchema);
