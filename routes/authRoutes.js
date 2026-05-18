const express = require("express");
const router = express.Router();
const {
  register,
  login,
  verifyEmail,
  forgotPassword,
  resetPassword,
  googleLogin,
} = require("../controllers/authController");

// ─── Standard Auth ────────────────────────────────────────────────────────────
router.post("/register", register);
router.post("/login", login);

// ─── Email Verification ───────────────────────────────────────────────────────
router.get("/verify-email/:token", verifyEmail);

// ─── Password Reset ───────────────────────────────────────────────────────────
router.post("/forgot-password", forgotPassword);
router.post("/reset-password/:token", resetPassword);

// ─── Google OAuth ─────────────────────────────────────────────────────────────
router.post("/google-login", googleLogin);

module.exports = router;