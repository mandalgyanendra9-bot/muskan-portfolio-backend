const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const User = require('../models/User');
const Booking = require('../models/Booking');
const { generateSlotsForDate } = require('../utils/slotGenerator');

const SLOT_LOG_PREFIX = '[Slots]';

const toSafeAvailabilityLog = (availabilitySchedule = []) =>
  (Array.isArray(availabilitySchedule) ? availabilitySchedule : []).map((entry) => ({
    day: entry.day,
    from: entry.from,
    to: entry.to,
    available: Boolean(entry.available),
  }));

const getDayEntry = (availabilitySchedule = [], dayOfWeek = '') =>
  (Array.isArray(availabilitySchedule) ? availabilitySchedule : []).find(
    (entry) => String(entry.day || '').toLowerCase() === String(dayOfWeek || '').toLowerCase()
  );

// GET available slots for an expert on a given date
router.get('/:expertId', async (req, res) => {
  const { expertId } = req.params;
  const { date } = req.query; // expected format YYYY-MM-DD

  try {
    if (!date) return res.status(400).json({ success: false, message: 'date query param required' });
    if (!mongoose.Types.ObjectId.isValid(expertId)) {
      return res.status(400).json({ success: false, message: 'Invalid expert id' });
    }

    const expert = await User.findById(expertId).select('name role availabilitySchedule timezone slotDuration');
    if (!expert) return res.status(404).json({ success: false, message: 'Expert not found' });

    // Ensure the user is an expert
    if (expert.role !== 'expert') return res.status(400).json({ success: false, message: 'User is not an expert' });

    const timezone = moment.tz.zone(expert.timezone) ? expert.timezone : 'UTC';
    const requestedDay = moment.tz(String(date), 'YYYY-MM-DD', true, timezone);
    if (!requestedDay.isValid()) {
      return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const dayOfWeek = requestedDay.format('dddd');
    const dayEntry = getDayEntry(expert.availabilitySchedule, dayOfWeek);
    const baseLog = {
      expertId,
      date,
      dayOfWeek,
      timezone,
      slotDuration: expert.slotDuration,
      availability: toSafeAvailabilityLog(expert.availabilitySchedule),
    };

    console.info(`${SLOT_LOG_PREFIX} request`, baseLog);

    if (requestedDay.clone().startOf('day').isBefore(moment.tz(timezone).startOf('day'))) {
      console.info(`${SLOT_LOG_PREFIX} result`, { expertId, date, dayOfWeek, generatedSlotsCount: 0, reason: 'past_date' });
      return res.json({ success: true, slots: [], message: 'No slots available for past dates' });
    }

    if (!dayEntry || !dayEntry.available) {
      console.info(`${SLOT_LOG_PREFIX} result`, { expertId, date, dayOfWeek, generatedSlotsCount: 0, reason: 'unavailable_day' });
      return res.json({ success: true, slots: [] });
    }

    const allSlots = generateSlotsForDate(expert, date);

    // Define date range for the requested day
    const dayStart = requestedDay.clone().startOf('day').toDate();
    const dayEnd = requestedDay.clone().endOf('day').toDate();

    // Find bookings for this expert on the requested day
    const existing = await Booking.find({
      expert: expertId,
      status: { $ne: "cancelled" },
      slotStart: { $lt: dayEnd },
      slotEnd: { $gt: dayStart },
    }).select('slotStart slotEnd');

    const booked = existing.map((booking) => ({
      start: booking.slotStart.getTime(),
      end: booking.slotEnd.getTime(),
    }));
    const now = Date.now();
    const available = allSlots.filter(s => {
      const slotStart = new Date(s.start);
      const slotEnd = new Date(s.end);
      const isBooked = booked.some((booking) => slotStart.getTime() < booking.end && slotEnd.getTime() > booking.start);
      return !isBooked && slotStart.getTime() > now;
    });
    const allGeneratedSlotsElapsed = allSlots.length > 0 && allSlots.every((slot) => new Date(slot.start).getTime() <= now);

    console.info(`${SLOT_LOG_PREFIX} result`, {
      expertId,
      date,
      dayOfWeek,
      generatedSlotsCount: allSlots.length,
      availableSlotsCount: available.length,
      bookedSlotsCount: existing.length,
    });

    res.json({
      success: true,
      slots: available,
      ...(allGeneratedSlotsElapsed ? { message: 'No slots available for past dates' } : {}),
    });
  } catch (err) {
    console.error(`${SLOT_LOG_PREFIX} error`, {
      expertId,
      date,
      message: err.message,
      stack: err.stack,
    });
    res.status(500).json({ success: false, message: 'Unable to fetch available slots.' });
  }
});

module.exports = router;
