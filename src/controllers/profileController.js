const pool = require("../config/db");
const fs = require("fs");
const path = require("path");

/**
 * GET /api/profile
 */
const getProfile = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         a.id          AS admin_id,
         a.email,
         a.phone,
         a.role,
         a.photo       AS admin_photo,
         a.branch_id,
         a.created_at  AS admin_created_at,
         b.name        AS branch_name,
         b.address     AS branch_address,
         b.contact     AS branch_contact,
         b.operational_hours,
         b.time_slots,
         b.photo       AS branch_photo,
         b.created_at  AS branch_created_at
       FROM admin a
       LEFT JOIN branch b ON a.branch_id = b.id
       WHERE a.id = $1`,
      [req.admin.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Data admin tidak ditemukan",
      });
    }

    const row = result.rows[0];

    return res.status(200).json({
      success: true,
      data: {
        admin: {
          id: row.admin_id,
          email: row.email,
          phone: row.phone,
          role: row.role,
          photo: row.admin_photo || null,
          created_at: row.admin_created_at,
        },
        branch: row.branch_id
          ? {
              id: row.branch_id,
              name: row.branch_name,
              address: row.branch_address,
              contact: row.branch_contact,
              operational_hours: row.operational_hours,
              time_slots: row.time_slots,
              photo: row.branch_photo || null,
              created_at: row.branch_created_at,
            }
          : null,
      },
    });
  } catch (err) {
    console.error("Get profile error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * PUT /api/profile
 */
const updateProfile = async (req, res) => {
  // 🔍 LOG PELACAK: Cek apa saja yang dikirim dari klien/Thunder Client
  console.log("=== MASUK KE UPDATE PROFILE ===");
  console.log("Body Data:", req.body);
  console.log("Files Received:", req.files);

  const {
    email,
    phone,
    branch_name,
    branch_address,
    branch_contact,
    operational_hours,
    time_slots,
  } = req.body;

  const adminPhotoFile = req.files?.["photo"]?.[0] || null;
  const branchPhotoFile = req.files?.["branch_photo"]?.[0] || null;

  // Beri info di log jika file terdeteksi atau tidak
  console.log("Admin Photo File terdeteksi:", adminPhotoFile ? adminPhotoFile.filename : "TIDAK ADA");
  console.log("Branch Photo File terdeteksi:", branchPhotoFile ? branchPhotoFile.filename : "TIDAK ADA");

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Validasi email duplikat
    if (email) {
      const emailCheck = await client.query(
        `SELECT id FROM admin WHERE email = $1 AND id != $2 LIMIT 1`,
        [email.toLowerCase().trim(), req.admin.id]
      );
      if (emailCheck.rows.length > 0) {
        await client.query("ROLLBACK");
        if (adminPhotoFile && fs.existsSync(adminPhotoFile.path)) fs.unlinkSync(adminPhotoFile.path);
        if (branchPhotoFile && fs.existsSync(branchPhotoFile.path)) fs.unlinkSync(branchPhotoFile.path);
        return res.status(409).json({
          success: false,
          message: "Email sudah digunakan oleh admin lain",
        });
      }
    }

    // 2. Ambil data saat ini untuk kebutuhan hapus file fisik yang lama
    const currentData = await client.query(
      `SELECT a.photo AS admin_photo, a.branch_id, b.photo AS branch_photo
       FROM admin a
       LEFT JOIN branch b ON a.branch_id = b.id
       WHERE a.id = $1`,
      [req.admin.id]
    );
    const currentAdminPhoto = currentData.rows[0]?.admin_photo;
    const currentBranchPhoto = currentData.rows[0]?.branch_photo;
    const branchId = currentData.rows[0]?.branch_id;

    console.log("Branch ID dari admin ini:", branchId);

    // 3. Update tabel admin
    const adminUpdates = [];
    const adminValues = [];
    let adminParamCount = 1;

    if (email) {
      adminUpdates.push(`email = $${adminParamCount++}`);
      adminValues.push(email.toLowerCase().trim());
    }
    if (phone) {
      adminUpdates.push(`phone = $${adminParamCount++}`);
      adminValues.push(phone.trim());
    }
    if (adminPhotoFile) {
      adminUpdates.push(`photo = $${adminParamCount++}`);
      adminValues.push(adminPhotoFile.filename);
    }

    if (adminUpdates.length > 0) {
      adminUpdates.push(`updated_at = NOW()`);
      adminValues.push(req.admin.id);
      
      console.log("Menjalankan UPDATE Admin...");
      await client.query(
        `UPDATE admin SET ${adminUpdates.join(", ")} WHERE id = $${adminParamCount}`,
        adminValues
      );

      // Hapus foto lama jika diganti baru
      if (adminPhotoFile && currentAdminPhoto) {
        const oldPath = path.join(process.cwd(), "uploads", "admins", currentAdminPhoto);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
    }

    // 4. Update tabel branch
    if (branchId) {
      const branchUpdates = [];
      const branchValues = [];
      let branchParamCount = 1;

      if (branch_name) {
        branchUpdates.push(`name = $${branchParamCount++}`);
        branchValues.push(branch_name.trim());
      }
      if (branch_address) {
        branchUpdates.push(`address = $${branchParamCount++}`);
        branchValues.push(branch_address.trim());
      }
      if (branch_contact) {
        branchUpdates.push(`contact = $${branchParamCount++}`);
        branchValues.push(branch_contact.trim());
      }
      if (operational_hours) {
        branchUpdates.push(`operational_hours = $${branchParamCount++}`);
        const parsed = typeof operational_hours === "string" ? JSON.parse(operational_hours) : operational_hours;
        branchValues.push(JSON.stringify(parsed));
      }
      if (time_slots) {
        branchUpdates.push(`time_slots = $${branchParamCount++}`);
        let slotsArray;
        try {
          slotsArray = typeof time_slots === "string" && time_slots.startsWith("[")
            ? JSON.parse(time_slots)
            : time_slots.split(",").map((s) => s.trim()).filter(Boolean);
        } catch {
          slotsArray = time_slots.split(",").map((s) => s.trim()).filter(Boolean);
        }
        branchValues.push(JSON.stringify(slotsArray));
      }
      if (branchPhotoFile) {
        branchUpdates.push(`photo = $${branchParamCount++}`);
        branchValues.push(branchPhotoFile.filename);
      }

      if (branchUpdates.length > 0) {
        branchUpdates.push(`updated_at = NOW()`);
        branchValues.push(branchId);
        
        console.log("Menjalankan UPDATE Branch...");
        await client.query(
          `UPDATE branch SET ${branchUpdates.join(", ")} WHERE id = $${branchParamCount}`,
          branchValues
        );

        // Hapus foto lama branch jika diganti baru
        if (branchPhotoFile && currentBranchPhoto) {
          const oldPath = path.join(process.cwd(), "uploads", "branches", currentBranchPhoto);
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
      }
    } else if (branchPhotoFile) {
      console.log("⚠️ PERINGATAN: File branch_photo dikirim, tetapi admin ini tidak terikat ke branch_id manapun!");
    }

    await client.query("COMMIT");
    console.log("=== TRANSAKSI BERHASIL DI-COMMIT ===");

    // 5. Ambil data terbaru untuk dikembalikan ke user
    const updatedResult = await client.query(
      `SELECT
         a.id, a.email, a.phone, a.role, a.photo AS admin_photo,
         b.id AS branch_id, b.name AS branch_name, b.address,
         b.contact, b.operational_hours, b.time_slots, b.photo AS branch_photo
       FROM admin a
       LEFT JOIN branch b ON a.branch_id = b.id
       WHERE a.id = $1`,
      [req.admin.id]
    );

    const updated = updatedResult.rows[0];

    return res.status(200).json({
      success: true,
      message: "Profil berhasil diperbarui",
      data: {
        admin: {
          id: updated.id,
          email: updated.email,
          phone: updated.phone,
          role: updated.role,
          photo: updated.admin_photo || null,
        },
        branch: updated.branch_id
          ? {
              id: updated.branch_id,
              name: updated.branch_name,
              address: updated.address,
              contact: updated.contact,
              operational_hours: updated.operational_hours,
              time_slots: updated.time_slots,
              photo: updated.branch_photo || null,
            }
          : null,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("=== TRANSAKSI GAGAL (ROLLBACK) ===");
    console.error("Error Detail:", err.message);

    if (adminPhotoFile && fs.existsSync(adminPhotoFile.path)) fs.unlinkSync(adminPhotoFile.path);
    if (branchPhotoFile && fs.existsSync(branchPhotoFile.path)) fs.unlinkSync(branchPhotoFile.path);

    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan saat menyimpan perubahan",
    });
  } finally {
    client.release();
  }
};

module.exports = { getProfile, updateProfile };