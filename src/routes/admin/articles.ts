import { Router, type IRouter } from "express";
import {
  db,
  articlesTable,
  categoriesTable,
  locationsTable,
  usersTable,
  userProfilesTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import {
  ListAdminArticlesQueryParams,
  ListAdminArticlesResponse,
  ApproveArticleParams,
  ApproveArticleResponse,
  RejectArticleBody,
  RejectArticleResponse,
  RequestArticleChangesParams,
  RequestArticleChangesBody,
  RequestArticleChangesResponse,
  UpdateArticleFlagsParams,
  UpdateArticleFlagsBody,
  UpdateArticleFlagsResponse,
  GetAdminArticleParams,
  GetAdminArticleResponse,
  AdminUpdateArticleParams,
  AdminUpdateArticleBody,
  AdminUpdateArticleResponse,
  AdminDeleteArticleParams,
  AdminDeleteArticleResponse,
} from "@workspace/api-zod";
import { audit } from "../../utils/audit";
import { mapMyArticle } from "../../utils/mappers";
import { slugify } from "../../utils/slug";
import { sendBreakingNewsPush, sendFollowedWriterPush } from "../../lib/push";

async function loadFullArticle(id: string) {
  const [row] = await db
    .select({ article: articlesTable, category: categoriesTable, location: locationsTable })
    .from(articlesTable)
    .leftJoin(categoriesTable, eq(categoriesTable.id, articlesTable.categoryId))
    .leftJoin(locationsTable, eq(locationsTable.id, articlesTable.locationId))
    .where(eq(articlesTable.id, id));
  if (!row) return null;
  return mapMyArticle({ article: row.article, category: row.category, location: row.location, writer: null });
}

const router: IRouter = Router();

router.get("/admin/articles", async (req, res): Promise<void> => {
  const q = ListAdminArticlesQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }

  const conds = [];
  if (q.data.status && q.data.status !== "all") conds.push(eq(articlesTable.status, q.data.status));

  const rows = await db
    .select({
      article: articlesTable,
      category: categoriesTable,
      location: locationsTable,
      writer: usersTable,
      profile: userProfilesTable,
    })
    .from(articlesTable)
    .leftJoin(categoriesTable, eq(categoriesTable.id, articlesTable.categoryId))
    .leftJoin(locationsTable, eq(locationsTable.id, articlesTable.locationId))
    .leftJoin(usersTable, eq(usersTable.id, articlesTable.writerId))
    .leftJoin(userProfilesTable, eq(userProfilesTable.userId, articlesTable.writerId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(articlesTable.updatedAt))
    .limit(q.data.limit);

  const items = rows.map((r) => ({
    ...mapMyArticle({ article: r.article, category: r.category, location: r.location, writer: null }),
    writer: r.writer
      ? {
          id: r.writer.id,
          displayName: r.profile?.displayName ?? r.writer.email ?? "Writer",
          profileImageUrl: r.writer.profileImageUrl,
          verified: r.profile?.isVerified ?? false,
        }
      : undefined,
  }));
  res.json(ListAdminArticlesResponse.parse(items));
});

router.get("/admin/articles/:id", async (req, res): Promise<void> => {
  const p = GetAdminArticleParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const full = await loadFullArticle(p.data.id);
  if (!full) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } }); return; }
  res.json(GetAdminArticleResponse.parse(full));
});

router.patch("/admin/articles/:id", async (req, res): Promise<void> => {
  const p = AdminUpdateArticleParams.safeParse(req.params);
  const b = AdminUpdateArticleBody.safeParse(req.body);
  if (!p.success || !b.success) {
    res.status(400).json({ error: p.success ? b.error?.message : p.error.message });
    return;
  }
  const [existing] = await db.select().from(articlesTable).where(eq(articlesTable.id, p.data.id));
  if (!existing) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } }); return; }

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (b.data.title !== undefined) { update.title = b.data.title; }
  if (b.data.summary !== undefined) update.summary = b.data.summary;
  if (b.data.body !== undefined) {
    update.body = b.data.body;
    const wordCount = b.data.body.replace(/<[^>]*>/g, "").trim().split(/\s+/).filter(Boolean).length;
    update.readingTimeMin = Math.max(1, Math.round(wordCount / 200));
  }
  if (b.data.lang !== undefined) update.lang = b.data.lang;
  if ("coverImageUrl" in b.data) update.coverImageUrl = b.data.coverImageUrl;
  if ("youtubeUrl" in b.data) update.youtubeUrl = b.data.youtubeUrl;
  if ("categoryId" in b.data) update.categoryId = b.data.categoryId;
  if ("locationId" in b.data) update.locationId = b.data.locationId;
  if (b.data.tags !== undefined) update.tags = b.data.tags;
  if (b.data.status !== undefined) {
    update.status = b.data.status;
    if (b.data.status === "published" && !existing.publishedAt) update.publishedAt = new Date();
  }
  if (b.data.isBreaking !== undefined) update.isBreaking = b.data.isBreaking;
  if (b.data.isFeatured !== undefined) update.isFeatured = b.data.isFeatured;
  if (b.data.isPinned !== undefined) update.isPinned = b.data.isPinned;

  const [a] = await db.update(articlesTable).set(update).where(eq(articlesTable.id, p.data.id)).returning();
  if (!a) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } }); return; }
  await audit(req.user!.id, "article.edit", "article", a.id);
  if (b.data.status === "published" && existing.status !== "published" && a.isBreaking) {
    void sendBreakingNewsPush({ articleId: a.id, slug: a.slug, title: a.title, summary: a.summary, categoryId: a.categoryId, locationId: a.locationId });
  }
  res.json(AdminUpdateArticleResponse.parse(await loadFullArticle(a.id)));
});

