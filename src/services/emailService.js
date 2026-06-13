const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const nodemailer = require("nodemailer");
require("dotenv").config();

// ─── Transporter: Gmail SMTP ───────────────────────────────────
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com', // Pakai host eksplisit, jangan hanya "service: 'gmail'"
  port: 587,
  secure: false,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  },
  // Paksa koneksi via IPv4 — banyak host (Railway/Render) tidak punya egress
  // IPv6 ke Gmail, sehingga muncul error ENETUNREACH pada alamat 2607:f8b0:...
  family: 4,
  // Tambahkan baris di bawah ini untuk menghindari isu SSL/IPv6 di cloud
  tls: {
    rejectUnauthorized: false
  }
});

transporter.verify((err) => {
  if (err) console.error("❌ Email transporter error:", err.message);
  else console.log("✅ Email transporter siap:", process.env.GMAIL_USER);
});

// ─── Helper: kirim email ───────────────────────────────────────
const sendMail = async ({ to, subject, html, text }) => {
  await transporter.sendMail({
    from: `"ActiveLab" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html,
    text,
  });
};

// ─── Email HTML template helper ───────────────────────────────
const baseTemplate = (content) => `
<!DOCTYPE html>
<html lang="id">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width"/></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
  <tr><td align="center">
    <table width="500" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1);">
      <tr><td style="background:#0d6efd;padding:30px;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:24px;letter-spacing:1px;">Activelab</h1>
        <p style="color:#cfe2ff;margin:8px 0 0;font-size:13px;">ActiveLab Management</p>
      </td></tr>
      <tr><td style="padding:36px 40px;">${content}</td></tr>
      <tr><td style="background:#f8f9fa;padding:20px 40px;border-top:1px solid #dee2e6;text-align:center;">
        <p style="color:#adb5bd;font-size:12px;margin:0;">
          Email otomatis dari Activelab. Jangan balas email ini.<br/>
          © ${new Date().getFullYear()} Activelab. All rights reserved.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

/**
 * Kirim email reset password — ADMIN
 */
const sendAdminResetPasswordEmail = async (toEmail, resetToken) => {
  const resetUrl = `${process.env.ADMIN_RESET_URL}?token=${resetToken}`;
  const expiresMin = process.env.RESET_TOKEN_EXPIRES_MINUTES || 30;

  const content = `
    <h2 style="color:#212529;font-size:20px;margin:0 0 16px;">Reset Password Admin</h2>
    <p style="color:#495057;font-size:15px;line-height:1.6;margin:0 0 24px;">
      Kami menerima permintaan reset password untuk akun admin <strong>${toEmail}</strong>.
      Klik tombol di bawah untuk membuat password baru.
    </p>
    <table cellpadding="0" cellspacing="0" width="100%">
      <tr><td align="center" style="padding:8px 0 32px;">
        <a href="${resetUrl}" style="background:#0d6efd;color:#fff;text-decoration:none;padding:14px 36px;border-radius:6px;font-size:15px;font-weight:bold;display:inline-block;">
          Reset Password Sekarang
        </a>
      </td></tr>
    </table>
    <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:14px;margin-bottom:24px;">
      <p style="color:#856404;font-size:13px;margin:0;">
        ⏰ Link berlaku <strong>${expiresMin} menit</strong> dan hanya bisa digunakan sekali.
      </p>
    </div>
    <p style="color:#6c757d;font-size:12px;margin:0;">
      Jika tidak merasa meminta reset, abaikan email ini.
    </p>
    <p style="background:#f8f9fa;border:1px solid #dee2e6;border-radius:4px;padding:10px;font-size:11px;color:#0d6efd;word-break:break-all;margin-top:12px;">
      ${resetUrl}
    </p>`;

  await sendMail({
    to: toEmail,
    subject: "Reset Password Admin — Activelab",
    html: baseTemplate(content),
    text: `Reset password admin: ${resetUrl}`,
  });
  console.log(`✅ Admin reset email terkirim ke ${toEmail}`);
};

/**
 * Kirim email reset password — USER (Flutter)
 */
const sendUserResetPasswordEmail = async (toEmail, userName, resetToken) => {
  const resetUrl = `${process.env.USER_RESET_URL}?token=${resetToken}`;
  const expiresMin = process.env.RESET_TOKEN_EXPIRES_MINUTES || 30;

  const content = `
    <h2 style="color:#212529;font-size:20px;margin:0 0 16px;">Reset Password Akun ActiveLab</h2>
    <p style="color:#495057;font-size:15px;line-height:1.6;margin:0 0 8px;">
      Halo <strong>${userName || toEmail}</strong>,
    </p>
    <p style="color:#495057;font-size:15px;line-height:1.6;margin:0 0 24px;">
      Kami menerima permintaan reset password untuk akun ActiveLab Anda.
      Buka link di bawah melalui browser untuk membuat password baru.
    </p>
    <table cellpadding="0" cellspacing="0" width="100%">
      <tr><td align="center" style="padding:8px 0 32px;">
        <a href="${resetUrl}" style="background:#4285F4;color:#fff;text-decoration:none;padding:14px 36px;border-radius:30px;font-size:15px;font-weight:bold;display:inline-block;">
          Reset Password
        </a>
      </td></tr>
    </table>
    <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:14px;margin-bottom:24px;">
      <p style="color:#856404;font-size:13px;margin:0;">
        ⏰ Link berlaku <strong>${expiresMin} menit</strong>. Setelah reset berhasil, login kembali di aplikasi ActiveLab.
      </p>
    </div>
    <p style="color:#6c757d;font-size:12px;margin:0;">
      Jika tidak merasa meminta reset, abaikan email ini. Password Anda tidak berubah.
    </p>
    `;

  await sendMail({
    to: toEmail,
    subject: "Reset Password — Activelab",
    html: baseTemplate(content),
    text: `Reset password Anda: ${resetUrl}`,
  });
  console.log(`✅ User reset email terkirim ke ${toEmail}`);
};

module.exports = {
  sendAdminResetPasswordEmail,
  sendUserResetPasswordEmail,
};