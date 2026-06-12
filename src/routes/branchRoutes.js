const express = require("express");
const router = express.Router();
const {
  getAllBranches,
  createBranch,
  deleteBranch,
} = require("../controllers/branchController");
const { verifyToken, requirePusat } = require("../middleware/authMiddleware");

// Semua route di sini butuh login DAN harus admin pusat
router.use(verifyToken);
router.use(requirePusat);

router.get("/", getAllBranches);
router.post("/", createBranch);
router.delete("/:id", deleteBranch);

module.exports = router;