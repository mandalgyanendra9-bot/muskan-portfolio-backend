const { isAdminEmail } = require("./adminAccess");
const {
  getProfilePhotoCandidate,
  getRoleLabel,
  resolveProfilePhotoUrl,
  setProfilePhotoFields,
} = require("./profilePhoto");

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

const serializeUser = (user, req, extra = {}) => {
  const plain = typeof user?.toObject === "function" ? user.toObject() : { ...user };
  const profilePhotoUrl = resolveProfilePhotoUrl(getProfilePhotoCandidate(plain));
  const legacyPhoto = getProfilePhotoCandidate(plain);
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
    ...setProfilePhotoFields({}, legacyPhoto),
    profileImageUrl: toAbsoluteUrl(legacyPhoto, req),
    profilePhotoUrl,
    displayRole: getRoleLabel({ ...plain, isSuperAdmin }),
    isSuperAdmin,
  };
};

module.exports = {
  getRoleLabel,
  serializeUser,
  toAbsoluteUrl,
};
