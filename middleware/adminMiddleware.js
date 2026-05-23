const User = require("../models/User");
const { isAdminEmail } = require("../utils/adminAccess");

const adminMiddleware = async (req, res, next) => {
  try {
    const user = req.authUser || await User.findById(req.user.id).select("email role isBlocked");

    if (!user || user.isBlocked) {
      return res.status(403).json({ message: "Unauthorized: admin access required." });
    }

    if (!isAdminEmail(user.email)) {
      if (user.role === "admin") {
        user.role = "client";
        await user.save();
      }
      return res.status(403).json({ message: "Unauthorized: admin access required." });
    }

    if (user.role !== "admin") {
      user.role = "admin";
      await user.save();
    }

    req.adminUser = user;
    next();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = adminMiddleware;
