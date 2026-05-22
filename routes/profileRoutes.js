const express = require("express");
const router = express.Router();
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/Upload");

const safeProfileSelect = "-password -emailVerifyToken -resetPasswordToken -resetPasswordExpires";

// ─── GET ALL EXPERTS (public) ─────────────────────────────────────────────────
router.get("/experts", async (req, res) => {
  try {
    let experts = await User.find({ role: "expert", isAvailable: true, isApproved: true })
      .select("-password -emailVerifyToken -resetPasswordToken -resetPasswordExpires")
      .sort({ createdAt: -1 });

    if (experts.length === 0) {
      experts = await User.find({ role: "expert" })
        .select("-password -emailVerifyToken -resetPasswordToken -resetPasswordExpires")
        .sort({ createdAt: -1 });
    }
    res.json(experts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ─── GET CURRENT USER PROFILE ────────────────────────────────────────────────
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select("-password -emailVerifyToken -resetPasswordToken -resetPasswordExpires")
      .populate("favorites", "name email profileImage title hourlyRate");
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ─── GET SINGLE EXPERT DETAILS ───────────────────────────────────────────────
router.get("/expert/:id", async (req, res) => {
  try {
    const expert = await User.findById(req.params.id)
      .select("-password -emailVerifyToken -resetPasswordToken -resetPasswordExpires");
    if (!expert) return res.status(404).json({ message: "Expert not found" });
    res.json(expert);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ─── UPDATE PROFILE (text fields + optional DP) ──────────────────────────────
router.put("/update", authMiddleware, upload.single("profileImage"), async (req, res) => {
  try {
    const {
      name, title, category, bio, skills, hourlyRate, pricePerMinute,
      location, role, experience, github, linkedin, portfolio,
      isAvailable, introVideo, exclusiveContent, availabilitySchedule,
    } = req.body;

    const updateData = {
      name, title, category, bio, location, role, experience,
      github, linkedin, portfolio, introVideo, exclusiveContent,
      isAvailable: isAvailable === "true" || isAvailable === true,
    };

    if (hourlyRate !== undefined) updateData.hourlyRate = Number(hourlyRate);
    if (pricePerMinute !== undefined) updateData.pricePerMinute = Number(pricePerMinute);

    if (skills) {
      updateData.skills = Array.isArray(skills)
        ? skills
        : skills.split(",").map(s => s.trim()).filter(Boolean);
    }

    if (availabilitySchedule) {
      try {
        updateData.availabilitySchedule = typeof availabilitySchedule === "string"
          ? JSON.parse(availabilitySchedule)
          : availabilitySchedule;
      } catch { /* ignore parse errors */ }
    }

    if (req.file) updateData.profileImage = `/uploads/${req.file.filename}`;

    if (name && title && bio) updateData.isProfileComplete = true;

    const user = await User.findByIdAndUpdate(req.user.id, updateData, { new: true })
      .select("-password -emailVerifyToken -resetPasswordToken -resetPasswordExpires")
      .populate("favorites", "name email profileImage title hourlyRate");

    res.json(user);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ─── UPLOAD PORTFOLIO GALLERY IMAGES ─────────────────────────────────────────
router.post("/gallery", authMiddleware, upload.array("images", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "No images provided" });
    }

    const newPaths = req.files.map(f => `/uploads/${f.filename}`);

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $push: { portfolioGallery: { $each: newPaths } } },
      { new: true }
    ).select("portfolioGallery");

    res.json({ message: "Gallery updated", portfolioGallery: user.portfolioGallery });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ─── DELETE A GALLERY IMAGE ───────────────────────────────────────────────────
router.delete("/gallery/:index", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const idx = parseInt(req.params.index, 10);
    if (isNaN(idx) || idx < 0 || idx >= user.portfolioGallery.length) {
      return res.status(400).json({ message: "Invalid gallery index" });
    }

    user.portfolioGallery.splice(idx, 1);
    await user.save();

    res.json({ message: "Image removed", portfolioGallery: user.portfolioGallery });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ─── TOGGLE FAVORITE EXPERT ───────────────────────────────────────────────────
router.post("/favorite/:expertId", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const expertId = req.params.expertId;
    const index = user.favorites.indexOf(expertId);
    if (index > -1) user.favorites.splice(index, 1);
    else user.favorites.push(expertId);

    await user.save();
    const updatedUser = await User.findById(req.user.id)
      .select("-password")
      .populate("favorites", "name email profileImage title hourlyRate");
    res.json(updatedUser);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/follow/:expertId", authMiddleware, async (req, res) => {
  try {
    const expert = await User.findById(req.params.expertId);
    if (!expert) return res.status(404).json({ message: "Expert not found" });
    if (expert._id.toString() === req.user.id) {
      return res.status(400).json({ message: "You cannot follow your own profile" });
    }

    const isFollowing = expert.followers.some(id => id.toString() === req.user.id);
    if (isFollowing) expert.followers.pull(req.user.id);
    else expert.followers.addToSet(req.user.id);

    await expert.save();
    const updatedExpert = await User.findById(expert._id).select(safeProfileSelect);
    res.json({
      message: isFollowing ? "Unfollowed expert" : "Following expert",
      expert: updatedExpert,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/subscribe/:expertId", authMiddleware, async (req, res) => {
  try {
    const expert = await User.findById(req.params.expertId);
    if (!expert) return res.status(404).json({ message: "Expert not found" });
    if (expert._id.toString() === req.user.id) {
      return res.status(400).json({ message: "You cannot subscribe to your own profile" });
    }

    const isSubscribed = expert.subscribers.some(id => id.toString() === req.user.id);
    if (isSubscribed) {
      expert.subscribers.pull(req.user.id);
    } else {
      expert.subscribers.addToSet(req.user.id);
      expert.followers.addToSet(req.user.id);
    }

    await expert.save();
    const updatedExpert = await User.findById(expert._id).select(safeProfileSelect);
    res.json({
      message: isSubscribed ? "Subscription removed" : "Subscribed to exclusive content",
      expert: updatedExpert,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
