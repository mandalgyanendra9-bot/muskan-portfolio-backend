const moment = require("moment-timezone");
const { DEFAULT_TIMEZONE } = require("./slotGenerator");

const DEFAULT_BOOKING_TIMEZONE = DEFAULT_TIMEZONE || "Asia/Kolkata";
const TIME_FORMATS = ["HH:mm", "H:mm", "hh:mm A", "h:mm A"];

const normalizeBookingTimezone = (timezone) => {
  const cleanTimezone = String(timezone || "").trim();
  return moment.tz.zone(cleanTimezone) ? cleanTimezone : DEFAULT_BOOKING_TIMEZONE;
};

const toDateOrNull = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseLegacyDateTime = (dateValue, timeValue, timezone) => {
  if (!dateValue || !timeValue) return null;
  const resolvedTimezone = normalizeBookingTimezone(timezone);
  const dateText = String(dateValue).includes("T")
    ? moment(dateValue).tz(resolvedTimezone).format("YYYY-MM-DD")
    : String(dateValue).slice(0, 10);
  const rawTime = String(timeValue || "").trim().toUpperCase();
  const parsed = moment.tz(
    `${dateText} ${rawTime}`,
    TIME_FORMATS.map((format) => `YYYY-MM-DD ${format}`),
    true,
    resolvedTimezone
  );
  return parsed.isValid() ? parsed.toDate() : null;
};

const getCanonicalBookingTimes = (booking = {}) => {
  const source = booking?.toObject ? booking.toObject({ virtuals: false }) : booking;
  const timezone = normalizeBookingTimezone(source.timezone || source.expert?.timezone || source.client?.timezone);
  const startAt =
    toDateOrNull(source.startAt) ||
    toDateOrNull(source.slotStart) ||
    parseLegacyDateTime(source.date, source.startTime, timezone);
  let endAt =
    toDateOrNull(source.endAt) ||
    toDateOrNull(source.slotEnd) ||
    parseLegacyDateTime(source.date, source.endTime, timezone);

  const durationMinutes = Number(source.durationMinutes || source.duration || 0);
  if (!endAt && startAt && durationMinutes > 0) {
    endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);
  }

  return { startAt, endAt, timezone };
};

const applyCanonicalBookingTimes = (target, startMoment, endMoment, timezone) => {
  const resolvedTimezone = normalizeBookingTimezone(timezone);
  const localStart = startMoment.clone().tz(resolvedTimezone);
  const localEnd = endMoment.clone().tz(resolvedTimezone);

  target.startAt = startMoment.toDate();
  target.endAt = endMoment.toDate();
  target.timezone = resolvedTimezone;
  target.slotStart = startMoment.toDate();
  target.slotEnd = endMoment.toDate();
  target.date = localStart.format("YYYY-MM-DD");
  target.startTime = localStart.format("HH:mm");
  target.endTime = localEnd.format("HH:mm");

  return target;
};

const ensureBookingVideoCallUrl = (booking) => {
  if (!booking?._id) return "";
  const url = `/video-call/${booking._id.toString()}`;
  booking.meetingLink = url;
  booking.videoCallUrl = url;
  return url;
};

const formatBookingForResponse = (booking) => {
  if (!booking) return booking;
  const plain = booking?.toObject ? booking.toObject({ virtuals: true }) : { ...booking };
  const { startAt, endAt, timezone } = getCanonicalBookingTimes(plain);
  const videoCallUrl = plain.videoCallUrl || plain.meetingLink || (plain._id ? `/video-call/${plain._id}` : "");

  return {
    ...plain,
    startAt: startAt ? startAt.toISOString() : null,
    endAt: endAt ? endAt.toISOString() : null,
    slotStart: plain.slotStart || (startAt ? startAt.toISOString() : null),
    slotEnd: plain.slotEnd || (endAt ? endAt.toISOString() : null),
    timezone,
    videoCallUrl,
    meetingLink: plain.meetingLink || videoCallUrl,
  };
};

const formatBookingsForResponse = (bookings = []) => bookings.map(formatBookingForResponse);

module.exports = {
  DEFAULT_BOOKING_TIMEZONE,
  applyCanonicalBookingTimes,
  ensureBookingVideoCallUrl,
  formatBookingForResponse,
  formatBookingsForResponse,
  getCanonicalBookingTimes,
  normalizeBookingTimezone,
};
