const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  profileImage: { type: String, default: "" },
  role: { type: String, enum: ["user", "admin", "expert"], default: "user" },
  
  // Professional Details
  title: { type: String, default: "Professional" },
  bio: { type: String, default: "" },
  skills: [{ type: String }],
  hourlyRate: { type: Number, default: 0 },
  location: { type: String, default: "" },
  
  // Availability
  isAvailable: { type: Boolean, default: true },
  
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("User", userSchema);