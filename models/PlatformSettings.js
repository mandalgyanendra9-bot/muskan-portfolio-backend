const mongoose = require("mongoose");

const platformSettingsSchema = new mongoose.Schema({
  key: { type: String, default: "platform", unique: true },
  commissionPercent: { type: Number, default: 20, min: 0, max: 100 },
}, { timestamps: true });

module.exports = mongoose.model("PlatformSettings", platformSettingsSchema);
