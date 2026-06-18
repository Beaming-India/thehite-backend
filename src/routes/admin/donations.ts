import { Router, type IRouter } from "express";
import multer from "multer";
import path from "path";
import { randomBytes } from "crypto";
import fs from "fs";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

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

type DonationData = {
  upiId: string;
  upiName: string;
  qrCodeUrl: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  accountName: string;
  razorpayKeyId: string;
  donationEnabled: boolean;
  subtitle: string;
  contactEmail: string;
  thankYouMessage: string;
  campaigns: { id: string; title: string; description: string; goal: string; active: boolean }[];
};

const DEFAULT_DATA: DonationData = {
  upiId: "",
  upiName: "",
  qrCodeUrl: "",
  bankName: "",
  accountNumber: "",
  ifsc: "",
  accountName: "",
  razorpayKeyId: "",
  donationEnabled: false,
  subtitle: "",
  contactEmail: "",
  thankYouMessage: "",
  campaigns: [],
};

// Ensure table exists (auto-create on first use)
async function ensureTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS donation_settings (
      key VARCHAR(32) PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function readSettings(): Promise<DonationData> {
  await ensureTable();
  const rows = await db.execute(sql`SELECT data FROM donation_settings WHERE key = 'main'`);
  if (rows.rows.length > 0) {
    return { ...DEFAULT_DATA, ...(rows.rows[0].data as object) } as DonationData;
  }
  return { ...DEFAULT_DATA };
}

async function writeSettings(data: DonationData): Promise<DonationData> {
  await ensureTable();
  await db.execute(sql`
    INSERT INTO donation_settings (key, data, updated_at)
    VALUES ('main', ${JSON.stringify(data)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE
      SET data = ${JSON.stringify(data)}::jsonb,
          updated_at = now()
  `);
  return data;
}

export { readSettings as readDonationSettings };

// GET donation settings (admin)
router.get("/admin/donation-settings", async (_req, res): Promise<void> => {
  try {
    const settings = await readSettings();
    res.json(settings);
  } catch (err) {
    console.error("donation-settings GET error:", err);
    res.status(500).json({ error: { code: "READ_FAILED", message: "Failed to read donation settings" } });
  }
});

// PUT - save donation settings
router.put("/admin/donation-settings", async (req, res): Promise<void> => {
  try {
    const current = await readSettings();
    const body = req.body as Partial<DonationData>;

    const campaigns = (body.campaigns ?? current.campaigns).map((c) => ({
      id: c.id || String(Date.now() + Math.random()),
      title: (c.title ?? "").trim(),
      description: (c.description ?? "").trim(),
      goal: String(c.goal ?? ""),
      active: Boolean(c.active),
    }));

    const updated: DonationData = {
      ...current,
      ...body,
      campaigns,
    };

    const saved = await writeSettings(updated);
    res.json(saved);
  } catch (err) {
    console.error("donation-settings PUT error:", err);
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
