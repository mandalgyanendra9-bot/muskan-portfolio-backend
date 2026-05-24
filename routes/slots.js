const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Booking = require('../models/Booking');
const authMiddleware = require('../middleware/authMiddleware');
const roleCheck = require('../middleware/roleCheck');
const { generateSlotsForDate } = require('../utils/slotGenerator');

// GET available slots for an expert on a given date
router.get('/:expertId', authMiddleware, async (req, res) => {
  try {
    const { expertId } = req.params;
    const { date } = req.query; // expected format YYYY-MM-DD
    if (!date) return res.status(400).json({ message: 'date query param required' });
    const expert = await User.findById(expertId);
    if (!expert) return res.status(404).json({ message: 'Expert not found' });
    // Ensure the user is an expert
    if (expert.role !== 'expert') return res.status(400).json({ message: 'User is not an expert' });
    const allSlots = generateSlotsForDate(expert, date);
    // Define date range for the requested day
    const dayStart = new Date(date);
    const dayEnd = new Date(date);
    dayEnd.setDate(dayEnd.getDate() + 1);
    // Find bookings for this expert on the requested day
    const existing = await Booking.find({
      expert: expertId,
      slotStart: { $gte: dayStart, $lt: dayEnd }
    }).select('slotStart slotEnd');
    const booked = existing.map(b => b.slotStart.getTime());
    const available = allSlots.filter(s => {
      const slotStart = new Date(s.start);
      const isBooked = booked.includes(slotStart.getTime());
      return !isBooked && slotStart > new Date();
    });
    res.json(available);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
