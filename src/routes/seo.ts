import { Router, type IRouter } from "express";
import { db, articlesTable, categoriesTable, locationsTable } from "@workspace/db";
import { and, desc, eq, or } from "drizzle-orm";

const router: IRouter = Router();

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildArticlePath(slug: string, locType: string | null, locSlug: string | null): string {
  const district = locType === "district" && locSlug ? locSlug : "all";
  return `/news/cg/${district}/${slug}`;
}

router.get("/sitemap.xml", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      slug: articlesTable.slug,
      updatedAt: articlesTable.updatedAt,
      locType: locationsTable.type,
      locSlug: locationsTable.slug,
    })
    .from(articlesTable)
    .leftJoin(locationsTable, eq(locationsTable.id, articlesTable.locationId))
    .where(eq(articlesTable.status, "published"))
    .orderBy(desc(articlesTable.publishedAt))
    .limit(50000);

  const base = process.env.SITE_BASE_URL ?? "";
  const urls = rows
    .map((r) => {
      const loc = `${base}${buildArticlePath(r.slug, r.locType, r.locSlug)}`;
      const lastmod = (r.updatedAt ?? new Date()).toISOString();
      return `  <url><loc>${escapeXml(loc)}</loc><lastmod>${lastmod}</lastmod></url>`;
    })
    .join("\n");

  res.type("application/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
  );
});

router.get("/news-sitemap.xml", async (_req, res): Promise<void> => {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const rows = await db
    .select({
      slug: articlesTable.slug,
      title: articlesTable.title,
      lang: articlesTable.lang,
      publishedAt: articlesTable.publishedAt,
      locType: locationsTable.type,
      locSlug: locationsTable.slug,
    })
    .from(articlesTable)
    .leftJoin(locationsTable, eq(locationsTable.id, articlesTable.locationId))
    .where(eq(articlesTable.status, "published"))
    .orderBy(desc(articlesTable.publishedAt))
    .limit(1000);

  const recent = rows.filter((r) => r.publishedAt && r.publishedAt >= cutoff);
  const base = process.env.SITE_BASE_URL ?? "";
  const urls = recent
    .map((r) => {
      const loc = `${base}${buildArticlePath(r.slug, r.locType, r.locSlug)}`;
      const pubDate = (r.publishedAt ?? new Date()).toISOString();
      return `  <url>
    <loc>${escapeXml(loc)}</loc>
    <news:news>
      <news:publication>
        <news:name>CGAVP News</news:name>
        <news:language>${r.lang || "hi"}</news:language>
      </news:publication>
      <news:publication_date>${pubDate}</news:publication_date>
      <news:title>${escapeXml(r.title)}</news:title>
    </news:news>
  </url>`;
    })
    .join("\n");

  res.type("application/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n${urls}\n</urlset>\n`,
  );
});

