const express = require('express');
const router = express.Router();
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');
const roleCheck = require('../middleware/roleCheck');

const normalizeClockTime = (value) => {
  const text = String(value || "").trim().toUpperCase();
  const directMatch = text.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (directMatch) return `${String(Number(directMatch[1])).padStart(2, "0")}:${directMatch[2]}`;

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

// GET current expert's availability (expert only)
router.get('/my', authMiddleware, roleCheck(['expert']), async (req, res) => {
  try {
    const expert = await User.findById(req.user.id).select('availabilitySchedule timezone slotDuration perMinuteRate pricePerMinute');
    if (!expert) return res.status(404).json({ message: 'Expert not found' });
    res.json({
      availabilitySchedule: expert.availabilitySchedule,
      timezone: expert.timezone,
      slotDuration: expert.slotDuration,
      perMinuteRate: expert.perMinuteRate || expert.pricePerMinute || 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// UPDATE availability schedule (expert only)
router.put('/my', authMiddleware, roleCheck(['expert']), async (req, res) => {
  const { availabilitySchedule, timezone, slotDuration, perMinuteRate, pricePerMinute } = req.body;
  try {
    const minuteRate = perMinuteRate !== undefined ? Number(perMinuteRate) : pricePerMinute !== undefined ? Number(pricePerMinute) : undefined;
    const updateData = {};
    if (availabilitySchedule !== undefined) {
      const parsedSchedule = typeof availabilitySchedule === "string" ? JSON.parse(availabilitySchedule) : availabilitySchedule;
      const validationMessage = validateAvailabilitySchedule(parsedSchedule);
      if (validationMessage) return res.status(400).json({ message: validationMessage });
      updateData.availabilitySchedule = normalizeAvailabilitySchedule(parsedSchedule);
    }
    if (timezone !== undefined) updateData.timezone = timezone;
    if (slotDuration !== undefined) updateData.slotDuration = slotDuration;
    if (minuteRate !== undefined) {
      if (!Number.isFinite(minuteRate) || minuteRate < 0) {
        return res.status(400).json({ message: 'Per-minute rate must be a valid positive amount' });
      }
      updateData.perMinuteRate = minuteRate;
      updateData.pricePerMinute = minuteRate;
    }
    const expert = await User.findByIdAndUpdate(
      req.user.id,
      updateData,
      { new: true, runValidators: true, select: 'availabilitySchedule timezone slotDuration perMinuteRate pricePerMinute' }
    );
    res.json({
      availabilitySchedule: expert.availabilitySchedule,
      timezone: expert.timezone,
      slotDuration: expert.slotDuration,
      perMinuteRate: expert.perMinuteRate || expert.pricePerMinute || 0,
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
