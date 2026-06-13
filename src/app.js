const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

require("dotenv").config();
const express = require("express");

const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const cron = require("node-cron");
const pool = require("./config/db");

const branchRoutes = require("./routes/branchRoutes");
const authRoutes = require("./routes/authRoutes");
const profileRoutes = require("./routes/profileRoutes");
const serviceRoutes = require("./routes/serviceRoutes");
const roomRoutes = require("./routes/roomRoutes");
const staffRoutes = require("./routes/staffRoutes");
const membershipRoutes = require("./routes/membershipRoutes");
const scheduleRoutes = require("./routes/scheduleRoutes");
const userRoutes = require("./routes/userRoutes");
const publicBranchRoutes = require("./routes/publicBranchRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const userMembershipRoutes = require("./routes/userMembershipRoutes");
const publicScheduleRoutes = require("./routes/publicScheduleRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const adminScanRoutes = require("./routes/adminScanRoutes");
const publicStaffRoutes = require("./routes/publicStaffRoutes");
const chatRoutes = require("./routes/chatRoutes");
const walkinRoutes = require("./routes/walkinRoutes");
const { createNotification } = require("./controllers/notificationController");

const app = express();
const httpServer = http.createServer(app);

// 🌟 PERBAIKAN CORS: Buat daftar semua URL frontend yang diizinkan
const allowedOrigins = [
  "http://localhost:3000", // Akses untuk saat Anda coding di komputer sendiri
  "https://activelab-fitness-recovery-5iid-51apqozrn.vercel.app", // URL Vercel (dari screenshot)
  process.env.FRONTEND_URL // Jika Anda menambahkan URL Vercel utama di Railway env variable
].filter(Boolean); // filter(Boolean) mencegah nilai undefined masuk ke dalam array

// 🌟 Terapkan daftar origin ke Socket.io
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  },
});

io.on("connection", (socket) => {
  socket.on("join_session", (sessionId) => {
    socket.join(`session:${sessionId}`);
  });
  socket.on("disconnect", () => {});
});

app.set("io", io);

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

// 🌟 Terapkan daftar origin ke API Express HTTP
app.use(
  cors({
    origin: function (origin, callback) {
      // Izinkan request yang tidak memiliki origin (misal dari Postman atau Mobile App)
      if (!origin) return callback(null, true);
      
      // Cek apakah origin yang meminta akses ada di dalam daftar allowedOrigins
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error("Akses diblokir oleh CORS Policy"));
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// --- ROUTES ---
app.use("/api/auth", authRoutes);
app.use("/api/branches", branchRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/memberships", membershipRoutes);
app.use("/api/schedules", scheduleRoutes);
app.use("/api/users", userRoutes);
app.use("/api/public/branches", publicBranchRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/users/memberships", userMembershipRoutes);
app.use("/api/public/schedules", publicScheduleRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/admin/scan", adminScanRoutes);
app.use("/api/public/staff", publicStaffRoutes);
app.use("/api/chats", chatRoutes);
app.use("/api/admin/walkin", walkinRoutes);

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "gymABCD API is running",
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} tidak ditemukan`,
  });
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    success: false,
    message: "Terjadi kesalahan internal server",
  });
});

const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  console.log(`🚀 Server berjalan di port ${PORT}`);
});

cron.schedule("* * * * *", async () => {
  try {
    const result = await pool.query(
      `SELECT
         b.id AS booking_id, b.user_id,
         sn.name AS service_name,
         TO_CHAR(s.start_time, 'HH24:MI') AS start_time,
         s.timezone
       FROM booking b
       JOIN schedule s  ON b.schedule_id = s.id
       JOIN service_name sn ON s.service_name_id = sn.id
       WHERE b.status = 'pending'
         AND s.date = CURRENT_DATE
         AND (s.start_time - INTERVAL '10 minutes') <= CURRENT_TIME
         AND s.start_time > CURRENT_TIME
         AND NOT EXISTS (
           SELECT 1 FROM user_notification un
           WHERE un.user_id = b.user_id
             AND un.type = 'booking_reminder'
             AND (un.data->>'booking_id')::int = b.id
         )`
    );

    for (const row of result.rows) {
      await createNotification(
        row.user_id,
        "booking_reminder",
        "⏰ Sesi dimulai sebentar lagi!",
        `${row.service_name} dimulai pukul ${row.start_time} ${row.timezone}. Silakan bersiap untuk check-in.`,
        { booking_id: row.booking_id }
      );
    }
  } catch (err) {
    console.error("Cron booking reminder error:", err.message);
  }
});

module.exports = { app, httpServer };