const express = require("express");
const router = express.Router();
const {
  getAllBranches,
  createBranch,
  updateBranch, // <-- Pastikan ini di-import
  deleteBranch,
} = require("../controllers/branchController");
const { verifyToken, requirePusat } = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware"); // <-- Import middleware upload

// Semua route di sini butuh login DAN harus admin pusat
router.use(verifyToken);
router.use(requirePusat);

router.get("/", getAllBranches);

// Gunakan upload.single("branch_photo") agar req.file bisa terbaca di controller
router.post("/", upload.single("branch_photo"), createBranch);

// Rute PUT untuk mengedit cabang dan mengupdate foto
router.put("/:id", upload.single("branch_photo"), updateBranch);

router.delete("/:id", deleteBranch);

module.exports = router;