const moment = require('moment-timezone');

const TIME_FORMATS = ['HH:mm', 'H:mm', 'hh:mm A', 'h:mm A'];
const DEFAULT_STEP_MINUTES = 5;
const DEFAULT_DURATION_MINUTES = 30;

const getExpertTimezone = (expert = {}) => {
  const timezone = expert.timezone || 'UTC';
  return moment.tz.zone(timezone) ? timezone : 'UTC';
};

const normalizeDurationMinutes = (value, fallback = DEFAULT_DURATION_MINUTES) => {
  const duration = Number(value);
  if (!Number.isInteger(duration) || duration < 1 || duration > 240) {
    return Number.isInteger(fallback) && fallback > 0 ? fallback : DEFAULT_DURATION_MINUTES;
  }
  return duration;
};

const parseTimeOnDate = (dateStr, timeValue, timezone) => {
  const rawTime = String(timeValue || '').trim().toUpperCase();
  return moment.tz(`${dateStr} ${rawTime}`, TIME_FORMATS.map((format) => `YYYY-MM-DD ${format}`), true, timezone);
};

const getAvailabilityWindowForDate = (expert, dateStr) => {
  const { availabilitySchedule } = expert || {};
  const schedule = Array.isArray(availabilitySchedule) ? availabilitySchedule : [];
  const timezone = getExpertTimezone(expert);
  const requestedDate = moment.tz(dateStr, 'YYYY-MM-DD', true, timezone);
  if (!requestedDate.isValid()) return null;

  const dayName = requestedDate.format('dddd');
  const dayEntry = schedule.find((day) => String(day.day || '').toLowerCase() === dayName.toLowerCase());
  if (!dayEntry || !dayEntry.available || !dayEntry.from || !dayEntry.to) return null;

  const start = parseTimeOnDate(dateStr, dayEntry.from, timezone);
  const end = parseTimeOnDate(dateStr, dayEntry.to, timezone);
  if (!start.isValid() || !end.isValid() || !end.isAfter(start)) return null;

  return {
    dayName,
    entry: dayEntry,
    timezone,
    start,
    end,
  };
};

/**
 * Generate time slots for a given expert on a specific date.
 * @param {Object} expert - Mongoose user document (must contain availabilitySchedule, timezone, slotDuration)
 * @param {String} dateStr - Date string in 'YYYY-MM-DD' format (in expert's local timezone)
 * @param {Object} options
 * @param {Number} options.durationMinutes - Desired consultation length.
 * @param {Number} options.stepMinutes - Minute increment between selectable start times.
 * @returns {Array} Array of slot objects { start: Date, end: Date, displayStart: String, displayEnd: String }
 */
function generateSlotsForDate(expert, dateStr, options = {}) {
  const window = getAvailabilityWindowForDate(expert, dateStr);
  if (!window) return [];

  const durationMinutes = normalizeDurationMinutes(options.durationMinutes || expert?.slotDuration, DEFAULT_DURATION_MINUTES);
  const stepMinutes = normalizeDurationMinutes(options.stepMinutes || DEFAULT_STEP_MINUTES, DEFAULT_STEP_MINUTES);

  const slots = [];
  let cursor = window.start.clone();
  while (cursor.clone().add(durationMinutes, 'minutes').isSameOrBefore(window.end)) {
    const slotStart = cursor.clone();
    const slotEnd = cursor.clone().add(durationMinutes, 'minutes');
    slots.push({
      start: slotStart.toDate(),            // stored in UTC
      end: slotEnd.toDate(),
      date: slotStart.format('YYYY-MM-DD'),
      startTime: slotStart.format('HH:mm'),
      endTime: slotEnd.format('HH:mm'),
      durationMinutes,
      displayStart: slotStart.format('hh:mm A'), // for UI in expert's local time
      displayEnd: slotEnd.format('hh:mm A')
    });
    cursor.add(stepMinutes, 'minutes');
  }
  return slots;
}

module.exports = {
  DEFAULT_STEP_MINUTES,
  getAvailabilityWindowForDate,
  getExpertTimezone,
  generateSlotsForDate,
  normalizeDurationMinutes,
  parseTimeOnDate,
};
