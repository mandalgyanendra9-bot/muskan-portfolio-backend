const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const sendEmail = require("../config/email");
const { normalizeEmail, normalizeRoleForEmail, isAdminEmail } = require("../utils/adminAccess");
const { applyReferralReward, ensureReferralCode } = require("../utils/referrals");
const {
  getProfilePhotoCandidate,
  getRoleLabel,
  resolveProfilePhotoUrl,
  setProfilePhotoFields,
} = require("../utils/profilePhoto");

// ─── Helper: Generate JWT ────────────────────────────────────────────────────
const hashValue = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

const getSessionFingerprint = (req) => hashValue(req.headers["user-agent"] || "unknown-device");

const generateToken = (userId, sessionId, fingerprintHash) => {
  return jwt.sign(
    { id: userId, sid: sessionId, fp: fingerprintHash },
    process.env.JWT_SECRET || "secretkey",
    { expiresIn: "7d" }
  );
};

const startProtectedSession = async (user, req) => {
  const sessionId = crypto.randomBytes(24).toString("hex");
  const fingerprintHash = getSessionFingerprint(req);
  user.activeSessionId = sessionId;
  user.sessionFingerprintHash = fingerprintHash;
  user.lastLoginAt = new Date();
  await user.save();
  return generateToken(user._id, sessionId, fingerprintHash);
};

// ─── Helper: Safe user object (strip sensitive fields) ───────────────────────
const safeUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  ...setProfilePhotoFields({}, getProfilePhotoCandidate(user)),
  profileImageUrl: resolveProfilePhotoUrl(user),
  profilePhotoUrl: resolveProfilePhotoUrl(user),
  displayRole: getRoleLabel(user),
  isSuperAdmin: isAdminEmail(user.email) || user.role === "admin",
  isEmailVerified: user.isEmailVerified,
  isApproved: user.isApproved,
  isBlocked: user.isBlocked,
  isProfileComplete: user.isProfileComplete,
  title: user.title,
  category: user.category,
  department: user.department,
  designation: user.designation,
  qualification: user.qualification,
  bio: user.bio,
  skills: user.skills,
  researchInterests: user.researchInterests,
  googleScholarId: user.googleScholarId,
  orcidId: user.orcidId,
  scopusId: user.scopusId,
  hourlyRate: user.hourlyRate,
  pricePerMinute: user.pricePerMinute,
  location: user.location,
  experience: user.experience,
  github: user.github,
  linkedin: user.linkedin,
  portfolio: user.portfolio,
  introVideo: user.introVideo,
  portfolioGallery: user.portfolioGallery,
  publicationsCount: user.publicationsCount || 0,
  projectsCount: user.projectsCount || 0,
  patentsCount: user.patentsCount || 0,
  availabilitySchedule: user.availabilitySchedule,
  isAvailable: user.isAvailable,
  rating: user.rating,
  reviewsCount: user.reviewsCount,
  favorites: user.favorites,
  followers: user.followers,
  subscribers: user.subscribers,
  walletBalance: user.walletBalance,
  coinBalance: user.coinBalance,
  subscriptionPlan: user.subscriptionPlan,
  subscriptionExpiresAt: user.subscriptionExpiresAt,
  referralCode: user.referralCode,
  referredBy: user.referredBy,
  referralCount: user.referralCount,
  referralRewardCoins: user.referralRewardCoins,
  sessionProtectionEnabled: user.sessionProtectionEnabled,
  lastLoginAt: user.lastLoginAt,
});

