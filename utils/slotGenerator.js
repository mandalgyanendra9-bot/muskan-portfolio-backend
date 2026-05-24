const moment = require('moment-timezone');
/**
 * Generate time slots for a given expert on a specific date.
 * @param {Object} expert - Mongoose user document (must contain availabilitySchedule, timezone, slotDuration)
 * @param {String} dateStr - Date string in 'YYYY-MM-DD' format (in expert's local timezone)
 * @returns {Array} Array of slot objects { start: Date, end: Date, displayStart: String, displayEnd: String }
 */
function generateSlotsForDate(expert, dateStr) {
  const { availabilitySchedule, timezone = 'UTC', slotDuration = 30 } = expert;
  // Find the day of week name, e.g., 'Monday'
  const dayName = moment.tz(dateStr, timezone).format('dddd');
  const dayEntry = availabilitySchedule.find(d => d.day === dayName);
  if (!dayEntry) return [];

  // Build start and end moment objects in expert's timezone
  const dayStart = moment.tz(`${dateStr} ${dayEntry.from}`, 'YYYY-MM-DD HH:mm', timezone);
  const dayEnd = moment.tz(`${dateStr} ${dayEntry.to}`, 'YYYY-MM-DD HH:mm', timezone);

  const slots = [];
  let cursor = dayStart.clone();
  while (cursor.clone().add(slotDuration, 'minutes').isSameOrBefore(dayEnd)) {
    const slotStart = cursor.clone();
    const slotEnd = cursor.clone().add(slotDuration, 'minutes');
    slots.push({
      start: slotStart.toDate(),            // stored in UTC
      end: slotEnd.toDate(),
      displayStart: slotStart.format('hh:mm A'), // for UI in expert's local time
      displayEnd: slotEnd.format('hh:mm A')
    });
    cursor.add(slotDuration, 'minutes');
  }
  return slots;
}
module.exports = { generateSlotsForDate };
