const multer = require("multer");
const path = require("path");
const fs = require("fs");

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let subfolder = "admins";
    if (file.fieldname === "branch_photo") subfolder = "branches";
    if (file.fieldname === "staff_image")  subfolder = "staffs";
    if (file.fieldname === "user_photo")   subfolder = "users";

    const uploadPath = path.join(process.cwd(), "uploads", subfolder);
    ensureDir(uploadPath);
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();

    let prefix = "file";
    let id = "unknown";

    if (file.fieldname === "user_photo") {
      prefix = "user";
      id = req.user?.id || "x";
    } else if (file.fieldname === "branch_photo") {
      prefix = "branch";
      id = req.admin?.branch_id || "x";
    } else if (file.fieldname === "staff_image") {
      prefix = "staff";
      id = req.admin?.branch_id || "x";
    } else {
      prefix = "admin";
      id = req.admin?.id || "x";
    }

    cb(null, `${prefix}_${id}_${Date.now()}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  // BENAR: Tambahkan 'image/jpeg' ke dalam pengecekan
  if (
    file.mimetype === 'image/jpeg' || 
    file.mimetype === 'image/jpg' || 
    file.mimetype === 'image/png'
  ) {
    cb(null, true);
  } else {
    cb(new Error('Unsupported file type: ' + file.mimetype + '. Only images (jpg, jpeg, png) are allowed!'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 2 * 1024 * 1024,
  },
});

module.exports = upload;