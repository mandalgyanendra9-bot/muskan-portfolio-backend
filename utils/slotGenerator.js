const moment = require('moment-timezone');
/**
 * Generate time slots for a given expert on a specific date.
 * @param {Object} expert - Mongoose user document (must contain availabilitySchedule, timezone, slotDuration)
 * @param {String} dateStr - Date string in 'YYYY-MM-DD' format (in expert's local timezone)
 * @returns {Array} Array of slot objects { start: Date, end: Date, displayStart: String, displayEnd: String }
 */
function generateSlotsForDate(expert, dateStr) {
  const { availabilitySchedule, timezone = 'UTC', slotDuration = 30 } = expert;
  const schedule = Array.isArray(availabilitySchedule) ? availabilitySchedule : [];
  const resolvedTimezone = moment.tz.zone(timezone) ? timezone : 'UTC';
  const durationMinutes = Number(slotDuration) > 0 ? Number(slotDuration) : 30;
  const requestedDate = moment.tz(dateStr, 'YYYY-MM-DD', true, resolvedTimezone);
  if (!requestedDate.isValid()) return [];

  // Find the day of week name, e.g., 'Monday'
  const dayName = requestedDate.format('dddd');
  const dayEntry = schedule.find(d => String(d.day || '').toLowerCase() === dayName.toLowerCase());
  if (!dayEntry) return [];
  if (!dayEntry.available) return [];
  if (!dayEntry.from || !dayEntry.to) return [];

  // Build start and end moment objects in expert's timezone
  const dayStart = moment.tz(`${dateStr} ${dayEntry.from}`, 'YYYY-MM-DD HH:mm', true, resolvedTimezone);
  const dayEnd = moment.tz(`${dateStr} ${dayEntry.to}`, 'YYYY-MM-DD HH:mm', true, resolvedTimezone);
  if (!dayStart.isValid() || !dayEnd.isValid() || !dayEnd.isAfter(dayStart)) return [];

  const slots = [];
  let cursor = dayStart.clone();
  while (cursor.clone().add(durationMinutes, 'minutes').isSameOrBefore(dayEnd)) {
    const slotStart = cursor.clone();
    const slotEnd = cursor.clone().add(durationMinutes, 'minutes');
    slots.push({
      start: slotStart.toDate(),            // stored in UTC
      end: slotEnd.toDate(),
      displayStart: slotStart.format('hh:mm A'), // for UI in expert's local time
      displayEnd: slotEnd.format('hh:mm A')
    });
    cursor.add(durationMinutes, 'minutes');
  }
  return slots;
}
module.exports = { generateSlotsForDate };
