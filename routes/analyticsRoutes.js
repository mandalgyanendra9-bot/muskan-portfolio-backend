const express = require("express");
const router = express.Router();
const Visitor = require("../models/Visitor");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");

// TRACK VISITOR
router.post("/hit", async (req, res) => {
  try {
    let visitor = await Visitor.findOne();
    if (!visitor) {
      visitor = await Visitor.create({ count: 1 });
    } else {
      visitor.count += 1;
      visitor.lastVisit = Date.now();
      await visitor.save();
    }
    res.json({ count: visitor.count });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET STATS (Admin only)
router.get("/stats", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const visitor = await Visitor.findOne();
    res.json({ count: visitor ? visitor.count : 0 });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
