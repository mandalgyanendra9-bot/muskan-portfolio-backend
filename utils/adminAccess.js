const DEFAULT_ADMIN_EMAIL = "mandalgyanendra9@gmail.com";

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const getAdminEmail = () => normalizeEmail(process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL);

const isAdminEmail = (email) => {
  const adminEmail = getAdminEmail();
  return Boolean(adminEmail) && normalizeEmail(email) === adminEmail;
};

const normalizeRoleForEmail = (email, requestedRole = "client") => {
  if (isAdminEmail(email)) return "admin";
  return requestedRole === "expert" ? "expert" : "client";
};

module.exports = {
  getAdminEmail,
  isAdminEmail,
  normalizeEmail,
  normalizeRoleForEmail,
};
