import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import multer from "multer";
import path from "path";
import { randomBytes } from "crypto";
import fs from "fs";
import { db, donationsTable } from "@workspace/db";
import { sql, desc, eq } from "drizzle-orm";

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

type UpiAccount = { id: string; upiId: string; upiName: string; qrCodeUrl: string };

type DonationData = {
  upiAccounts: UpiAccount[];
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
  upiAccounts: [],
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

async function ensureSettingsTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS donation_settings (
      key VARCHAR(32) PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function readSettings(): Promise<DonationData> {
  await ensureSettingsTable();
  const rows = await db.execute(sql`SELECT data FROM donation_settings WHERE key = 'main'`);
  if (rows.rows.length > 0) {
    return { ...DEFAULT_DATA, ...(rows.rows[0].data as object) } as DonationData;
  }
  return { ...DEFAULT_DATA };
}

async function writeSettings(data: DonationData): Promise<DonationData> {
  await ensureSettingsTable();
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

// ── Donation Settings ─────────────────────────────────────────────────────────

router.get("/admin/donation-settings", async (_req, res): Promise<void> => {
  try {
    const settings = await readSettings();
    res.json(settings);
  } catch (err) {
    console.error("donation-settings GET error:", err);
    res.status(500).json({ error: { code: "READ_FAILED", message: "Failed to read donation settings" } });
  }
});

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

    const upiAccounts = (body.upiAccounts ?? current.upiAccounts ?? []).map((u) => ({
      id: u.id || String(Date.now() + Math.random()),
      upiId: (u.upiId ?? "").trim(),
      upiName: (u.upiName ?? "").trim(),
      qrCodeUrl: u.qrCodeUrl ?? "",
    }));

    const updated: DonationData = { ...current, ...body, campaigns, upiAccounts };
    const saved = await writeSettings(updated);
    res.json(saved);
  } catch (err) {
    console.error("donation-settings PUT error:", err);
    res.status(500).json({ error: { code: "WRITE_FAILED", message: "Failed to save donation settings" } });
  }
});

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

// ── Donation History ──────────────────────────────────────────────────────────

const VALID_METHODS = ["upi", "bank", "razorpay", "cash", "other"] as const;
const VALID_STATUSES = ["completed", "pending", "failed"] as const;

type DonationFields = {
  donorName?: string;
  donorEmail?: string;
  donorPhone?: string;
  amount: number;
  method?: string;
  receivedUpiId?: string;
  transactionId?: string;
  campaignId?: string;
  note?: string;
  status?: string;
  createdAt?: string;
};

function parseDonationFields(b: Record<string, unknown>, requireAmount = true): { data: DonationFields } | { error: string } {
  if (requireAmount && (!b.amount || typeof b.amount !== "number" || b.amount <= 0)) {
    return { error: "amount must be a positive number" };
  }
  return {
    data: {
      donorName: typeof b.donorName === "string" ? b.donorName.slice(0, 255) : undefined,
      donorEmail: typeof b.donorEmail === "string" ? b.donorEmail.slice(0, 255) : undefined,
      donorPhone: typeof b.donorPhone === "string" ? b.donorPhone.slice(0, 20) : undefined,
      amount: typeof b.amount === "number" ? Math.floor(b.amount) : 0,
      method: VALID_METHODS.includes(b.method as typeof VALID_METHODS[number]) ? (b.method as string) : "upi",
      receivedUpiId: typeof b.receivedUpiId === "string" ? b.receivedUpiId.slice(0, 255) : undefined,
      transactionId: typeof b.transactionId === "string" ? b.transactionId.slice(0, 255) : undefined,
      campaignId: typeof b.campaignId === "string" ? b.campaignId.slice(0, 64) : undefined,
      note: typeof b.note === "string" ? b.note : undefined,
      status: VALID_STATUSES.includes(b.status as typeof VALID_STATUSES[number]) ? (b.status as string) : "completed",
      createdAt: typeof b.createdAt === "string" ? b.createdAt : undefined,
    },
  };
}

// GET /admin/donations — list all donations (newest first)
router.get("/admin/donations", async (req, res): Promise<void> => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Number(req.query.offset ?? 0);

    const rows = await db
      .select()
      .from(donationsTable)
      .orderBy(desc(donationsTable.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(donationsTable);

    res.json({ donations: rows, total: count, limit, offset });
  } catch (err) {
    console.error("donations GET error:", err);
    res.status(500).json({ error: { code: "READ_FAILED", message: "Failed to read donations" } });
  }
});

// POST /admin/donations — manually record a donation
router.post("/admin/donations", async (req, res): Promise<void> => {
  const parsed = parseDonationFields(req.body as Record<string, unknown>, true);
  if ("error" in parsed) {
    res.status(400).json({ error: { code: "VALIDATION", message: parsed.error } });
    return;
  }
  try {
    const { createdAt, ...rest } = parsed.data;
    const [row] = await db
      .insert(donationsTable)
      .values({
        id: randomUUID(),
        ...rest,
        createdAt: createdAt ? new Date(createdAt) : new Date(),
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("donations POST error:", err);
    res.status(500).json({ error: { code: "CREATE_FAILED", message: "Failed to record donation" } });
  }
});

// PUT /admin/donations/:id — edit a donation record
router.put("/admin/donations/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const parsed = parseDonationFields(req.body as Record<string, unknown>, false);
  if ("error" in parsed) {
    res.status(400).json({ error: { code: "VALIDATION", message: parsed.error } });
    return;
  }
  try {
    const { createdAt, amount, ...rest } = parsed.data;
    const setValues: Record<string, unknown> = { ...rest };
    if (amount > 0) setValues.amount = amount;
    if (createdAt) setValues.createdAt = new Date(createdAt);

    const [updated] = await db
      .update(donationsTable)
      .set(setValues)
      .where(eq(donationsTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Donation not found" } });
      return;
    }
    res.json(updated);
  } catch (err) {
    console.error("donations PUT error:", err);
    res.status(500).json({ error: { code: "UPDATE_FAILED", message: "Failed to update donation" } });
  }
});

// DELETE /admin/donations/:id — delete a donation record
router.delete("/admin/donations/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  try {
    const [deleted] = await db
      .delete(donationsTable)
      .where(eq(donationsTable.id, id))
      .returning({ id: donationsTable.id });

    if (!deleted) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Donation not found" } });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("donations DELETE error:", err);
    res.status(500).json({ error: { code: "DELETE_FAILED", message: "Failed to delete donation" } });
  }
});

export default router;
