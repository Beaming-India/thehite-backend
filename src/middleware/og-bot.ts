import { type Request, type Response, type NextFunction } from "express";
import { db, articlesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

const BOT_UA = /whatsapp|facebookexternalhit|twitterbot|telegrambot|slackbot|linkedinbot|pinterest|discordbot|googlebot|bingbot|applebot|vkshare|w3c_validator/i;

const PUBLISHED = eq(articlesTable.status, "published");

function esc(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function absoluteUrl(url: string | null | undefined, backendUrl: string): string {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${backendUrl}${url.startsWith("/") ? "" : "/"}${url}`;
}

function ogHtml(opts: {
  title: string;
  description: string;
  image: string;
  url: string;
  siteName: string;
}): string {
  const { title, description, image, url, siteName } = opts;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}"/>
  <meta property="og:type" content="article"/>
  <meta property="og:site_name" content="${esc(siteName)}"/>
  <meta property="og:title" content="${esc(title)}"/>
  <meta property="og:description" content="${esc(description)}"/>
  <meta property="og:image" content="${esc(image)}"/>
  <meta property="og:image:width" content="1200"/>
  <meta property="og:image:height" content="630"/>
  <meta property="og:url" content="${esc(url)}"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${esc(title)}"/>
  <meta name="twitter:description" content="${esc(description)}"/>
  <meta name="twitter:image" content="${esc(image)}"/>
  <meta http-equiv="refresh" content="0; url=${esc(url)}"/>
</head>
<body><p>${esc(title)}</p></body>
</html>`;
}

export async function ogBotMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ua = req.headers["user-agent"] ?? "";
  if (!BOT_UA.test(ua)) {
    next();
    return;
  }

  // Match /article/:slug, /og/article/:slug, /news/:slug, /news/:state/:district/:slug
  const match =
    req.path.match(/^\/(?:og\/)?article\/([^/?#]+)$/) ||
    req.path.match(/^\/news\/[^/?#]+\/[^/?#]+\/([^/?#]+)$/) ||
    req.path.match(/^\/news\/([^/?#]+)$/);

  if (!match) {
    next();
    return;
  }

  const rawSlug = decodeURIComponent(match[1]);
  const siteUrl = process.env.FRONTEND_URL ?? "https://thehit.in";
  const backendUrl = process.env.BACKEND_URL ?? "https://api.thehit.in";

  try {
    // Try exact slug match first
    let [row] = await db
      .select({
        title: articlesTable.title,
        summary: articlesTable.summary,
        coverImageUrl: articlesTable.coverImageUrl,
        slug: articlesTable.slug,
      })
      .from(articlesTable)
      .where(and(eq(articlesTable.slug, rawSlug), PUBLISHED))
      .limit(1);

    // Fallback: try the last segment after final "-" (short ID suffix)
    if (!row && rawSlug.includes("-")) {
      const idSuffix = rawSlug.split("-").pop()!;
      [row] = await db
        .select({
          title: articlesTable.title,
          summary: articlesTable.summary,
          coverImageUrl: articlesTable.coverImageUrl,
          slug: articlesTable.slug,
        })
        .from(articlesTable)
        .where(and(eq(articlesTable.slug, idSuffix), PUBLISHED))
        .limit(1);
    }

    if (!row) {
      next();
      return;
    }

    // Build absolute image URL — prefer cover image, fallback to site logo
    const imageUrl = row.coverImageUrl
      ? absoluteUrl(row.coverImageUrl, backendUrl)
      : `${siteUrl}/og-default.png`;

    const html = ogHtml({
      title: row.title ?? "TheHit.in",
      description: row.summary ?? "TheHit.in - ज़मीनी पत्रकारिता",
      image: imageUrl,
      url: `${siteUrl}/article/${row.slug}`,
      siteName: "TheHit.in",
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(html);
  } catch {
    next();
  }
}