async function buildRss(filter?: { categorySlug?: string; districtSlug?: string }): Promise<string> {
  const conds = [eq(articlesTable.status, "published")];
  if (filter?.categorySlug) {
    const [cat] = await db.select().from(categoriesTable).where(eq(categoriesTable.slug, filter.categorySlug));
    if (cat) conds.push(eq(articlesTable.categoryId, cat.id));
  }
  if (filter?.districtSlug) {
    const [loc] = await db
      .select()
      .from(locationsTable)
      .where(and(eq(locationsTable.slug, filter.districtSlug), eq(locationsTable.type, "district")));
    if (loc) conds.push(eq(articlesTable.locationId, loc.id));
  }

  const rows = await db
    .select({
      slug: articlesTable.slug,
      title: articlesTable.title,
      summary: articlesTable.summary,
      publishedAt: articlesTable.publishedAt,
      locType: locationsTable.type,
      locSlug: locationsTable.slug,
    })
    .from(articlesTable)
    .leftJoin(locationsTable, eq(locationsTable.id, articlesTable.locationId))
    .where(and(...conds))
    .orderBy(desc(articlesTable.publishedAt))
    .limit(50);

  const base = process.env.SITE_BASE_URL ?? "";
  const items = rows
    .map((r) => {
      const link = `${base}${buildArticlePath(r.slug, r.locType, r.locSlug)}`;
      const pubDate = (r.publishedAt ?? new Date()).toUTCString();
      return `    <item>
      <title>${escapeXml(r.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXml(r.summary)}</description>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>CGAVP News</title>
    <link>${escapeXml(base || "/")}</link>
    <description>Chhattisgarh Adivasi Vikas Parishad News</description>
${items}
  </channel>
</rss>
`;
}

router.get("/rss", async (_req, res): Promise<void> => {
  res.type("application/rss+xml").send(await buildRss());
});

router.get("/rss/category/:slug", async (req, res): Promise<void> => {
  res.type("application/rss+xml").send(await buildRss({ categorySlug: req.params.slug }));
});

router.get("/rss/district/:slug", async (req, res): Promise<void> => {
  res.type("application/rss+xml").send(await buildRss({ districtSlug: req.params.slug }));
});

// Bot user-agent detection
const BOT_PATTERN = /whatsapp|facebookexternalhit|twitterbot|telegrambot|linkedinbot|slackbot|discordbot|googlebot|bingbot|applebot|pinterest/i;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildOgHtml(opts: {
  title: string;
  description: string;
  image: string;
  url: string;
  siteName: string;
}): string {
  const { title, description, image, url, siteName } = opts;
  return `<!DOCTYPE html>
<html lang="hi">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="${escapeHtml(siteName)}" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="${escapeHtml(image)}" />
  <meta property="og:url" content="${escapeHtml(url)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(image)}" />
  <meta http-equiv="refresh" content="0; url=${escapeHtml(url)}" />
</head>
<body>
  <p><a href="${escapeHtml(url)}">${escapeHtml(title)}</a></p>
</body>
</html>`;
}

// Prerender endpoint for social bots — called by Nginx when User-Agent is a crawler
// Nginx rule: if ($http_user_agent ~* "whatsapp|facebookexternalhit|twitterbot|telegrambot") {
//   proxy_pass http://backend/api/prerender$request_uri;
// }
router.get("/prerender/news/:slug", async (req, res): Promise<void> => {
  await serveArticleOg(req.params.slug, req, res);
});

router.get("/prerender/news/:state/:district/:slug", async (req, res): Promise<void> => {
  await serveArticleOg(req.params.slug, req, res);
});

// Auto bot-detection: serve OG HTML directly when bot hits /news/* routes
router.get("/bot/news/:slug", async (req, res): Promise<void> => {
  await serveArticleOg(req.params.slug, req, res);
});

async function serveArticleOg(slug: string, req: any, res: any): Promise<void> {
  const base = process.env.SITE_BASE_URL ?? "https://thehit.in";
  const siteName = process.env.SITE_NAME ?? "TheHit.in";

  const [row] = await db
    .select({
      title: articlesTable.title,
      summary: articlesTable.summary,
      coverImageUrl: articlesTable.coverImageUrl,
      slug: articlesTable.slug,
      locType: locationsTable.type,
      locSlug: locationsTable.slug,
    })
    .from(articlesTable)
    .leftJoin(locationsTable, eq(locationsTable.id, articlesTable.locationId))
    .where(and(eq(articlesTable.slug, slug), eq(articlesTable.status, "published")));

  if (!row) {
    res.status(404).send("Not found");
    return;
  }

  const articlePath = buildArticlePath(row.slug, row.locType, row.locSlug);
  const url = `${base}${articlePath}`;
  const image = row.coverImageUrl ?? `${base}/logo.png`;

  res.type("text/html").send(
    buildOgHtml({
      title: `${row.title} | ${siteName}`,
      description: row.summary ?? "",
      image,
      url,
      siteName,
    }),
  );
}

export default router;
