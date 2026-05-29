const fs = require("fs/promises");
const cloudinary = require("cloudinary").v2;
const { isAdminEmail } = require("./adminAccess");

const DEFAULT_BACKEND_URL = (process.env.BACKEND_PUBLIC_URL || "https://muskan-portfolio-backend.onrender.com").replace(/\/+$/, "");
const CLOUDINARY_READY =
  Boolean(process.env.CLOUDINARY_CLOUD_NAME) &&
  Boolean(process.env.CLOUDINARY_API_KEY) &&
  Boolean(process.env.CLOUDINARY_API_SECRET);

let cloudinaryConfigured = false;

const ensureCloudinaryConfig = () => {
  if (!CLOUDINARY_READY) return false;
  if (cloudinaryConfigured) return true;

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });

  cloudinaryConfigured = true;
  return true;
};

const getProfilePhotoCandidate = (user = {}) => {
  if (typeof user === "string") return user;

  return (
    user?.profilePhotoUrl ||
    user?.profileImage ||
    user?.profilePhoto ||
    user?.photoUrl ||
    user?.avatar ||
    user?.googlePhoto ||
    user?.image ||
    ""
  );
};

const resolveProfilePhotoUrl = (value) => {
  const candidate = getProfilePhotoCandidate(value);
  if (!candidate) return "";

  const text = String(candidate).trim();
  if (!text) return "";

  if (/^(https?:|data:|blob:)/i.test(text)) return text;
  if (text.startsWith("/uploads")) return `${DEFAULT_BACKEND_URL}${text}`;
  if (text.startsWith("/")) return `${DEFAULT_BACKEND_URL}${text}`;

  return `${DEFAULT_BACKEND_URL}/${text}`;
};

const setProfilePhotoFields = (target = {}, value = "") => {
  const normalized = String(value || "").trim();

  target.profilePhotoUrl = normalized;
  target.profileImage = normalized;
  target.profilePhoto = normalized;
  target.photoUrl = normalized;
  target.avatar = normalized;
  target.googlePhoto = normalized;
  target.image = normalized;

  return target;
};

const uploadProfilePhoto = async (file) => {
  if (!file) return "";

  if (CLOUDINARY_READY) {
    ensureCloudinaryConfig();
    try {
      const result = await cloudinary.uploader.upload(file.path, {
        folder: "muskan-portfolio/profile-photos",
        resource_type: "image",
        overwrite: true,
      });
      return result.secure_url || result.url || "";
    } finally {
      await fs.unlink(file.path).catch(() => {});
    }
  }

  return `/uploads/${file.filename}`;
};

const getRoleLabel = (user) => {
  const role = String(user?.role || "").toLowerCase();
  if (isAdminEmail(user?.email) || role === "admin") return "Super Admin";
  if (role === "expert" || role === "faculty") return "Faculty";
  if (role === "client") return "Client";
  return role ? role.charAt(0).toUpperCase() + role.slice(1) : "Client";
};

module.exports = {
  DEFAULT_BACKEND_URL,
  getProfilePhotoCandidate,
  getRoleLabel,
  resolveProfilePhotoUrl,
  setProfilePhotoFields,
  uploadProfilePhoto,
};
