const express = require("express");
const router = express.Router();
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");

const expertSelect = "-password -emailVerifyToken -resetPasswordToken -resetPasswordExpires";

const tokenize = (value = "") =>
  String(value)
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/i)
    .map((token) => token.trim())
    .filter(Boolean);

const unique = (items) => [...new Set(items.filter(Boolean))];

const scoreExpert = (expert, signals = {}) => {
  const desiredSkills = tokenize(signals.skills || signals.goal || "");
  const desiredCategory = String(signals.category || "").toLowerCase();
  const budget = Number(signals.budget || 0);
  const expertSkillTokens = (expert.skills || []).flatMap(tokenize);
  const expertText = tokenize(`${expert.title} ${expert.category} ${expert.bio} ${expert.experience}`);

  const skillMatches = desiredSkills.filter((skill) =>
    expertSkillTokens.includes(skill) || expertText.includes(skill)
  );

  let score = 20;
  score += skillMatches.length * 18;
  score += (expert.rating || 0) * 6;
  score += Math.min(expert.reviewsCount || 0, 20) * 1.5;
  score += (expert.followers?.length || 0) * 0.2;
  score += (expert.subscribers?.length || 0) * 0.3;
  if (expert.isAvailable) score += 12;
  if (expert.subscriptionPlan === "premium") score += 5;
  if (desiredCategory && String(expert.category || "").toLowerCase().includes(desiredCategory)) score += 20;
  if (budget > 0 && expert.hourlyRate > 0) {
    score += expert.hourlyRate <= budget ? 14 : -Math.min(18, (expert.hourlyRate - budget) / Math.max(budget, 1) * 20);
  }

  return {
    score: Math.max(0, Math.round(score)),
    matchedSkills: unique(skillMatches),
    reasons: unique([
      skillMatches.length ? `Matches ${skillMatches.length} requested skill(s)` : "",
      expert.isAvailable ? "Currently available for bookings" : "",
      desiredCategory && String(expert.category || "").toLowerCase().includes(desiredCategory) ? "Category fit" : "",
      budget > 0 && expert.hourlyRate <= budget ? "Within budget" : "",
      (expert.rating || 0) >= 4.5 ? "Strong rating" : "",
    ]),
  };
};

const getExperts = async () => User.find({ role: "expert" })
  .select(expertSelect)
  .sort({ rating: -1, reviewsCount: -1, createdAt: -1 });

router.get("/recommendations", async (req, res) => {
  try {
    const experts = await getExperts();
    const ranked = experts
      .map((expert) => {
        const match = scoreExpert(expert, req.query);
        return { expert, ...match };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    res.json({
      summary: ranked.length
        ? "Recommended experts ranked by skills, category, availability, rating, and budget fit."
        : "No experts are available yet.",
      recommendations: ranked,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/match", async (req, res) => {
  try {
    const experts = await getExperts();
    const ranked = experts
      .map((expert) => {
        const match = scoreExpert(expert, req.body);
        return { expert, ...match };
      })
      .filter((match) => match.score > 20)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    res.json({
      goal: req.body.goal || "Find the best expert",
      matches: ranked,
      advice: ranked.length
        ? "Start with the top match, then compare budget and availability before booking."
        : "Try adding skills, category, or budget so matching can narrow the expert list.",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/chat", async (req, res) => {
  const message = String(req.body.message || "").trim();
  if (!message) return res.status(400).json({ message: "Message is required" });

  const lower = message.toLowerCase();
  let reply = "I can help you find experts, improve your profile, compare plans, or prepare a booking brief. Tell me your goal, budget, and preferred skills.";
  const suggestions = ["Describe your project goal", "Mention your budget", "Add 2-4 required skills"];

  if (lower.includes("expert") || lower.includes("match") || lower.includes("recommend")) {
    reply = "For expert matching, share the work type, must-have skills, timeline, and budget. I will rank experts by fit, rating, availability, and rate.";
    suggestions.push("Use Smart Matching for ranked experts");
  } else if (lower.includes("bio") || lower.includes("profile")) {
    reply = "A strong bio should say who you help, your core skills, proof of experience, and what clients can book you for. Keep it specific and outcome-focused.";
    suggestions.push("Generate a polished bio");
  } else if (lower.includes("booking") || lower.includes("priority")) {
    reply = "For bookings, include the problem, expected outcome, tech stack, and any links. Premium users get priority queue treatment where enabled.";
    suggestions.push("Prepare notes before booking");
  } else if (lower.includes("live") || lower.includes("coins") || lower.includes("gift")) {
    reply = "Live sessions work best for demos, Q&A, portfolio reviews, and launches. Viewers can chat, send coin gifts, and the live room tracks active viewers.";
    suggestions.push("Open the Live Studio");
  }

  res.json({
    reply,
    suggestions: unique(suggestions),
  });
});

router.post("/bio", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("name title category skills experience bio");
    const payload = { ...user?.toObject(), ...req.body };
    const name = payload.name || "I";
    const title = payload.title || "Professional Consultant";
    const category = payload.category || "digital solutions";
    const skills = Array.isArray(payload.skills)
      ? payload.skills
      : String(payload.skills || "").split(",").map((skill) => skill.trim()).filter(Boolean);
    const skillText = skills.slice(0, 5).join(", ") || "strategy, execution, and problem solving";
    const experience = payload.experience || "hands-on industry experience";
    const tone = payload.tone || "professional";

    const bio = tone === "friendly"
      ? `${name} is a ${title} who helps clients turn ideas into reliable ${category} outcomes. With ${experience}, ${name} brings practical skill in ${skillText} and keeps every session clear, collaborative, and action-focused. Book a consultation to review your goals, solve blockers, and leave with a concrete next step.`
      : `${name} is a ${title} specializing in ${category}. With ${experience} and expertise across ${skillText}, ${name} helps clients diagnose problems, plan better systems, and execute with confidence. Available for focused consultations, technical reviews, and practical guidance tailored to your project goals.`;

    res.json({ bio });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
