const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const sendEmail = require("../config/email");

// ─── Helper: Generate JWT ────────────────────────────────────────────────────
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "7d" });
};

// ─── Helper: Safe user object (strip sensitive fields) ───────────────────────
const safeUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  profileImage: user.profileImage,
  isEmailVerified: user.isEmailVerified,
  isApproved: user.isApproved,
  isBlocked: user.isBlocked,
  isProfileComplete: user.isProfileComplete,
  title: user.title,
  category: user.category,
  bio: user.bio,
  skills: user.skills,
  hourlyRate: user.hourlyRate,
  pricePerMinute: user.pricePerMinute,
  location: user.location,
  experience: user.experience,
  github: user.github,
  linkedin: user.linkedin,
  portfolio: user.portfolio,
  introVideo: user.introVideo,
  portfolioGallery: user.portfolioGallery,
  availabilitySchedule: user.availabilitySchedule,
  isAvailable: user.isAvailable,
  rating: user.rating,
  reviewsCount: user.reviewsCount,
  favorites: user.favorites,
});

// ─────────────────────────────────────────────────────────────────────────────
// REGISTER
// POST /api/auth/register
// ─────────────────────────────────────────────────────────────────────────────
exports.register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email and password are required." });
    }

    const userExist = await User.findOne({ email });
    if (userExist) {
      return res.status(400).json({ message: "An account with this email already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const emailVerifyToken = crypto.randomBytes(32).toString("hex");

    await User.create({
      name,
      email,
      password: hashedPassword,
      role: role || "client",
      emailVerifyToken,
      isEmailVerified: false,
    });

    // Send verification email
    const verifyUrl = `${process.env.CLIENT_URL}/verify-email/${emailVerifyToken}`;
    await sendEmail({
      to: email,
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

    const user = await User.findOne({ email });
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

    const token = generateToken(user._id);

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

    const user = await User.findOne({ email });

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
      to: email,
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

    // Find or create user
    let user = await User.findOne({ email: payload.email });

    if (!user) {
      // New user — create from Google profile
      user = await User.create({
        name: payload.name,
        email: payload.email,
        profileImage: payload.picture || "",
        googleId: payload.sub,
        isEmailVerified: true, // Google already verified the email
        role: "client",
        password: null,
      });
    } else {
      if (user.isBlocked) {
        return res.status(403).json({ message: "Your account has been blocked by admin." });
      }

      // Existing user — link Google account if not already linked
      if (!user.googleId) {
        user.googleId = payload.sub;
      }
      user.isEmailVerified = true;
      if (!user.profileImage && payload.picture) {
        user.profileImage = payload.picture;
      }
      await user.save();
    }

    const token = generateToken(user._id);

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
