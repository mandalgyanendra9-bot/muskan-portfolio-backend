const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const User = require('../models/User');
const Booking = require('../models/Booking');
const { DEFAULT_STEP_MINUTES, DEFAULT_TIMEZONE, generateSlotsForDate, getExpertTimezone } = require('../utils/slotGenerator');

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

const getExpertPerMinuteRate = (expert = {}) => {
  const perMinuteRate = Number(expert.perMinuteRate) > 0
    ? Number(expert.perMinuteRate)
    : Number(expert.pricePerMinute) > 0
      ? Number(expert.pricePerMinute)
      : Number(expert.hourlyRate || 0) / 60;
  return Math.round(perMinuteRate * 100) / 100;
};

const parseDurationQuery = (value, fallback) => {
  const duration = Number(value ?? fallback);
  if (!Number.isInteger(duration) || duration < 1 || duration > 240) return null;
  return duration;
};

// GET available slots for an expert on a given date
router.get('/:expertId', async (req, res) => {
  const { expertId } = req.params;
  const { date } = req.query; // expected format YYYY-MM-DD
  const requestedDuration = req.query.durationMinutes ?? req.query.duration;

  try {
    if (!date) return res.status(400).json({ success: false, message: 'date query param required' });
    if (!mongoose.Types.ObjectId.isValid(expertId)) {
      return res.status(400).json({ success: false, message: 'Invalid expert id' });
    }

    const expert = await User.findById(expertId).select('name role availabilitySchedule timezone slotDuration perMinuteRate pricePerMinute hourlyRate');
    if (!expert) return res.status(404).json({ success: false, message: 'Expert not found' });

    // Ensure the user is an expert
    if (expert.role !== 'expert') return res.status(400).json({ success: false, message: 'User is not an expert' });

    const timezone = getExpertTimezone(expert);
    const requestedDay = moment.tz(String(date), 'YYYY-MM-DD', true, timezone);
    if (!requestedDay.isValid()) {
      return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const nowInTimezone = moment().tz(timezone);
    const todayInTimezone = nowInTimezone.clone().startOf('day');
    const requestedDateOnly = requestedDay.clone().startOf('day');
    const isPastDate = requestedDateOnly.isBefore(todayInTimezone, 'day');
    const isToday = requestedDateOnly.isSame(todayInTimezone, 'day');
    const dayOfWeek = requestedDay.format('dddd');
    const dayEntry = getDayEntry(expert.availabilitySchedule, dayOfWeek);
    const durationMinutes = parseDurationQuery(requestedDuration, Number(expert.slotDuration) || 30);
    if (!durationMinutes) {
      return res.status(400).json({ success: false, message: 'Invalid duration selected.' });
    }
    const ratePerMinute = getExpertPerMinuteRate(expert);
    const baseLog = {
      expertId,
      date,
      dayOfWeek,
      timezone,
      durationMinutes,
      stepMinutes: DEFAULT_STEP_MINUTES,
      slotDuration: expert.slotDuration,
      requestedDate: requestedDay.format('YYYY-MM-DD'),
      todayInTimezone: todayInTimezone.format('YYYY-MM-DD'),
      currentTimeInTimezone: nowInTimezone.format('HH:mm:ss'),
      isPastDate,
      defaultTimezone: DEFAULT_TIMEZONE,
      availability: toSafeAvailabilityLog(expert.availabilitySchedule),
    };

    console.info(`${SLOT_LOG_PREFIX} request`, baseLog);

    if (isPastDate) {
      console.info(`${SLOT_LOG_PREFIX} result`, {
        expertId,
        requestedDate: requestedDay.format('YYYY-MM-DD'),
        todayInTimezone: todayInTimezone.format('YYYY-MM-DD'),
        currentTimeInTimezone: nowInTimezone.format('HH:mm:ss'),
        isPastDate,
        slotsBeforeFiltering: 0,
        slotsAfterTodayFiltering: 0,
        reason: 'past_date',
      });
      return res.json({ success: true, slots: [], message: 'No slots available for past dates' });
    }

    if (!dayEntry || !dayEntry.available) {
      console.info(`${SLOT_LOG_PREFIX} result`, {
        expertId,
        requestedDate: requestedDay.format('YYYY-MM-DD'),
        todayInTimezone: todayInTimezone.format('YYYY-MM-DD'),
        currentTimeInTimezone: nowInTimezone.format('HH:mm:ss'),
        isPastDate,
        slotsBeforeFiltering: 0,
        slotsAfterTodayFiltering: 0,
        reason: 'unavailable_day',
      });
      return res.json({ success: true, slots: [] });
    }

    const allSlots = generateSlotsForDate(expert, date, {
      durationMinutes,
      stepMinutes: DEFAULT_STEP_MINUTES,
    });

    // Define date range for the requested day
    const dayStart = requestedDay.clone().startOf('day').toDate();
    const dayEnd = requestedDay.clone().endOf('day').toDate();

    // Find bookings for this expert on the requested day
    const existing = await Booking.find({
      $or: [{ expert: expertId }, { expertId }],
      status: { $ne: "cancelled" },
      paymentStatus: { $nin: ["failed", "cancelled", "refunded"] },
      slotStart: { $lt: dayEnd },
      slotEnd: { $gt: dayStart },
    }).select('slotStart slotEnd');

    const booked = existing.map((booking) => ({
      start: booking.slotStart.getTime(),
      end: booking.slotEnd.getTime(),
    }));
    const nowMs = nowInTimezone.valueOf();
    const slotsAfterTodayFiltering = isToday
      ? allSlots.filter((slot) => moment(slot.start).tz(timezone).valueOf() > nowMs)
      : allSlots;

    const available = slotsAfterTodayFiltering.filter(s => {
      const slotStart = new Date(s.start);
      const slotEnd = new Date(s.end);
      const isBooked = booked.some((booking) => slotStart.getTime() < booking.end && slotEnd.getTime() > booking.start);
      return !isBooked;
    }).map((slot) => ({
      ...slot,
      timezone,
      ratePerMinute,
      totalAmount: Math.round(ratePerMinute * durationMinutes * 100) / 100,
    }));

    console.info(`${SLOT_LOG_PREFIX} result`, {
      expertId,
      requestedDate: requestedDay.format('YYYY-MM-DD'),
      todayInTimezone: todayInTimezone.format('YYYY-MM-DD'),
      currentTimeInTimezone: nowInTimezone.format('HH:mm:ss'),
      isPastDate,
      dayOfWeek,
      generatedSlotsCount: allSlots.length,
      availableSlotsCount: available.length,
      bookedSlotsCount: existing.length,
      slotsBeforeFiltering: allSlots.length,
      slotsAfterTodayFiltering: slotsAfterTodayFiltering.length,
    });

    res.json({
      success: true,
      slots: available,
      durationMinutes,
      ratePerMinute,
      timezone,
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
