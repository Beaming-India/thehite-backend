import { type Request, type Response, type NextFunction } from "express";
import { db, articlesTable, categoriesTable, locationsTable } from "@workspace/db";
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
  <meta property="og:url" content="${esc(url)}"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${esc(title)}"/>
  <meta name="twitter:description" content="${esc(description)}"/>
  <meta name="twitter:image" content="${esc(image)}"/>
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

  // Only handle /og/article/:slug
  const match = req.path.match(/^\/og\/article\/([^/?#]+)$/);
  if (!match) {
    next();
    return;
  }

  const slug = match[1];
  try {
    const [row] = await db
      .select({
        title: articlesTable.title,
        summary: articlesTable.summary,
        coverImageUrl: articlesTable.coverImageUrl,
        slug: articlesTable.slug,
      })
      .from(articlesTable)
      .where(and(eq(articlesTable.slug, slug), PUBLISHED))
      .limit(1);

    if (!row) {
      next();
      return;
    }

    const siteUrl = process.env.FRONTEND_URL ?? "https://thehit.in";
    const html = ogHtml({
      title: row.title,
      description: row.summary,
      image: row.coverImageUrl ?? `${siteUrl}/logo.png`,
      url: `${siteUrl}/article/${row.slug}`,
      siteName: "TheHit.in",
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch {
    next();
  }
}
