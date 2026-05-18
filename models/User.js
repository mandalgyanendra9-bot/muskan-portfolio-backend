const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  profileImage: { type: String, default: "" },
  role: { type: String, enum: ["client", "user", "admin", "expert"], default: "client" },
  
  // Professional Details
  title: { type: String, default: "Professional" },
  bio: { type: String, default: "" },
  skills: [{ type: String }],
  hourlyRate: { type: Number, default: 0 },
  location: { type: String, default: "" },
  experience: { type: String, default: "" },
  
  // Social / Portfolio Links
  github: { type: String, default: "" },
  linkedin: { type: String, default: "" },
  portfolio: { type: String, default: "" },
  
  // Verification & Onboarding
  isApproved: { type: Boolean, default: false }, // Experts need admin approval
  isProfileComplete: { type: Boolean, default: false },
  
  // Rating system
  rating: { type: Number, default: 5 },
  reviewsCount: { type: Number, default: 0 },
  
  // Availability
  isAvailable: { type: Boolean, default: true },
  
  // Favorite experts for clients
  favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("User", userSchema);