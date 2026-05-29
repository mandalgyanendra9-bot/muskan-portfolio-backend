const { isAdminEmail } = require("./adminAccess");

const getRequestOrigin = (req) => {
  if (!req) return "";
  const protocol = (req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
  const host = req.get?.("host") || req.headers.host || "";
  return protocol && host ? `${protocol}://${host}` : "";
};

const toAbsoluteUrl = (value, req) => {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;

  const origin = getRequestOrigin(req);
  if (!origin) return value;

  return `${origin}${String(value).startsWith("/") ? value : `/${value}`}`;
};

const getRoleLabel = (user) => {
  const role = String(user?.role || "").toLowerCase();
  if (isAdminEmail(user?.email) || role === "admin") return "Super Admin";
  if (role === "expert" || role === "faculty") return "Faculty";
  if (role === "client") return "Client";
  return role ? role.charAt(0).toUpperCase() + role.slice(1) : "Client";
};

const serializeUser = (user, req, extra = {}) => {
  const plain = typeof user?.toObject === "function" ? user.toObject() : { ...user };
  const profileImage = plain.profileImage || plain.profilePhoto || "";
  const isSuperAdmin = isAdminEmail(plain.email) || String(plain.role || "").toLowerCase() === "admin";

  delete plain.password;
  delete plain.emailVerifyToken;
  delete plain.resetPasswordToken;
  delete plain.resetPasswordExpires;
  delete plain.otpLoginHash;
  delete plain.otpLoginExpires;
  delete plain.otpLoginAttempts;
  delete plain.activeSessionId;
  delete plain.sessionFingerprintHash;

  return {
    ...plain,
    ...extra,
    profileImage,
    profilePhoto: plain.profilePhoto || profileImage,
    profileImageUrl: toAbsoluteUrl(profileImage, req),
    profilePhotoUrl: toAbsoluteUrl(plain.profilePhoto || profileImage, req),
    displayRole: getRoleLabel({ ...plain, isSuperAdmin }),
    isSuperAdmin,
  };
};

module.exports = {
  getRoleLabel,
  serializeUser,
  toAbsoluteUrl,
};