router.delete("/admin/articles/:id", async (req, res): Promise<void> => {
  const p = AdminDeleteArticleParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [deleted] = await db.delete(articlesTable).where(eq(articlesTable.id, p.data.id)).returning();
  if (!deleted) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } }); return; }
  await audit(req.user!.id, "article.delete", "article", deleted.id);
  res.json(AdminDeleteArticleResponse.parse({ id: deleted.id }));
});

router.post("/admin/articles/:id/approve", async (req, res): Promise<void> => {
  const p = ApproveArticleParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [a] = await db
    .update(articlesTable)
    .set({ status: "published", publishedAt: new Date(), moderationNote: null })
    .where(eq(articlesTable.id, p.data.id))
    .returning();
  if (!a) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } }); return; }
  await audit(req.user!.id, "article.approve", "article", a.id);
  if (a.isBreaking) {
    void sendBreakingNewsPush({ articleId: a.id, slug: a.slug, title: a.title, summary: a.summary, categoryId: a.categoryId, locationId: a.locationId });
  }
  void sendFollowedWriterPush({ articleId: a.id, slug: a.slug, title: a.title, writerId: a.writerId });
  res.json(ApproveArticleResponse.parse(await loadFullArticle(a.id)));
});

router.post("/admin/articles/:id/reject", async (req, res): Promise<void> => {
  const p = ApproveArticleParams.safeParse(req.params);
  const b = RejectArticleBody.safeParse(req.body);
  if (!p.success || !b.success) {
    res.status(400).json({ error: p.success ? b.error?.message : p.error.message });
    return;
  }
  const [a] = await db
    .update(articlesTable)
    .set({ status: "rejected", moderationNote: b.data.note })
    .where(eq(articlesTable.id, p.data.id))
    .returning();
  if (!a) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } }); return; }
  await audit(req.user!.id, "article.reject", "article", a.id, b.data.note);
  res.json(RejectArticleResponse.parse(await loadFullArticle(a.id)));
});

router.post("/admin/articles/:id/request-changes", async (req, res): Promise<void> => {
  const p = RequestArticleChangesParams.safeParse(req.params);
  const b = RequestArticleChangesBody.safeParse(req.body);
  if (!p.success || !b.success) {
    res.status(400).json({ error: p.success ? b.error?.message : p.error.message });
    return;
  }
  const [a] = await db
    .update(articlesTable)
    .set({ status: "changes_requested", moderationNote: b.data.note })
    .where(eq(articlesTable.id, p.data.id))
    .returning();
  if (!a) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } }); return; }
  await audit(req.user!.id, "article.request_changes", "article", a.id, b.data.note);
  res.json(RequestArticleChangesResponse.parse(await loadFullArticle(a.id)));
});

router.patch("/admin/articles/:id/flags", async (req, res): Promise<void> => {
  const p = UpdateArticleFlagsParams.safeParse(req.params);
  const b = UpdateArticleFlagsBody.safeParse(req.body);
  if (!p.success || !b.success) {
    res.status(400).json({ error: p.success ? b.error?.message : p.error.message });
    return;
  }
  const update: Record<string, unknown> = {};
  if (b.data.isBreaking !== undefined) update.isBreaking = b.data.isBreaking;
  if (b.data.isFeatured !== undefined) update.isFeatured = b.data.isFeatured;
  if (b.data.isPinned !== undefined) update.isPinned = b.data.isPinned;
  const [prev] = await db.select().from(articlesTable).where(eq(articlesTable.id, p.data.id));
  const [a] = await db.update(articlesTable).set(update).where(eq(articlesTable.id, p.data.id)).returning();
  if (!a) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Article not found" } }); return; }
  await audit(req.user!.id, "article.update_flags", "article", a.id);
  if (b.data.isBreaking === true && prev && !prev.isBreaking && a.status === "published") {
    void sendBreakingNewsPush({ articleId: a.id, slug: a.slug, title: a.title, summary: a.summary, categoryId: a.categoryId, locationId: a.locationId });
  }
  res.json(UpdateArticleFlagsResponse.parse(await loadFullArticle(a.id)));
});

export default router;
