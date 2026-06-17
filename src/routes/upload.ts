import { Router, type IRouter } from "express";
import multer from "multer";
import path from "path";
import { randomBytes } from "crypto";
import fs from "fs";
import { requireAdmin } from "../middleware/requireRole";

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `${Date.now()}-${randomBytes(8).toString("hex")}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/"))
      cb(null, true);
    else cb(new Error("Only image and video files are allowed"));
  },
});

const router: IRouter = Router();
router.use(requireAdmin);

router.post("/admin/upload", upload.single("file"), (req, res): void => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  const base = process.env.BASE_URL?.replace(/\/$/, "")
    ?? `${req.headers["x-forwarded-proto"] ?? req.protocol}://${req.headers["x-forwarded-host"] ?? req.get("host")}`;
  res.json({ url: `${base}/uploads/${req.file.filename}` });
});

export default router;
