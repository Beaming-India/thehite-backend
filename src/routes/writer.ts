import { Router, type IRouter } from "express";
import {
  db,
  articlesTable,
  categoriesTable,
  locationsTable,
  userProfilesTable,
} from "@workspace/db";
import { and, desc, eq, sql, gte } from "drizzle-orm";
import {
  GetWriterDashboardResponse,
  ListMyAuthoredArticlesQueryParams,
  ListMyAuthoredArticlesResponse,
  CreateMyArticleBody,
  GetMyAuthoredArticleParams,
  GetMyAuthoredArticleResponse,
  UpdateMyAuthoredArticleParams,
  UpdateMyAuthoredArticleBody,
  UpdateMyAuthoredArticleResponse,
  DeleteMyAuthoredArticleParams,
  DeleteMyAuthoredArticleResponse,
  SubmitMyAuthoredArticleParams,
  SubmitMyAuthoredArticleResponse,
} from "@workspace/api-zod";
import { requireWriter } from "../middleware/requireRole";
import { mapMyArticle } from "../utils/mappers";
import { slugify } from "../utils/slug";

const router: IRouter = Router();
router.use(requireWriter);

async function joined(where: ReturnType<typeof and>) {
  const rows = await db
    .select({
      article: articlesTable,
      category: categoriesTable,
      location: locationsTable,
    })
    .from(articlesTable)
    .leftJoin(categoriesTable, eq(categoriesTable.id, articlesTable.categoryId))
    .leftJoin(locationsTable, eq(locationsTable.id, articlesTable.locationId))
    .where(where)
    .orderBy(desc(articlesTable.updatedAt));
  return rows.map((r) =>
    mapMyArticle({
      article: r.article,
      category: r.category,
      location: r.location,
      writer: null,
    }),
  );
}

