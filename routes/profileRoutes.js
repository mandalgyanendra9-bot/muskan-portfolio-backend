const express = require("express");
const router = express.Router();
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/Upload");
const { serializeUser } = require("../utils/userResponse");
const { uploadProfilePhoto, setProfilePhotoFields } = require("../utils/profilePhoto");

const safeProfileSelect = "-password -emailVerifyToken -resetPasswordToken -resetPasswordExpires";

const getPublicExpertRate = (expert = {}) => {
  const rate = Number(expert.perMinuteRate) > 0
    ? Number(expert.perMinuteRate)
    : Number(expert.pricePerMinute) > 0
      ? Number(expert.pricePerMinute)
      : Number(expert.hourlyRate || 0) / 60;
  return Math.round(rate * 100) / 100;
};

const isPublicExpertVisible = (expert = {}) => (
  expert.role === "expert" &&
  expert.isAvailable &&
  expert.isApproved &&
  !expert.isBlocked &&
  String(expert.name || "").trim().toLowerCase() !== "codex test expert" &&
  getPublicExpertRate(expert) > 0
);

const normalizeClockTime = (value) => {
  const text = String(value || "").trim().toUpperCase();
  const directMatch = text.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (directMatch) {
    return `${String(Number(directMatch[1])).padStart(2, "0")}:${directMatch[2]}`;
  }

  const amPmMatch = text.match(/^(0?[1-9]|1[0-2]):([0-5]\d)\s*(AM|PM)$/);
  if (!amPmMatch) return value;
  let hour = Number(amPmMatch[1]);
  if (amPmMatch[3] === "AM" && hour === 12) hour = 0;
  if (amPmMatch[3] === "PM" && hour !== 12) hour += 12;
  return `${String(hour).padStart(2, "0")}:${amPmMatch[2]}`;
};

const minutesFromClock = (value) => {
  const normalized = normalizeClockTime(value);
  const match = String(normalized || "").match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

const normalizeAvailabilitySchedule = (schedule = []) =>
  (Array.isArray(schedule) ? schedule : []).map((day) => ({
    ...day,
    from: normalizeClockTime(day.from),
    to: normalizeClockTime(day.to),
    available: Boolean(day.available),
  }));

const validateAvailabilitySchedule = (schedule = []) => {
  if (!Array.isArray(schedule)) return "Availability schedule must be a list";
  for (const day of schedule) {
    if (!day?.available) continue;
    const fromMinutes = minutesFromClock(day.from);
    const toMinutes = minutesFromClock(day.to);
    if (fromMinutes === null || toMinutes === null) {
      return `${day.day || "Selected day"} availability must use a valid time`;
    }
    if (toMinutes <= fromMinutes) {
      return `${day.day || "Selected day"} availability end time must be after start time`;
    }
  }
  return null;
};

// ─── GET ALL EXPERTS (public) ─────────────────────────────────────────────────
router.get("/experts", async (req, res) => {
  try {
    const experts = await User.find({
      role: "expert",
      isAvailable: true,
      isApproved: true,
      isBlocked: { $ne: true },
      name: { $ne: "Codex Test Expert" },
      $or: [
        { perMinuteRate: { $gt: 0 } },
        { pricePerMinute: { $gt: 0 } },
        { hourlyRate: { $gt: 0 } },
      ],
    })
      .select("-password -emailVerifyToken -resetPasswordToken -resetPasswordExpires")
      .sort({ createdAt: -1 });
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
      .populate("favorites", "name email profileImage title hourlyRate perMinuteRate pricePerMinute");
    res.json(serializeUser(user, req));
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
    if (!isPublicExpertVisible(expert)) {
      return res.status(404).json({ message: "Expert not found" });
    }
    res.json(serializeUser(expert, req));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ─── UPDATE PROFILE (text fields + optional DP) ──────────────────────────────
router.put("/update", authMiddleware, upload.single("profileImage"), async (req, res) => {
    console.log('Update payload:', req.body);
    if (req.file) console.log('Uploaded file:', req.file);
try {

    const {
      name, title, category, department, designation, qualification, bio, skills, researchInterests,
      googleScholarId, orcidId, scopusId, hourlyRate, perMinuteRate, pricePerMinute,
      location, role, experience, github, linkedin, portfolio,
      isAvailable, introVideo, exclusiveContent, availabilitySchedule,
      publicationsCount, projectsCount, patentsCount,
    } = req.body;

    const requestedRole = role ? String(role).trim().toLowerCase() : undefined;
    if (requestedRole && !["client", "expert"].includes(requestedRole)) {
      return res.status(400).json({ message: "Invalid account role." });
    }

    const updateData = {
      name, title, category, department, designation, qualification, bio, location, experience,
      github, linkedin, portfolio, introVideo, exclusiveContent,
      isAvailable: isAvailable === "true" || isAvailable === true,
      googleScholarId, orcidId, scopusId,
    };

    // Preserve existing role unless a valid new role is explicitly provided and differs from current
    if (requestedRole && requestedRole !== req.authUser?.role) {
      updateData.role = requestedRole;
    }

    if (hourlyRate !== undefined) updateData.hourlyRate = Number(hourlyRate);
    const minuteRate = perMinuteRate !== undefined ? Number(perMinuteRate) : pricePerMinute !== undefined ? Number(pricePerMinute) : undefined;
    if (minuteRate !== undefined) {
      if (!Number.isFinite(minuteRate) || minuteRate < 0) {
        return res.status(400).json({ message: "Per-minute rate must be a valid positive amount" });
      }
      updateData.perMinuteRate = minuteRate;
      updateData.pricePerMinute = minuteRate;
    }

    if (skills) {
      updateData.skills = Array.isArray(skills)
        ? skills
        : skills.split(",").map(s => s.trim()).filter(Boolean);
    }

    if (researchInterests) {
      updateData.researchInterests = Array.isArray(researchInterests)
        ? researchInterests
        : String(researchInterests).split(",").map((item) => item.trim()).filter(Boolean);
    }

    if (availabilitySchedule) {
      try {
        updateData.availabilitySchedule = typeof availabilitySchedule === "string"
          ? JSON.parse(availabilitySchedule)
          : availabilitySchedule;
        const validationMessage = validateAvailabilitySchedule(updateData.availabilitySchedule);
        if (validationMessage) return res.status(400).json({ message: validationMessage });
        updateData.availabilitySchedule = normalizeAvailabilitySchedule(updateData.availabilitySchedule);
      } catch { /* ignore parse errors */ }
    }

    if (req.file) {
      const profilePhotoUrl = await uploadProfilePhoto(req.file);
      setProfilePhotoFields(updateData, profilePhotoUrl);
    }

    if (name && title && bio) updateData.isProfileComplete = true;
    if (publicationsCount !== undefined) updateData.publicationsCount = Number(publicationsCount) || 0;
    if (projectsCount !== undefined) updateData.projectsCount = Number(projectsCount) || 0;
    if (patentsCount !== undefined) updateData.patentsCount = Number(patentsCount) || 0;

    const user = await User.findByIdAndUpdate(req.user.id, updateData, { new: true })
      .select("-password -emailVerifyToken -resetPasswordToken -resetPasswordExpires")
      .populate("favorites", "name email profileImage title hourlyRate perMinuteRate pricePerMinute");

    res.json(serializeUser(user, req));
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
      .populate("favorites", "name email profileImage title hourlyRate perMinuteRate pricePerMinute");
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
