const express = require("express");
const router = express.Router();
const { getProfile, updateProfile } = require("../controllers/profileController");
const { verifyToken } = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");

router.use(verifyToken);

router.get("/", getProfile);

router.put(
  "/",
  // Sebelumnya: upload.single("photo")
  // Sekarang handle 2 field file sekaligus
  upload.fields([
    { name: "photo", maxCount: 1 },         // foto admin
    { name: "branch_photo", maxCount: 1 },  // foto branch
  ]),
  (err, req, res, next) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message || "Upload gagal",
      });
    }
    next();
  },
  updateProfile
);

module.exports = router;