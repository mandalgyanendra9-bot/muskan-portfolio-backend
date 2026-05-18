const express = require("express");
const router = express.Router();
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/Upload");

// GET ALL EXPERTS (Public - showing approved and available experts by default, or all experts for flexibility in dev)
router.get("/experts", async (req, res) => {
  try {
    // For extreme flexibility in live demo, we fetch experts. If they are marked isApproved = false, admin can approve them.
    // We display experts that are approved, but if none are approved, we fallback to all experts so the list is never empty.
    let experts = await User.find({ role: "expert", isAvailable: true, isApproved: true })
      .select("-password")
      .sort({ createdAt: -1 });
      
    if (experts.length === 0) {
      experts = await User.find({ role: "expert" })
        .select("-password")
        .sort({ createdAt: -1 });
    }
    res.json(experts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET CURRENT USER PROFILE
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password").populate("favorites", "name email profileImage title hourlyRate");
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET SINGLE EXPERT DETAILS (With reviews)
router.get("/expert/:id", async (req, res) => {
  try {
    const expert = await User.findById(req.params.id).select("-password");
    if (!expert) return res.status(404).json({ message: "Expert not found" });
    res.json(expert);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// UPDATE PROFILE (Details + DP)
router.put("/update", authMiddleware, upload.single("profileImage"), async (req, res) => {
  try {
    const { name, title, bio, skills, hourlyRate, location, role, experience, github, linkedin, portfolio, isAvailable } = req.body;
    
    const updateData = { 
      name, 
      title, 
      bio, 
      location, 
      role, 
      experience, 
      github, 
      linkedin, 
      portfolio,
      isAvailable: isAvailable === "true" || isAvailable === true
    };
    
    if (hourlyRate) updateData.hourlyRate = Number(hourlyRate);
    if (skills) {
      updateData.skills = Array.isArray(skills) 
        ? skills 
        : skills.split(",").map(s => s.trim()).filter(Boolean);
    }
    if (req.file) updateData.profileImage = `/uploads/${req.file.filename}`;
    
    // Auto-complete profile when core fields are filled
    if (name && title && bio) {
      updateData.isProfileComplete = true;
    }
    
    const user = await User.findByIdAndUpdate(req.user.id, updateData, { new: true })
      .select("-password")
      .populate("favorites", "name email profileImage title hourlyRate");
      
    res.json(user);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// TOGGLE FAVORITE EXPERT
router.post("/favorite/:expertId", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    
    const expertId = req.params.expertId;
    const index = user.favorites.indexOf(expertId);
    
    if (index > -1) {
      user.favorites.splice(index, 1); // remove from favorites
    } else {
      user.favorites.push(expertId); // add to favorites
    }
    
    await user.save();
    const updatedUser = await User.findById(req.user.id).select("-password").populate("favorites", "name email profileImage title hourlyRate");
    res.json(updatedUser);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
