const crypto = require("crypto");
const path = require("path");

const UPLOADS_ROOT = path.resolve(__dirname, "..", "uploads");
const MEDIA_SECRET = process.env.MEDIA_SIGNING_SECRET || process.env.JWT_SECRET || "media-secret";

const normalizePrivateMediaPath = (value = "") => {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^(data:|blob:)/i.test(text)) return "";

  try {
    const backendUrl = process.env.BACKEND_PUBLIC_URL || "https://muskan-portfolio-backend.onrender.com";
    if (/^https?:\/\//i.test(text)) {
      const url = new URL(text);
      if (backendUrl && text.startsWith(backendUrl)) {
        const relative = text.slice(backendUrl.length);
        if (relative.startsWith("/uploads/")) return relative;
      }
      return "";
    }
  } catch {
    // Ignore invalid URLs and fall through to relative handling.
  }

  if (text.startsWith("/uploads/")) return text;
  if (text.startsWith("uploads/")) return `/${text}`;
  if (text.startsWith("/")) return text.startsWith("/uploads/") ? text : "";
  return "";
};

const signPayload = (mediaPath, expiresAt) =>
  crypto.createHmac("sha256", MEDIA_SECRET).update(`${mediaPath}:${expiresAt}`).digest("hex");

const createPrivateMediaUrl = (value, expiresInSeconds = 10 * 60) => {
  const mediaPath = normalizePrivateMediaPath(value);
  if (!mediaPath) return "";

  const safeTtl = Math.max(60, Math.min(Number(expiresInSeconds) || 600, 60 * 60));
  const expiresAt = Date.now() + safeTtl * 1000;
  const signature = signPayload(mediaPath, expiresAt);
  return `/api/media/private?path=${encodeURIComponent(mediaPath)}&exp=${expiresAt}&sig=${signature}`;
};

const verifyPrivateMediaRequest = (mediaPath, expiresAt, signature) => {
  const normalizedPath = normalizePrivateMediaPath(mediaPath);
  const parsedExpiry = Number(expiresAt);

  if (!normalizedPath || !parsedExpiry || Number.isNaN(parsedExpiry)) return false;
  if (Date.now() > parsedExpiry) return false;

  const expected = signPayload(normalizedPath, parsedExpiry);
  if (expected.length !== String(signature || "").length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature || "")));
};

const resolvePrivateMediaFilePath = (value) => {
  const mediaPath = normalizePrivateMediaPath(value);
  if (!mediaPath) return "";

  const absolutePath = path.resolve(path.join(__dirname, ".."), mediaPath.replace(/^\//, ""));
  const relative = path.relative(UPLOADS_ROOT, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return "";
  return absolutePath;
};

module.exports = {
  createPrivateMediaUrl,
  normalizePrivateMediaPath,
  resolvePrivateMediaFilePath,
  verifyPrivateMediaRequest,
};
