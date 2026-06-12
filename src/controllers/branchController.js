const pool = require("../config/db");
const bcrypt = require("bcryptjs");
const uploadToSupabase = require("../utils/uploadToSupabase"); // <-- Import helper Supabase

/**
 * GET /api/branches
 * Ambil semua cabang KECUALI cabang milik admin yang sedang login
 * Hanya bisa diakses admin pusat (dijaga di route level)
 */
const getAllBranches = async (req, res) => {
  try {
    // Ambil branch_id milik admin yang sedang login dari JWT payload
    const myBranchId = req.admin.branch_id;

    const result = await pool.query(
      `SELECT 
          b.id,
          b.name,
          b.address,
          b.contact,
          b.operational_hours,
          b.time_slots,
          b.photo, -- <-- Kita ambil juga kolom photo agar bisa ditampilkan di Frontend
          b.created_at,
          -- Hitung jumlah admin yang terhubung ke branch ini
          COUNT(a.id) AS admin_count
        FROM branch b
        LEFT JOIN admin a ON a.branch_id = b.id
        WHERE b.id != $1
        GROUP BY b.id
        ORDER BY b.created_at ASC`,
      [myBranchId]
    );

    // Hitung total semua cabang termasuk milik admin sendiri
    const totalResult = await pool.query(
      `SELECT COUNT(*) AS total FROM branch`
    );

    return res.status(200).json({
      success: true,
      data: {
        branches: result.rows,
        // Total semua cabang (termasuk milik sendiri) untuk ditampilkan di header
        total_all: parseInt(totalResult.rows[0].total),
        // Total yang ditampilkan di tabel (exclude milik sendiri)
        total_shown: result.rows.length,
      },
    });
  } catch (err) {
    console.error("Get branches error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * POST /api/branches
 * Tambah cabang baru + buat akun admin cabang sekaligus (Termasuk Upload Foto ke Supabase)
 */
const createBranch = async (req, res) => {
  const {
    branch_name,
    branch_address,
    branch_contact,
    operational_hours,
    time_slots,
    admin_email,
    admin_password,
    admin_phone,
    admin_role,
  } = req.body;

  // ─── Validasi field wajib ─────────────────────────────────────
  const requiredFields = {
    branch_name: "Nama cabang",
    branch_address: "Alamat cabang",
    branch_contact: "Kontak cabang",
    admin_email: "Email admin",
    admin_password: "Password admin",
    admin_phone: "Nomor telepon admin",
  };

  for (const [field, label] of Object.entries(requiredFields)) {
    if (!req.body[field] || String(req.body[field]).trim() === "") {
      return res.status(400).json({
        success: false,
        message: `${label} wajib diisi`,
      });
    }
  }

  // Validasi role admin baru
  if (admin_role && !["pusat", "cabang"].includes(admin_role)) {
    return res.status(400).json({
      success: false,
      message: "Role admin tidak valid. Harus 'pusat' atau 'cabang'",
    });
  }

  // Validasi password minimal
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
  if (!passwordRegex.test(admin_password)) {
    return res.status(400).json({
      success: false,
      message: "Password admin minimal 8 karakter, harus ada huruf besar, huruf kecil, dan angka",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ─── 1. Cek apakah email admin sudah terdaftar ────────────
    const emailCheck = await client.query(
      `SELECT id FROM admin WHERE email = $1 LIMIT 1`,
      [admin_email.toLowerCase().trim()]
    );

    if (emailCheck.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        message: "Email admin sudah terdaftar. Gunakan email lain.",
      });
    }

    // ─── 2. Proses Upload Gambar ke Supabase (Jika Ada) ────────
    let photoUrl = null;
    if (req.file) {
      // Menggunakan helper untuk upload buffer ke folder 'branches' di Supabase
      photoUrl = await uploadToSupabase(req.file, "branches");
    }

    // ─── 3. Insert branch baru (Termasuk URL Photo) ───────────
    const branchResult = await client.query(
      `INSERT INTO branch (name, address, contact, operational_hours, time_slots, photo)
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id, name, address, contact, photo, created_at`,
      [
        branch_name.trim(),                      // $1
        branch_address.trim(),                   // $2
        branch_contact.trim(),                   // $3
        JSON.stringify(operational_hours || {}), // $4
        JSON.stringify(                          // $5
          Array.isArray(time_slots)
            ? time_slots
            : String(time_slots)
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
        ),
        photoUrl                                 // $6 (Bisa berisi URL atau null)
      ]
    );

    const newBranch = branchResult.rows[0];

    // ─── 4. Hash password admin baru ─────────────────────────
    const hashedPassword = await bcrypt.hash(admin_password, 12);

    // ─── 5. Insert admin cabang baru ─────────────────────────
    const adminResult = await client.query(
      `INSERT INTO admin (email, password, phone, role, branch_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, role, branch_id`,
      [
        admin_email.toLowerCase().trim(),
        hashedPassword,
        admin_phone.trim(),
        admin_role || "cabang",
        newBranch.id,
      ]
    );

    const newAdmin = adminResult.rows[0];

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      message: `Cabang "${newBranch.name}" berhasil ditambahkan`,
      data: {
        branch: newBranch,
        admin: {
          id: newAdmin.id,
          email: newAdmin.email,
          role: newAdmin.role,
        },
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Create branch error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan saat menyimpan data. Coba lagi.",
    });
  } finally {
    client.release();
  }
};

/**
 * DELETE /api/branches/:id
 * Hapus cabang beserta admin yang terhubung ke cabang tersebut
 */
const deleteBranch = async (req, res) => {
  const branchId = parseInt(req.params.id);
  const myBranchId = req.admin.branch_id;

  if (isNaN(branchId)) {
    return res.status(400).json({ success: false, message: "ID cabang tidak valid" });
  }

  // Admin pusat tidak bisa hapus cabang miliknya sendiri
  if (branchId === myBranchId) {
    return res.status(403).json({
      success: false,
      message: "Tidak bisa menghapus cabang Anda sendiri",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ─── 1. Cek cabang ada atau tidak ─────────────────────────
    const branchCheck = await client.query(
      `SELECT id, name FROM branch WHERE id = $1 LIMIT 1`,
      [branchId]
    );

    if (branchCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Cabang tidak ditemukan",
      });
    }

    const branchName = branchCheck.rows[0].name;

    // ─── 2. Hapus semua admin yang terhubung ke cabang ini ────
    await client.query(`DELETE FROM admin WHERE branch_id = $1`, [branchId]);

    // ─── 3. Hapus branch ──────────────────────────────────────
    await client.query(`DELETE FROM branch WHERE id = $1`, [branchId]);

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: `Cabang "${branchName}" berhasil dihapus`,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Delete branch error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan saat menghapus cabang.",
    });
  } finally {
    client.release();
  }
};

module.exports = { getAllBranches, createBranch, deleteBranch };