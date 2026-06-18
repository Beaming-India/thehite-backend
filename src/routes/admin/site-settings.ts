import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

type SiteSettings = {
  siteName: string;
  tagline: string;
  siteUrl: string;
  logoUrl: string;
  faviconUrl: string;
  description: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  facebook: string;
  twitter: string;
  instagram: string;
  youtube: string;
  whatsapp: string;
  seoTitle: string;
  seoDescription: string;
  defaultOgImage: string;
  googleAnalyticsId: string;
  maintenanceMode: boolean;
  allowComments: boolean;
  allowRegistrations: boolean;
  requireEmailVerification: boolean;
  articlesPerPage: string;
  contentLanguages: string;
  privacyPolicyUrl: string;
  termsUrl: string;
};

const DEFAULT_SETTINGS: SiteSettings = {
  siteName: "TheHit.in",
  tagline: "निष्पक्ष, स्वतंत्र पत्रकारिता",
  siteUrl: "",
  logoUrl: "",
  faviconUrl: "",
  description: "",
  contactEmail: "",
  contactPhone: "",
  address: "",
  facebook: "",
  twitter: "",
  instagram: "",
  youtube: "",
  whatsapp: "",
  seoTitle: "",
  seoDescription: "",
  defaultOgImage: "",
  googleAnalyticsId: "",
  maintenanceMode: false,
  allowComments: true,
  allowRegistrations: true,
  requireEmailVerification: false,
  articlesPerPage: "20",
  contentLanguages: "hi,en",
  privacyPolicyUrl: "",
  termsUrl: "",
};

async function ensureTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS site_settings (
      key VARCHAR(32) PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function readSettings(): Promise<SiteSettings> {
  await ensureTable();
  const rows = await db.execute(sql`SELECT data FROM site_settings WHERE key = 'main'`);
  if (rows.rows.length > 0) {
    return { ...DEFAULT_SETTINGS, ...(rows.rows[0].data as object) } as SiteSettings;
  }
  return { ...DEFAULT_SETTINGS };
}

async function writeSettings(data: SiteSettings): Promise<SiteSettings> {
  await ensureTable();
  await db.execute(sql`
    INSERT INTO site_settings (key, data, updated_at)
    VALUES ('main', ${JSON.stringify(data)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE
      SET data = ${JSON.stringify(data)}::jsonb,
          updated_at = now()
  `);
  return data;
}

// GET – admin reads full settings
router.get("/admin/site-settings", async (_req, res): Promise<void> => {
  try {
    res.json(await readSettings());
  } catch (err) {
    console.error("site-settings GET error:", err);
    res.status(500).json({ error: { code: "READ_FAILED", message: "Failed to read site settings" } });
  }
});

// PUT – admin saves settings
router.put("/admin/site-settings", async (req, res): Promise<void> => {
  try {
    const current = await readSettings();
    const body = req.body as Partial<SiteSettings>;
    const updated: SiteSettings = { ...current, ...body };
    res.json(await writeSettings(updated));
  } catch (err) {
    console.error("site-settings PUT error:", err);
    res.status(500).json({ error: { code: "WRITE_FAILED", message: "Failed to save site settings" } });
  }
});

export { readSettings as readSiteSettings };
export default router;