// ─────────────────────────────────────────────────────────────────────────────
// REGISTER
// POST /api/auth/register
// ─────────────────────────────────────────────────────────────────────────────
exports.register = async (req, res) => {
  try {
    const { name, email, password, referralCode } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email and password are required." });
    }

    const emailAddress = normalizeEmail(email);
    const userExist = await User.findOne({ email: emailAddress });
    if (userExist) {
      return res.status(400).json({ message: "An account with this email already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const emailVerifyToken = crypto.randomBytes(32).toString("hex");
    const requestedRole = req.body.role === "expert" ? "expert" : "client";

    const user = await User.create({
      name,
      email: emailAddress,
      password: hashedPassword,
      role: normalizeRoleForEmail(emailAddress, requestedRole),
      emailVerifyToken,
      isEmailVerified: false,
    });
    await ensureReferralCode(user);
    await applyReferralReward(user, referralCode);

    // Send verification email
    const verifyUrl = `${process.env.CLIENT_URL}/verify-email/${emailVerifyToken}`;
    await sendEmail({
      to: emailAddress,
      subject: "✅ Verify Your Email — Portfolio",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px;background:#0f172a;color:#e2e8f0;border-radius:16px;">
          <h2 style="color:#818cf8;margin-bottom:8px;">Welcome, ${name}! 🎉</h2>
          <p style="color:#94a3b8;margin-bottom:24px;">Thanks for signing up. Please verify your email to activate your account.</p>
          <a href="${verifyUrl}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px;margin-bottom:24px;">
            Verify My Email
          </a>
          <p style="color:#64748b;font-size:13px;">Or paste this link in your browser:<br/><a href="${verifyUrl}" style="color:#818cf8;">${verifyUrl}</a></p>
          <p style="color:#475569;font-size:12px;margin-top:24px;border-top:1px solid #1e293b;padding-top:16px;">This link expires in 24 hours. If you didn't create an account, ignore this email.</p>
        </div>
      `,
    });

    res.status(201).json({
      message: "Registration successful! Please check your email to verify your account.",
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY EMAIL
// GET /api/auth/verify-email/:token
// ─────────────────────────────────────────────────────────────────────────────
exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;
    const user = await User.findOne({ emailVerifyToken: token });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired verification link." });
    }

    user.isEmailVerified = true;
    user.emailVerifyToken = null;
    await user.save();

    res.json({ message: "Email verified successfully! You can now log in." });
  } catch (err) {
    console.error("VerifyEmail error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN
// POST /api/auth/login
// ─────────────────────────────────────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const emailAddress = normalizeEmail(email);
    const user = await User.findOne({ email: emailAddress });
    if (!user) {
      return res.status(400).json({ message: "No account found with this email." });
    }

    if (user.isBlocked) {
      return res.status(403).json({ message: "Your account has been blocked by admin." });
    }

    // Google-only users have no password
    if (!user.password) {
      return res.status(400).json({
        message: "This account uses Google Sign-In. Please log in with Google.",
      });
    }

    if (!user.isEmailVerified) {
      return res.status(403).json({
        message: "Please verify your email before logging in. Check your inbox.",
        needsVerification: true,
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Incorrect password." });
    }

    const secureRole = normalizeRoleForEmail(user.email, user.role, { allowManualAdmin: true });
    if (user.role !== secureRole) user.role = secureRole;

    const token = await startProtectedSession(user, req);

    res.json({
      message: "Login successful",
      token,
      user: safeUser(user),
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: err.message });
  }
};

// REQUEST OTP LOGIN
// POST /api/auth/request-otp
exports.requestOtp = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required." });

    const emailAddress = normalizeEmail(email);
    const user = await User.findOne({ email: emailAddress });
    const genericMessage = "If this email is registered, a login OTP has been sent.";

    if (!user || user.isBlocked) {
      return res.json({ message: genericMessage });
    }

    if (!user.isEmailVerified) {
      return res.status(403).json({
        message: "Please verify your email before requesting OTP login.",
        needsVerification: true,
      });
    }

    const otp = String(crypto.randomInt(100000, 999999));
    user.otpLoginHash = hashValue(otp);
    user.otpLoginExpires = new Date(Date.now() + 10 * 60 * 1000);
    user.otpLoginAttempts = 0;
    await user.save();

    let debugOtp;
    try {
      await sendEmail({
        to: emailAddress,
        subject: "Your login OTP",
        html: `
          <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px;background:#0f172a;color:#e2e8f0;border-radius:16px;">
            <h2 style="color:#818cf8;margin-bottom:8px;">Login OTP</h2>
            <p style="color:#94a3b8;">Use this one-time code to sign in. It expires in <strong>10 minutes</strong>.</p>
            <div style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#fff;background:#1e293b;padding:18px;border-radius:12px;text-align:center;margin:24px 0;">${otp}</div>
            <p style="color:#64748b;font-size:13px;">If you did not request this code, ignore this email.</p>
          </div>
        `,
      });
    } catch (emailError) {
      console.error("OTP email error:", emailError.message);
      if (process.env.NODE_ENV !== "production") debugOtp = otp;
      else throw emailError;
    }

    res.json({
      message: genericMessage,
      ...(debugOtp ? { debugOtp } : {}),
    });
  } catch (err) {
    console.error("RequestOtp error:", err);
    res.status(500).json({ message: err.message });
  }
};

// VERIFY OTP LOGIN
// POST /api/auth/verify-otp
exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ message: "Email and OTP are required." });

    const emailAddress = normalizeEmail(email);
    const user = await User.findOne({ email: emailAddress });
    if (!user || !user.otpLoginHash || !user.otpLoginExpires) {
      return res.status(400).json({ message: "Invalid or expired OTP." });
    }

    if (user.isBlocked) {
      return res.status(403).json({ message: "Your account has been blocked by admin." });
    }

    if (user.otpLoginExpires.getTime() < Date.now()) {
      user.otpLoginHash = null;
      user.otpLoginExpires = null;
      user.otpLoginAttempts = 0;
      await user.save();
      return res.status(400).json({ message: "OTP has expired. Please request a new one." });
    }

    if (user.otpLoginAttempts >= 5) {
      return res.status(429).json({ message: "Too many OTP attempts. Please request a new code." });
    }

    const isMatch = user.otpLoginHash === hashValue(otp);
    if (!isMatch) {
      user.otpLoginAttempts += 1;
      await user.save();
      return res.status(400).json({ message: "Incorrect OTP." });
    }

    user.otpLoginHash = null;
    user.otpLoginExpires = null;
    user.otpLoginAttempts = 0;
    const secureRole = normalizeRoleForEmail(user.email, user.role, { allowManualAdmin: true });
    if (user.role !== secureRole) user.role = secureRole;
    const token = await startProtectedSession(user, req);

    res.json({
      message: "OTP login successful",
      token,
      user: safeUser(user),
    });
  } catch (err) {
    console.error("VerifyOtp error:", err);
    res.status(500).json({ message: err.message });
  }
};

exports.getSessionStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({
      sessionProtectionEnabled: user.sessionProtectionEnabled,
      lastLoginAt: user.lastLoginAt,
      activeSession: Boolean(user.activeSessionId),
      encryption: "Client-side AES-GCM tools are available on the Security page.",
      rateLimiting: "Enabled for sensitive API routes.",
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// FORGOT PASSWORD
// POST /api/auth/forgot-password
// ─────────────────────────────────────────────────────────────────────────────
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required." });
    }

    const emailAddress = normalizeEmail(email);
    const user = await User.findOne({ email: emailAddress });

    // Always return same message to prevent email enumeration
    const successMsg = "If this email is registered, you'll receive a password reset link shortly.";

    if (!user || !user.password) {
      return res.json({ message: successMsg });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    await user.save();

    const resetUrl = `${process.env.CLIENT_URL}/reset-password/${resetToken}`;
    await sendEmail({
      to: emailAddress,
      subject: "🔐 Password Reset Request — Portfolio",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px;background:#0f172a;color:#e2e8f0;border-radius:16px;">
          <h2 style="color:#818cf8;margin-bottom:8px;">Password Reset</h2>
          <p style="color:#94a3b8;margin-bottom:24px;">You requested a password reset. Click below to set a new password. This link expires in <strong>1 hour</strong>.</p>
          <a href="${resetUrl}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px;margin-bottom:24px;">
            Reset My Password
          </a>
          <p style="color:#64748b;font-size:13px;">Or paste this link in your browser:<br/><a href="${resetUrl}" style="color:#818cf8;">${resetUrl}</a></p>
          <p style="color:#475569;font-size:12px;margin-top:24px;border-top:1px solid #1e293b;padding-top:16px;">If you didn't request this, you can safely ignore this email. Your password won't change.</p>
        </div>
      `,
    });

    res.json({ message: successMsg });
  } catch (err) {
    console.error("ForgotPassword error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// RESET PASSWORD
// POST /api/auth/reset-password/:token
// ─────────────────────────────────────────────────────────────────────────────
exports.resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters." });
    }

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: "Reset link is invalid or has expired." });
    }

    user.password = await bcrypt.hash(password, 10);
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    res.json({ message: "Password reset successful! You can now log in with your new password." });
  } catch (err) {
    console.error("ResetPassword error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE LOGIN
// POST /api/auth/google-login
// ─────────────────────────────────────────────────────────────────────────────
exports.googleLogin = async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({ message: "Google credential is required." });
    }

    // Verify the ID token with Google's tokeninfo endpoint
    const https = require('https');
    const payload = await new Promise((resolve, reject) => {
      https.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`, (response) => {
        let data = '';
        response.on('data', (chunk) => data += chunk);
        response.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      }).on('error', reject);
    });

    if (!payload || !payload.email) {
      return res.status(400).json({ message: "Invalid Google token. Please try again." });
    }

    // Verify the token was issued for our app
    if (payload.aud !== process.env.GOOGLE_CLIENT_ID) {
      return res.status(400).json({ message: "Token audience mismatch." });
    }

    const emailAddress = normalizeEmail(payload.email);

    // Find or create user
    let user = await User.findOne({ email: emailAddress });

    if (!user) {
      // New user — create from Google profile
      user = await User.create({
        name: payload.name,
        email: emailAddress,
        profilePhotoUrl: payload.picture || "",
        profileImage: payload.picture || "",
        googlePhoto: payload.picture || "",
        googleId: payload.sub,
        isEmailVerified: true, // Google already verified the email
        role: normalizeRoleForEmail(emailAddress),
        password: null,
      });
      await ensureReferralCode(user);
      await applyReferralReward(user, req.body.referralCode);
    } else {
      if (user.isBlocked) {
        return res.status(403).json({ message: "Your account has been blocked by admin." });
      }

      // Existing user — link Google account if not already linked
      if (!user.googleId) {
        user.googleId = payload.sub;
      }
      user.isEmailVerified = true;
      if (!getProfilePhotoCandidate(user) && payload.picture) {
        user.profilePhotoUrl = payload.picture;
        user.profileImage = payload.picture;
        user.googlePhoto = payload.picture;
      }
      const secureRole = normalizeRoleForEmail(user.email, user.role, { allowManualAdmin: true });
      if (user.role !== secureRole) user.role = secureRole;
      await ensureReferralCode(user);
      await user.save();
    }

    const token = await startProtectedSession(user, req);

    res.json({
      message: "Google login successful",
      token,
      user: safeUser(user),
    });
  } catch (err) {
    console.error("GoogleLogin error:", err);
    res.status(500).json({ message: err.message });
  }
};