router.get("/writer/dashboard", async (req, res): Promise<void> => {
  const uid = req.user!.id;
  const articles = await joined(eq(articlesTable.writerId, uid));
  const totalArticles = articles.length;
  const published = articles.filter((a) => a.status === "published").length;
  const pending = articles.filter((a) => a.status === "pending").length;
  const drafts = articles.filter((a) => a.status === "draft" || a.status === "changes_requested" || a.status === "rejected").length;
  const totalViews = articles.reduce((s, a) => s + a.viewCount, 0);
  const totalLikes = articles.reduce((s, a) => s + a.likeCount, 0);
  const totalComments = articles.reduce((s, a) => s + a.commentCount, 0);

  const [profile] = await db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, uid));

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const viewsByDay = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${articlesTable.publishedAt}), 'YYYY-MM-DD')`,
      views: sql<number>`sum(${articlesTable.viewCount})::int`,
    })
    .from(articlesTable)
    .where(and(eq(articlesTable.writerId, uid), gte(articlesTable.publishedAt, since)))
    .groupBy(sql`date_trunc('day', ${articlesTable.publishedAt})`)
    .orderBy(sql`date_trunc('day', ${articlesTable.publishedAt})`);

  res.json(
    GetWriterDashboardResponse.parse({
      stats: {
        totalArticles,
        published,
        pending,
        drafts,
        totalViews,
        totalLikes,
        totalComments,
        followers: profile?.followerCount ?? 0,
      },
      recentArticles: articles.slice(0, 8),
      viewsByDay: viewsByDay.map((v) => ({ date: v.day, views: Number(v.views ?? 0) })),
    }),
  );
});

router.get("/writer/articles", async (req, res): Promise<void> => {
  const q = ListMyAuthoredArticlesQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const conds = [eq(articlesTable.writerId, req.user!.id)];
  if (q.data.status && q.data.status !== "all") conds.push(eq(articlesTable.status, q.data.status));
  const items = await joined(and(...conds));
  res.json(ListMyAuthoredArticlesResponse.parse(items));
});

router.post("/writer/articles", async (req, res): Promise<void> => {
  const b = CreateMyArticleBody.safeParse(req.body);
  if (!b.success) {
    res.status(400).json({ error: b.error.message });
    return;
  }

  // Find the next numeric blog slug suffix
  const { rows: [maxRow] } = await db.execute(sql`
    SELECT max(cast(substring(slug from '^blog-([0-9]+)$') as integer)) as max_no
    FROM ${articlesTable}
    WHERE slug ~ '^blog-[0-9]+$'
  `);
  const nextNo = (Number((maxRow as any)?.max_no) || 0) + 1;
  const slug = `blog-${nextNo}`;

  const [a] = await db
    .insert(articlesTable)
    .values({
      writerId: req.user!.id,
      slug,
      title: b.data.title,
      summary: b.data.summary,
      body: b.data.body,
      coverImageUrl: b.data.coverImageUrl ?? null,
      youtubeUrl: b.data.youtubeUrl ?? null,
      lang: b.data.lang,
      categoryId: b.data.categoryId ?? null,
      locationId: b.data.locationId ?? null,
      tags: b.data.tags ?? [],
      status: "draft",
    })
    .returning();

  const items = await joined(eq(articlesTable.id, a.id));
  res.status(201).json(GetMyAuthoredArticleResponse.parse(items[0]));
});

router.get("/writer/articles/:id", async (req, res): Promise<void> => {
  const p = GetMyAuthoredArticleParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  const items = await joined(
    and(eq(articlesTable.id, p.data.id), eq(articlesTable.writerId, req.user!.id)),
  );
  if (!items.length) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } });
    return;
  }
  res.json(GetMyAuthoredArticleResponse.parse(items[0]));
});

router.patch("/writer/articles/:id", async (req, res): Promise<void> => {
  const p = UpdateMyAuthoredArticleParams.safeParse(req.params);
  const b = UpdateMyAuthoredArticleBody.safeParse(req.body);
  if (!p.success || !b.success) {
    res.status(400).json({ error: p.success ? b.error?.message : p.error.message });
    return;
  }
  const update: Record<string, unknown> = {};
  for (const k of [
    "title",
    "summary",
    "body",
    "coverImageUrl",
    "youtubeUrl",
    "lang",
    "categoryId",
    "locationId",
    "tags",
  ] as const) {
    if (b.data[k] !== undefined) update[k] = b.data[k];
  }
  const [a] = await db
    .update(articlesTable)
    .set(update)
    .where(and(eq(articlesTable.id, p.data.id), eq(articlesTable.writerId, req.user!.id)))
    .returning();
  if (!a) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } });
    return;
  }
  // If was rejected/changes_requested, move to draft so user can resubmit
  if (a.status === "rejected" || a.status === "changes_requested") {
    await db
      .update(articlesTable)
      .set({ status: "draft", moderationNote: null })
      .where(eq(articlesTable.id, a.id));
  }
  const items = await joined(eq(articlesTable.id, a.id));
  res.json(UpdateMyAuthoredArticleResponse.parse(items[0]));
});

router.delete("/writer/articles/:id", async (req, res): Promise<void> => {
  const p = DeleteMyAuthoredArticleParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  const [a] = await db
    .delete(articlesTable)
    .where(and(eq(articlesTable.id, p.data.id), eq(articlesTable.writerId, req.user!.id)))
    .returning();
  if (!a) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } });
    return;
  }
  res.json(DeleteMyAuthoredArticleResponse.parse({ deleted: true }));
});

router.post("/writer/articles/:id/submit", async (req, res): Promise<void> => {
  const p = SubmitMyAuthoredArticleParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  const [a] = await db
    .update(articlesTable)
    .set({ status: "pending" })
    .where(
      and(
        eq(articlesTable.id, p.data.id),
        eq(articlesTable.writerId, req.user!.id),
      ),
    )
    .returning();
  if (!a) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } });
    return;
  }
  const items = await joined(eq(articlesTable.id, a.id));
  res.json(SubmitMyAuthoredArticleResponse.parse(items[0]));
});

export default router;
