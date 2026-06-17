import { Router, type IRouter } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";

const router: IRouter = Router();

const SETTINGS_FILE = path.join(process.cwd(), "donation-settings.json");
const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const qrUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".png";
      cb(null, `qr-${Date.now()}-${randomBytes(6).toString("hex")}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files allowed for QR code"));
  },
});

const DEFAULT_SETTINGS = {
  upiId: "",
  upiName: "TheHit.in",
  qrCodeUrl: "",
  bankName: "",
  accountNumber: "",
  ifsc: "",
  accountName: "",
  razorpayKeyId: "",
  donationEnabled: false,
  thankYouMessage: "आपके योगदान के लिए धन्यवाद।",
  campaigns: [] as { id: string; title: string; description: string; goal: string; active: boolean }[],
};

function readSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")) };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

function writeSettings(data: typeof DEFAULT_SETTINGS) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), "utf-8");
}

// GET donation settings
router.get("/admin/donation-settings", (_req, res): void => {
  try {
    res.json(readSettings());
  } catch {
    res.status(500).json({ error: { code: "READ_FAILED", message: "Failed to read donation settings" } });
  }
});

// PUT - save donation settings
router.put("/admin/donation-settings", (req, res): void => {
  try {
    const current = readSettings();
    const body = req.body as Partial<typeof DEFAULT_SETTINGS>;

    // Sanitise campaigns - ensure each has an id
    const campaigns = (body.campaigns ?? current.campaigns).map((c: { id?: string; title?: string; description?: string; goal?: string; active?: boolean }) => ({
      id: c.id || String(Date.now() + Math.random()),
      title: (c.title ?? "").trim(),
      description: (c.description ?? "").trim(),
      goal: String(c.goal ?? ""),
      active: Boolean(c.active),
    }));

    const updated: typeof DEFAULT_SETTINGS = {
      ...current,
      ...body,
      campaigns,
    };

    writeSettings(updated);
    res.json(updated);
  } catch {
    res.status(500).json({ error: { code: "WRITE_FAILED", message: "Failed to save donation settings" } });
  }
});

// POST - upload QR code image
router.post("/admin/donation-settings/upload-qr", qrUpload.single("file"), (req, res): void => {
  if (!req.file) {
    res.status(400).json({ error: { code: "NO_FILE", message: "No file uploaded" } });
    return;
  }
  const base =
    (process.env.BASE_URL ?? "").replace(/\/$/, "") ||
    `${String(req.headers["x-forwarded-proto"] ?? req.protocol)}://${String(req.headers["x-forwarded-host"] ?? req.get("host"))}`;
  const url = `${base}/uploads/${req.file.filename}`;
  res.json({ url });
});

export default router;
