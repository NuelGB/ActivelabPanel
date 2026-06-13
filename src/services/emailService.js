const dns = require('dns');
const nodemailer = require("nodemailer");
require("dotenv").config();

let transporterPromise = null;

const getTransporter = () => {
  if (transporterPromise) return transporterPromise;

  transporterPromise = new Promise((resolve, reject) => {
    dns.resolve4('smtp.gmail.com', async (err, addresses) => {
      const host = !err && addresses && addresses.length > 0
        ? addresses[0]
        : 'smtp.gmail.com';

      if (err) {
        console.warn("⚠️ Gagal resolve4, fallback ke hostname:", err.message);
      } else {
        console.log("ℹ️ SMTP Gmail pakai IPv4:", host);
      }

      // 🔹 Fungsi buat transporter
      const createTransporter = (port, secure) => {
        return nodemailer.createTransport({
          host: host,
          port: port,
          secure: secure,
          auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD
          },
          tls: {
            servername: 'smtp.gmail.com'
          },
          connectionTimeout: 15000,
          greetingTimeout: 15000,
        });
      };

      try {
        // 🔥 Coba port 465 dulu
        let transporter = createTransporter(465, true);

        await transporter.verify();
        console.log("✅ Email transporter ready (port 465)");
        return resolve(transporter);

      } catch (err465) {
        console.warn("⚠️ Port 465 gagal, coba 587:", err465.message);

        try {
          // 🔄 fallback ke 587
          let transporter = createTransporter(587, false);

          await transporter.verify();
          console.log("✅ Email transporter ready (port 587)");
          return resolve(transporter);

        } catch (err587) {
          console.error("❌ Semua koneksi SMTP gagal:", err587.message);
          return reject(err587);
        }
      }
    });
  });

  return transporterPromise;
};

// ─── Helper kirim email ─────────────────────────
const sendMail = async ({ to, subject, html, text }) => {
  const transporter = await getTransporter();

  await transporter.sendMail({
    from: `"ActiveLab" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html,
    text,
  });
};

// ─── Template HTML ──────────────────────────────
const baseTemplate = (content) => `
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width"/>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
  <tr><td align="center">
    <table width="500" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1);">
      <tr><td style="background:#0d6efd;padding:30px;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:24px;">Activelab</h1>
        <p style="color:#cfe2ff;margin:8px 0 0;font-size:13px;">ActiveLab Management</p>
      </td></tr>
      <tr><td style="padding:36px 40px;">${content}</td></tr>
      <tr><td style="background:#f8f9fa;padding:20px;text-align:center;">
        <p style="color:#adb5bd;font-size:12px;margin:0;">
          Email otomatis dari Activelab. Jangan balas email ini.<br/>
          © ${new Date().getFullYear()} Activelab
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

// ─── ADMIN RESET ───────────────────────────────
const sendAdminResetPasswordEmail = async (toEmail, resetToken) => {
  const resetUrl = `${process.env.ADMIN_RESET_URL}?token=${resetToken}`;
  const expiresMin = process.env.RESET_TOKEN_EXPIRES_MINUTES || 30;

  const content = `
    <h2>Reset Password Admin</h2>
    <p>Permintaan reset password untuk <strong>${toEmail}</strong>.</p>
    <p>Klik tombol di bawah:</p>
    <p style="text-align:center;">
      <a href="${resetUrl}" style="background:#0d6efd;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;">
        Reset Password
      </a>
    </p>
    <p>Link berlaku ${expiresMin} menit.</p>
    <p style="font-size:12px;">${resetUrl}</p>
  `;

  await sendMail({
    to: toEmail,
    subject: "Reset Password Admin — Activelab",
    html: baseTemplate(content),
    text: resetUrl,
  });

  console.log(`✅ Admin email terkirim ke ${toEmail}`);
};

// ─── USER RESET ────────────────────────────────
const sendUserResetPasswordEmail = async (toEmail, userName, resetToken) => {
  const resetUrl = `${process.env.USER_RESET_URL}?token=${resetToken}`;
  const expiresMin = process.env.RESET_TOKEN_EXPIRES_MINUTES || 30;

  const content = `
    <h2>Reset Password</h2>
    <p>Halo <strong>${userName || toEmail}</strong>,</p>
    <p>Klik tombol di bawah untuk reset password:</p>
    <p style="text-align:center;">
      <a href="${resetUrl}" style="background:#4285F4;color:#fff;padding:12px 24px;text-decoration:none;border-radius:20px;">
        Reset Password
      </a>
    </p>
    <p>Link berlaku ${expiresMin} menit.</p>
  `;

  await sendMail({
    to: toEmail,
    subject: "Reset Password — Activelab",
    html: baseTemplate(content),
    text: resetUrl,
  });

  console.log(`✅ User email terkirim ke ${toEmail}`);
};

module.exports = {
  sendAdminResetPasswordEmail,
  sendUserResetPasswordEmail,
};