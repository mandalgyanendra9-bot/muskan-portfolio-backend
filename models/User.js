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

  profilePhotoUrl: { type: String, default: "" },
  image: { type: String, default: "" },
  profileImage: { type: String, default: "" },
  profilePhoto: { type: String, default: "" },
  avatar: { type: String, default: "" },
  photoUrl: { type: String, default: "" },
  googlePhoto: { type: String, default: "" },
  role: { type: String, enum: ["admin", "expert", "client"], default: "client" },

  // ─── Google OAuth ──────────────────────────────────────
  googleId: { type: String, default: null },

  // ─── Email Verification ────────────────────────────────
  isEmailVerified: { type: Boolean, default: false },
  emailVerifyToken: { type: String, default: null },

  // ─── Password Reset ────────────────────────────────────
  resetPasswordToken: { type: String, default: null },
  resetPasswordExpires: { type: Date, default: null },

  // Security
  otpLoginHash: { type: String, default: null },
  otpLoginExpires: { type: Date, default: null },
  otpLoginAttempts: { type: Number, default: 0 },
  activeSessionId: { type: String, default: null },
  sessionFingerprintHash: { type: String, default: null },
  sessionProtectionEnabled: { type: Boolean, default: true },
  lastLoginAt: { type: Date, default: null },

  // ─── Professional Details ──────────────────────────────
  title: { type: String, default: "Professional" },
  category: { type: String, default: "" },      // e.g. "Web Development", "Design"
  department: { type: String, default: "" },
  designation: { type: String, default: "" },
  qualification: { type: String, default: "" },
  bio: { type: String, default: "" },
  skills: [{ type: String }],
  researchInterests: [{ type: String }],
  googleScholarId: { type: String, default: "" },
  orcidId: { type: String, default: "" },
  scopusId: { type: String, default: "" },
  hourlyRate: { type: Number, default: 0 },
  pricePerMinute: { type: Number, default: 0 },
  location: { type: String, default: "" },
  experience: { type: String, default: "" },

  // ─── Intro Video ───────────────────────────────────────
  introVideo: { type: String, default: "" },    // YouTube / Vimeo URL
  exclusiveContent: { type: String, default: "" },

  // ─── Portfolio Gallery ─────────────────────────────────
  portfolioGallery: [{ type: String }],          // array of /uploads/... paths
  publicationsCount: { type: Number, default: 0 },
  projectsCount: { type: Number, default: 0 },
  patentsCount: { type: Number, default: 0 },

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

  timezone: { type: String, default: "UTC" },
  slotDuration: { type: Number, default: 30 }, // minutes

  // ─── Social / Portfolio Links ──────────────────────────
  github: { type: String, default: "" },
  linkedin: { type: String, default: "" },
  portfolio: { type: String, default: "" },

  // ─── Verification & Onboarding ─────────────────────────
  isApproved: { type: Boolean, default: false },
  isProfileComplete: { type: Boolean, default: false },
  isBlocked: { type: Boolean, default: false },

  // ─── Rating System ─────────────────────────────────────
  rating: { type: Number, default: 5 },
  reviewsCount: { type: Number, default: 0 },

  // ─── Availability ──────────────────────────────────────
  isAvailable: { type: Boolean, default: true },

  // ─── Favorites ─────────────────────────────────────────
  favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  followers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  subscribers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

  // ─── Wallet & Subscriptions ────────────────────────────
  walletBalance: { type: Number, default: 0 },
  coinBalance: { type: Number, default: 250 },
  lastCoinClaimAt: { type: Date, default: null },
  subscriptionPlan: { type: String, enum: ["free", "pro", "premium"], default: "free" },
  subscriptionExpiresAt: { type: Date, default: null },
  referralCode: { type: String, unique: true, sparse: true, uppercase: true, trim: true },
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  referralCount: { type: Number, default: 0 },
  referralRewardCoins: { type: Number, default: 0 },

  completedPaidBookings: { type: Number, default: 0 },
  verifiedExpert: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  // ─── Payout / Financial Details ─────────────────────
  upiId: { type: String, default: "" },
  accountHolderName: { type: String, default: "" },
  payoutMethod: { type: String, enum: ["upi", "bank"], default: "upi" },
  bankDetails: {
    accountNumber: { type: String, default: "" },
    ifsc: { type: String, default: "" },
    bankName: { type: String, default: "" },
  },
  kycDocumentUrl: { type: String, default: "" },
  payoutPreference: { type: String, enum: ["manual","auto"], default: "manual" },
  pendingPayoutAmount: { type: Number, default: 0 },
  payoutStatus: { type: String, enum: ["pending","approved","paid","rejected"], default: "pending" },
  isKycVerified: { type: Boolean, default: false },
});

module.exports = mongoose.model("User", userSchema);
