const jwt = require("jsonwebtoken");
const User = require("../models/User");

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
    const user = await User.findById(decoded.id).select("role isBlocked");
    if (!user) {
      return res.status(401).json({ message: "User account no longer exists" });
    }
    if (user.isBlocked) {
      return res.status(403).json({ message: "Your account has been blocked by admin" });
    }
    req.authUser = user;
    next();
  } catch (err) {
    res.status(401).json({ message: "Token is not valid" });
  }
};

module.exports = authMiddleware;
