const express = require("express");
const router = express.Router();
const {
  register,
  login,
  requestOtp,
  verifyOtp,
  getSessionStatus,
  verifyEmail,
  forgotPassword,
  resetPassword,
  googleLogin,
} = require("../controllers/authController");
const authMiddleware = require("../middleware/authMiddleware");
const rateLimit = require("../middleware/rateLimiter");

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 80, keyPrefix: "auth" });
const otpLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 6, keyPrefix: "otp-login" });
const passwordResetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: "password-reset" });

// Standard auth
router.post("/register", authLimiter, register);
router.post("/login", authLimiter, login);
router.post("/google-login", authLimiter, googleLogin);

// OTP login
router.post("/request-otp", otpLimiter, requestOtp);
router.post("/verify-otp", otpLimiter, verifyOtp);

// Session protection
router.get("/session", authMiddleware, getSessionStatus);

// Email verification
router.get("/verify-email/:token", verifyEmail);

// Password reset
router.post("/forgot-password", passwordResetLimiter, forgotPassword);
router.post("/reset-password/:token", passwordResetLimiter, resetPassword);

module.exports = router;
