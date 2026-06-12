const pool = require("../config/db");
const bcrypt = require("bcryptjs");
const uploadToSupabase = require("../utils/uploadToSupabase");

/**
 * GET /api/branches
 */
const getAllBranches = async (req, res) => {
  try {
    const myBranchId = req.admin.branch_id;
    const result = await pool.query(
      `SELECT 
          b.id, b.name, b.address, b.contact, b.operational_hours, b.time_slots, b.photo, b.created_at,
          COUNT(a.id) AS admin_count
        FROM branch b
        LEFT JOIN admin a ON a.branch_id = b.id
        WHERE b.id != $1
        GROUP BY b.id
        ORDER BY b.created_at ASC`,
      [myBranchId]
    );

    const totalResult = await pool.query(`SELECT COUNT(*) AS total FROM branch`);

    return res.status(200).json({
      success: true,
      data: {
        branches: result.rows,
        total_all: parseInt(totalResult.rows[0].total),
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
 */
const createBranch = async (req, res) => {
  const {
    branch_name, branch_address, branch_contact, operational_hours, time_slots,
    admin_email, admin_password, admin_phone, admin_role,
  } = req.body;

  const requiredFields = {
    branch_name: "Nama cabang", branch_address: "Alamat cabang", branch_contact: "Kontak cabang",
    admin_email: "Email admin", admin_password: "Password admin", admin_phone: "Nomor telepon admin",
  };

  for (const [field, label] of Object.entries(requiredFields)) {
    if (!req.body[field] || String(req.body[field]).trim() === "") {
      return res.status(400).json({ success: false, message: `${label} wajib diisi` });
    }
  }

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

    const emailCheck = await client.query(
      `SELECT id FROM admin WHERE email = $1 LIMIT 1`,
      [admin_email.toLowerCase().trim()]
    );

    if (emailCheck.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Email admin sudah terdaftar." });
    }

    let photoUrl = null;
    if (req.file) {
      photoUrl = await uploadToSupabase(req.file, "branches");
    }

    const branchResult = await client.query(
      `INSERT INTO branch (name, address, contact, operational_hours, time_slots, photo)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, address, contact, photo`,
      [
        branch_name.trim(), branch_address.trim(), branch_contact.trim(),
        JSON.stringify(operational_hours || {}),
        JSON.stringify(Array.isArray(time_slots) ? time_slots : String(time_slots).split(",").map(s => s.trim()).filter(Boolean)),
        photoUrl
      ]
    );

    const newBranch = branchResult.rows[0];
    const hashedPassword = await bcrypt.hash(admin_password, 12);

    await client.query(
      `INSERT INTO admin (email, password, phone, role, branch_id) VALUES ($1, $2, $3, $4, $5)`,
      [admin_email.toLowerCase().trim(), hashedPassword, admin_phone.trim(), admin_role || "cabang", newBranch.id]
    );

    await client.query("COMMIT");
    return res.status(201).json({ success: true, message: `Cabang "${newBranch.name}" berhasil ditambahkan` });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Create branch error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

/**
 * PUT /api/branches/:id
 */
const updateBranch = async (req, res) => {
  const branchId = parseInt(req.params.id);
  const { branch_name, branch_address, branch_contact, operational_hours, time_slots } = req.body;

  if (isNaN(branchId)) return res.status(400).json({ success: false, message: "ID tidak valid" });
  if (!branch_name || !branch_address) return res.status(400).json({ success: false, message: "Nama dan Alamat wajib diisi" });

  try {
    const current = await pool.query(`SELECT photo FROM branch WHERE id = $1`, [branchId]);
    if (current.rows.length === 0) return res.status(404).json({ success: false, message: "Cabang tidak ditemukan" });

    let newPhotoUrl = current.rows[0].photo;
    if (req.file) {
      newPhotoUrl = await uploadToSupabase(req.file, "branches");
    }

    const result = await pool.query(
      `UPDATE branch
       SET name = $1, address = $2, contact = $3, operational_hours = $4, time_slots = $5, photo = $6, updated_at = NOW()
       WHERE id = $7 RETURNING id, name, photo`,
      [
        branch_name.trim(), branch_address.trim(), branch_contact ? branch_contact.trim() : null,
        JSON.stringify(operational_hours || {}),
        JSON.stringify(Array.isArray(time_slots) ? time_slots : String(time_slots || "").split(",").map(s => s.trim()).filter(Boolean)),
        newPhotoUrl, branchId
      ]
    );

    return res.status(200).json({ success: true, message: "Data cabang berhasil diperbarui", data: result.rows[0] });
  } catch (err) {
    console.error("Update branch error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * DELETE /api/branches/:id
 */
const deleteBranch = async (req, res) => {
  const branchId = parseInt(req.params.id);
  const myBranchId = req.admin.branch_id;

  if (isNaN(branchId)) return res.status(400).json({ success: false, message: "ID tidak valid" });
  if (branchId === myBranchId) return res.status(403).json({ success: false, message: "Tidak bisa menghapus cabang sendiri" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const branchCheck = await client.query(`SELECT id, name FROM branch WHERE id = $1 LIMIT 1`, [branchId]);
    if (branchCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Cabang tidak ditemukan" });
    }

    const branchName = branchCheck.rows[0].name;
    await client.query(`DELETE FROM admin WHERE branch_id = $1`, [branchId]);
    await client.query(`DELETE FROM branch WHERE id = $1`, [branchId]);
    await client.query("COMMIT");

    return res.status(200).json({ success: true, message: `Cabang "${branchName}" berhasil dihapus` });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Delete branch error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  } finally {
    client.release();
  }
};

module.exports = { getAllBranches, createBranch, updateBranch, deleteBranch };