const pool = require("../config/db");
const fs = require("fs");
const path = require("path");
const { softDeleteSchedulesByCondition } = require("../utils/scheduleCleanup");

const getBranchId = (req, res) => {
  const branchId = req.admin.branch_id;
  if (!branchId) {
    res.status(403).json({
      success: false,
      message: "Admin belum terhubung ke cabang manapun",
    });
    return null;
  }
  return branchId;
};

const deleteImageFile = (filename) => {
  if (!filename) return;
  const filePath = path.join(process.cwd(), "uploads", "staffs", filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};

/**
 * GET /api/staff
 * Ambil semua staff milik branch admin yang login
 */
const getAllStaff = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;

  try {
    const result = await pool.query(
      `SELECT id, name, contact, image, description, created_at
       FROM staff
       WHERE branch_id = $1
       ORDER BY created_at DESC`,
      [branchId]
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (err) {
    console.error("Get staff error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * POST /api/staff
 * Tambah staff baru

 */
const createStaff = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;

  const { name, contact, description } = req.body;
  const imageFile = req.file || null;

  // Validasi field wajib
  if (!name || !name.trim()) {
    if (imageFile) deleteImageFile(imageFile.filename);
    return res.status(400).json({
      success: false,
      message: "Nama staff wajib diisi",
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO staff (branch_id, name, contact, image, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, contact, image, description, created_at`,
      [
        branchId,
        name.trim(),
        contact?.trim() || null,
        imageFile ? imageFile.filename : null,
        description?.trim() || null,
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Staff berhasil ditambahkan",
      data: result.rows[0],
    });
  } catch (err) {
    // Kalau DB error, hapus file yang sudah telanjur diupload
    if (imageFile) deleteImageFile(imageFile.filename);
    console.error("Create staff error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * PUT /api/staff/:id
 * Edit data staff
 * Kalau ada file baru di-upload, hapus file lama dari disk
 */
const updateStaff = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;

  const staffId = parseInt(req.params.id);
  const { name, contact, description } = req.body;
  const imageFile = req.file || null;

  if (isNaN(staffId)) {
    if (imageFile) deleteImageFile(imageFile.filename);
    return res.status(400).json({ success: false, message: "ID tidak valid" });
  }

  if (!name || !name.trim()) {
    if (imageFile) deleteImageFile(imageFile.filename);
    return res.status(400).json({ success: false, message: "Nama staff wajib diisi" });
  }

  try {
    // Ambil data staff saat ini untuk dapat nama file gambar lama
    const current = await pool.query(
      `SELECT image FROM staff WHERE id = $1 AND branch_id = $2`,
      [staffId, branchId]
    );

    if (current.rows.length === 0) {
      if (imageFile) deleteImageFile(imageFile.filename);
      return res.status(404).json({
        success: false,
        message: "Staff tidak ditemukan",
      });
    }

    const oldImage = current.rows[0].image;

    const newImage = imageFile ? imageFile.filename : oldImage;

    const result = await pool.query(
      `UPDATE staff
       SET name = $1, contact = $2, image = $3, description = $4, updated_at = NOW()
       WHERE id = $5 AND branch_id = $6
       RETURNING id, name, contact, image, description`,
      [
        name.trim(),
        contact?.trim() || null,
        newImage,
        description?.trim() || null,
        staffId,
        branchId,
      ]
    );

    // Hapus file lama dari disk kalau ada file baru yang berhasil disimpan
    if (imageFile && oldImage) {
      deleteImageFile(oldImage);
    }

    return res.status(200).json({
      success: true,
      message: "Data staff berhasil diperbarui",
      data: result.rows[0],
    });
  } catch (err) {
    if (imageFile) deleteImageFile(imageFile.filename);
    console.error("Update staff error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * DELETE /api/staff/:id
 * Hapus staff + hapus file gambarnya dari disk beserta soft-delete jadwal terkait
 */
const deleteStaff = async (req, res) => {
  const branchId = getBranchId(req, res);
  if (!branchId) return;
  const staffId = parseInt(req.params.id);
  if (isNaN(staffId)) return res.status(400).json({ success: false, message: "ID tidak valid" });

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Menambahkan `image` agar bisa dihapus file-nya nanti
      const check = await client.query(
        `SELECT id, name, image FROM staff WHERE id = $1 AND branch_id = $2`,
        [staffId, branchId]
      );
      if (check.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, message: "Staff tidak ditemukan" });
      }

      // ← Soft-delete semua schedule yang pakai staff ini
      const scheduleIds = await client.query(
        `SELECT DISTINCT schedule_id FROM schedule_staff WHERE staff_id = $1`,
        [staffId]
      );
      for (const row of scheduleIds.rows) {
        await softDeleteSchedulesByCondition(client, "id = $1", [row.schedule_id]);
      }

      // Delete staff (ON DELETE CASCADE otomatis hapus schedule_staff)
      await client.query(`DELETE FROM staff WHERE id = $1`, [staffId]);
      await client.query("COMMIT");

      // Hapus file foto
      if (check.rows[0].image) deleteImageFile(check.rows[0].image);

      return res.status(200).json({
        success: true,
        message: `Staff "${check.rows[0].name}" dan jadwal terkait berhasil dihapus`,
      });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Delete staff error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { getAllStaff, createStaff, updateStaff, deleteStaff };