const express = require("express");
const router = express.Router();
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/Upload");

// GET ALL EXPERTS (Public)
router.get("/experts", async (req, res) => {
  try {
    const experts = await User.find({ role: "expert", isAvailable: true })
      .select("-password")
      .sort({ createdAt: -1 });
    res.json(experts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET CURRENT USER PROFILE
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// UPDATE PROFILE (Details + DP)
router.put("/update", authMiddleware, upload.single("profileImage"), async (req, res) => {
  try {
    const { name, title, bio, skills, hourlyRate, location, role } = req.body;
    const updateData = { name, title, bio, hourlyRate, location, role };
    
    if (skills) updateData.skills = skills.split(",").map(s => s.trim());
    if (req.file) updateData.profileImage = `/uploads/${req.file.filename}`;
    
    const user = await User.findByIdAndUpdate(req.user.id, updateData, { new: true }).select("-password");
    res.json(user);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;
