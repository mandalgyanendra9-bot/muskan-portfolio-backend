const nodemailer = require("nodemailer");

// ─── Nodemailer Transporter ──────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // Gmail App Password (16 chars)
  },
});

/**
 * Send an email using the configured transporter.
 * @param {Object} options
 * @param {string} options.to      - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.html    - HTML body content
 */
const sendEmail = async ({ to, subject, html }) => {
  const mailOptions = {
    from: `"Portfolio Auth" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
  };
  await transporter.sendMail(mailOptions);
};

module.exports = sendEmail;
