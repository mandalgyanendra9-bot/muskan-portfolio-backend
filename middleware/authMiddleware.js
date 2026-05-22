const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");

const hashValue = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const getSessionFingerprint = (req) => hashValue(req.headers["user-agent"] || "unknown-device");

const authMiddleware = async (req, res, next) => {
  let token = req.header("Authorization");

  if (!token) {
    return res.status(401).json({ message: "No token, authorization denied" });
  }

  // Handle 'Bearer ' prefix if present
  if (token.startsWith("Bearer ")) {
    token = token.slice(7, token.length);
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "secretkey");
    req.user = decoded;
    const user = await User.findById(decoded.id).select(
      "role isBlocked activeSessionId sessionFingerprintHash sessionProtectionEnabled"
    );
    if (!user) {
      return res.status(401).json({ message: "User account no longer exists" });
    }
    if (user.isBlocked) {
      return res.status(403).json({ message: "Your account has been blocked by admin" });
    }
    if (decoded.sid && user.activeSessionId && decoded.sid !== user.activeSessionId) {
      return res.status(401).json({ message: "Session expired. Please log in again." });
    }
    if (user.sessionProtectionEnabled && decoded.fp && user.sessionFingerprintHash) {
      const currentFingerprint = getSessionFingerprint(req);
      if (decoded.fp !== user.sessionFingerprintHash || decoded.fp !== currentFingerprint) {
        return res.status(401).json({ message: "Session protection check failed. Please log in again." });
      }
    }
    req.authUser = user;
    next();
  } catch (err) {
    res.status(401).json({ message: "Token is not valid" });
  }
};

module.exports = authMiddleware;
