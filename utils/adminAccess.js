const DEFAULT_ADMIN_EMAIL = "mandalgyanu2823297@gmail.com";

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const getAdminEmail = () => normalizeEmail(process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL);

const isAdminEmail = (email) => {
  const adminEmail = getAdminEmail();
  return Boolean(adminEmail) && normalizeEmail(email) === adminEmail;
};

const hasAdminAccess = (user) => Boolean(user && (user.role === "admin" || isAdminEmail(user.email)));

const normalizeRoleForEmail = (email, requestedRole = "client") => {
  if (isAdminEmail(email)) return "admin";
  if (requestedRole === "admin") return "admin";
  return requestedRole === "expert" ? "expert" : "client";
};

module.exports = {
  getAdminEmail,
  hasAdminAccess,
  isAdminEmail,
  normalizeEmail,
  normalizeRoleForEmail,
};
