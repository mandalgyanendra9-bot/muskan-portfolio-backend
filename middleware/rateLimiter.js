const buckets = new Map();

const rateLimit = ({ windowMs = 60_000, max = 60, keyPrefix = "global" } = {}) => {
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || req.socket.remoteAddress || "unknown";
    const key = `${keyPrefix}:${ip}`;
    const current = buckets.get(key) || { count: 0, resetAt: now + windowMs };

    if (current.resetAt <= now) {
      current.count = 0;
      current.resetAt = now + windowMs;
    }

    current.count += 1;
    buckets.set(key, current);

    res.setHeader("X-RateLimit-Limit", max);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, max - current.count));
    res.setHeader("X-RateLimit-Reset", Math.ceil(current.resetAt / 1000));

    if (current.count > max) {
      return res.status(429).json({
        message: "Too many requests. Please slow down and try again shortly.",
      });
    }

    next();
  };
};

setInterval(() => {
  const now = Date.now();
  buckets.forEach((value, key) => {
    if (value.resetAt <= now) buckets.delete(key);
  });
}, 5 * 60_000).unref();

module.exports = rateLimit;
