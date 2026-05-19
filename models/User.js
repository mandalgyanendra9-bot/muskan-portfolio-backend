const mongoose = require("mongoose");

const availabilityDaySchema = new mongoose.Schema({
  day: { type: String }, // "Monday", "Tuesday", etc.
  from: { type: String, default: "09:00" },
  to: { type: String, default: "18:00" },
  available: { type: Boolean, default: false },
}, { _id: false });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  password: { type: String, default: null },

  profileImage: { type: String, default: "" },
  role: { type: String, enum: ["client", "user", "admin", "expert"], default: "client" },

  // ─── Google OAuth ──────────────────────────────────────
  googleId: { type: String, default: null },

  // ─── Email Verification ────────────────────────────────
  isEmailVerified: { type: Boolean, default: false },
  emailVerifyToken: { type: String, default: null },

  // ─── Password Reset ────────────────────────────────────
  resetPasswordToken: { type: String, default: null },
  resetPasswordExpires: { type: Date, default: null },

  // ─── Professional Details ──────────────────────────────
  title: { type: String, default: "Professional" },
  category: { type: String, default: "" },      // e.g. "Web Development", "Design"
  bio: { type: String, default: "" },
  skills: [{ type: String }],
  hourlyRate: { type: Number, default: 0 },
  pricePerMinute: { type: Number, default: 0 },
  location: { type: String, default: "" },
  experience: { type: String, default: "" },

  // ─── Intro Video ───────────────────────────────────────
  introVideo: { type: String, default: "" },    // YouTube / Vimeo URL

  // ─── Portfolio Gallery ─────────────────────────────────
  portfolioGallery: [{ type: String }],          // array of /uploads/... paths

  // ─── Availability Schedule ─────────────────────────────
  availabilitySchedule: {
    type: [availabilityDaySchema],
    default: () => [
      { day: "Monday",    from: "09:00", to: "18:00", available: false },
      { day: "Tuesday",   from: "09:00", to: "18:00", available: false },
      { day: "Wednesday", from: "09:00", to: "18:00", available: false },
      { day: "Thursday",  from: "09:00", to: "18:00", available: false },
      { day: "Friday",    from: "09:00", to: "18:00", available: false },
      { day: "Saturday",  from: "10:00", to: "15:00", available: false },
      { day: "Sunday",    from: "10:00", to: "15:00", available: false },
    ],
  },

  // ─── Social / Portfolio Links ──────────────────────────
  github: { type: String, default: "" },
  linkedin: { type: String, default: "" },
  portfolio: { type: String, default: "" },

  // ─── Verification & Onboarding ─────────────────────────
  isApproved: { type: Boolean, default: false },
  isProfileComplete: { type: Boolean, default: false },

  // ─── Rating System ─────────────────────────────────────
  rating: { type: Number, default: 5 },
  reviewsCount: { type: Number, default: 0 },

  // ─── Availability ──────────────────────────────────────
  isAvailable: { type: Boolean, default: true },

  // ─── Favorites ─────────────────────────────────────────
  favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

  // ─── Wallet & Subscriptions ────────────────────────────
  walletBalance: { type: Number, default: 0 },
  subscriptionPlan: { type: String, enum: ["free", "pro", "premium"], default: "free" },
  subscriptionExpiresAt: { type: Date, default: null },

  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("User", userSchema);