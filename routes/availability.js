const express = require('express');
const router = express.Router();
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');
const roleCheck = require('../middleware/roleCheck');

// GET current expert's availability (expert only)
router.get('/my', authMiddleware, roleCheck(['expert']), async (req, res) => {
  try {
    const expert = await User.findById(req.user.id).select('availabilitySchedule timezone slotDuration');
    if (!expert) return res.status(404).json({ message: 'Expert not found' });
    res.json({ availabilitySchedule: expert.availabilitySchedule, timezone: expert.timezone, slotDuration: expert.slotDuration });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// UPDATE availability schedule (expert only)
router.put('/my', authMiddleware, roleCheck(['expert']), async (req, res) => {
  const { availabilitySchedule, timezone, slotDuration } = req.body;
  try {
    const expert = await User.findByIdAndUpdate(
      req.user.id,
      { availabilitySchedule, timezone, slotDuration },
      { new: true, runValidators: true, select: 'availabilitySchedule timezone slotDuration' }
    );
    res.json({ availabilitySchedule: expert.availabilitySchedule, timezone: expert.timezone, slotDuration: expert.slotDuration });
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
