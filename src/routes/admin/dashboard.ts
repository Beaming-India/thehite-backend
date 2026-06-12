import { Router, type IRouter } from "express";
import {
  db,
  articlesTable,
  categoriesTable,
  locationsTable,
  usersTable,
  userProfilesTable,
  commentsTable,
  followsLocationsTable,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { GetAdminDashboardStatsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/admin/stats", async (_req, res): Promise<void> => {
  const [{ articles }] = await db
    .select({ articles: sql<number>`count(*)::int` })
    .from(articlesTable);
  const [{ published }] = await db
    .select({ published: sql<number>`count(*)::int` })
    .from(articlesTable)
    .where(eq(articlesTable.status, "published"));
  const [{ pending }] = await db
    .select({ pending: sql<number>`count(*)::int` })
    .from(articlesTable)
    .where(eq(articlesTable.status, "pending"));
  const [{ writers }] = await db
    .select({ writers: sql<number>`count(*)::int` })
    .from(userProfilesTable)
    .where(inArray(userProfilesTable.role, ["writer", "super_admin", "state_admin", "district_admin"]));
  const [{ readers }] = await db
    .select({ readers: sql<number>`count(*)::int` })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.role, "reader"));
  const [{ comments }] = await db
    .select({ comments: sql<number>`count(*)::int` })
    .from(commentsTable);
  const [{ totalViews }] = await db
    .select({ totalViews: sql<number>`coalesce(sum(${articlesTable.viewCount}),0)::int` })
    .from(articlesTable);

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const publishedByDay = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${articlesTable.publishedAt}), 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(articlesTable)
    .where(and(eq(articlesTable.status, "published"), gte(articlesTable.publishedAt, since)))
    .groupBy(sql`date_trunc('day', ${articlesTable.publishedAt})`)
    .orderBy(sql`date_trunc('day', ${articlesTable.publishedAt})`);

  const byCategory = await db
    .select({
      categoryId: articlesTable.categoryId,
      slug: categoriesTable.slug,
      nameHi: categoriesTable.nameHi,
      nameEn: categoriesTable.nameEn,
      count: sql<number>`count(*)::int`,
    })
    .from(articlesTable)
    .leftJoin(categoriesTable, eq(categoriesTable.id, articlesTable.categoryId))
    .where(eq(articlesTable.status, "published"))
    .groupBy(articlesTable.categoryId, categoriesTable.slug, categoriesTable.nameHi, categoriesTable.nameEn);

  const byLocation = await db
    .select({
      locationId: articlesTable.locationId,
      slug: locationsTable.slug,
      type: locationsTable.type,
      nameHi: locationsTable.nameHi,
      nameEn: locationsTable.nameEn,
      count: sql<number>`count(*)::int`,
    })
    .from(articlesTable)
    .leftJoin(locationsTable, eq(locationsTable.id, articlesTable.locationId))
    .where(eq(articlesTable.status, "published"))
    .groupBy(articlesTable.locationId, locationsTable.slug, locationsTable.type, locationsTable.nameHi, locationsTable.nameEn);

  const recentRows = await db
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
    .where(eq(articlesTable.status, "published"))
    .orderBy(desc(articlesTable.publishedAt))
    .limit(8);

  const recentlyPublished = recentRows.map((r) => ({
    id: r.article.id,
    slug: r.article.slug,
    title: r.article.title,
    summary: r.article.summary,
    coverImageUrl: r.article.coverImageUrl,
    lang: r.article.lang as "hi" | "en",
    publishedAt: r.article.publishedAt,
    viewCount: r.article.viewCount,
    likeCount: r.article.likeCount,
    commentCount: r.article.commentCount,
    shareCount: r.article.shareCount,
    isBreaking: r.article.isBreaking,
    isFeatured: r.article.isFeatured,
    category: r.category ?? undefined,
    location: r.location ?? undefined,
    writer: r.writer
      ? {
          id: r.writer.id,
          displayName: r.profile?.displayName ?? r.writer.email ?? "Writer",
          profileImageUrl: r.writer.profileImageUrl,
          verified: r.profile?.isVerified ?? false,
        }
      : undefined,
  }));

  const topWriters = await db
    .select({
      id: usersTable.id,
      displayName: userProfilesTable.displayName,
      profileImageUrl: usersTable.profileImageUrl,
      verified: userProfilesTable.isVerified,
      bio: userProfilesTable.bio,
      followerCount: userProfilesTable.followerCount,
      articleCount: sql<number>`count(${articlesTable.id})::int`,
    })
    .from(usersTable)
    .innerJoin(userProfilesTable, eq(userProfilesTable.userId, usersTable.id))
    .leftJoin(
      articlesTable,
      and(eq(articlesTable.writerId, usersTable.id), eq(articlesTable.status, "published")),
    )
    .where(inArray(userProfilesTable.role, ["writer", "super_admin", "state_admin", "district_admin"]))
    .groupBy(
      usersTable.id,
      userProfilesTable.displayName,
      usersTable.profileImageUrl,
      userProfilesTable.isVerified,
      userProfilesTable.bio,
      userProfilesTable.followerCount,
    )
    .orderBy(desc(sql`count(${articlesTable.id})`))
    .limit(8);

  const coverageGapsRaw = await db
    .select({
      id: locationsTable.id,
      slug: locationsTable.slug,
      type: locationsTable.type,
      nameHi: locationsTable.nameHi,
      nameEn: locationsTable.nameEn,
      followerCount: sql<number>`(select count(*)::int from ${followsLocationsTable} where ${followsLocationsTable.locationId} = ${locationsTable.id})`,
      writerCount: sql<number>`(select count(distinct ${articlesTable.writerId})::int from ${articlesTable} where ${articlesTable.locationId} = ${locationsTable.id} and ${articlesTable.writerId} is not null and ${articlesTable.status} = 'published')`,
      recentArticleCount: sql<number>`(select count(*)::int from ${articlesTable} where ${articlesTable.locationId} = ${locationsTable.id} and ${articlesTable.status} = 'published' and ${articlesTable.publishedAt} >= ${since})`,
    })
    .from(locationsTable);

  const coverageGaps = coverageGapsRaw
    .filter((row) => Number(row.followerCount) > 0 && (row.writerCount === 0 || row.recentArticleCount === 0))
    .sort((a, b) => Number(b.followerCount) - Number(a.followerCount))
    .slice(0, 10)
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      nameHi: row.nameHi,
      nameEn: row.nameEn,
      type: row.type,
      followerCount: Number(row.followerCount),
      writerCount: Number(row.writerCount),
      recentArticleCount: Number(row.recentArticleCount),
    }));

  res.json(
    GetAdminDashboardStatsResponse.parse({
      totals: {
        articles: Number(articles),
        published: Number(published),
        pending: Number(pending),
        writers: Number(writers),
        readers: Number(readers),
        comments: Number(comments),
        totalViews: Number(totalViews),
      },
      pendingArticles: Number(pending),
      recentlyPublished,
      dailyPublishCounts: publishedByDay.map((p) => ({ date: p.day, count: Number(p.count) })),
      byCategory: byCategory
        .filter((b) => b.categoryId)
        .map((b) => ({
          category: { id: b.categoryId!, slug: b.slug ?? "", nameHi: b.nameHi ?? "", nameEn: b.nameEn ?? "" },
          count: Number(b.count),
        })),
      byLocation: byLocation
        .filter((b) => b.locationId)
        .map((b) => ({
          location: {
            id: b.locationId!,
            slug: b.slug ?? "",
            type: b.type ?? "",
            nameHi: b.nameHi ?? "",
            nameEn: b.nameEn ?? "",
          },
          count: Number(b.count),
        })),
      topWriters: topWriters.map((w) => ({
        id: w.id,
        displayName: w.displayName,
        profileImageUrl: w.profileImageUrl,
        bio: w.bio,
        verified: w.verified,
        articleCount: Number(w.articleCount),
        followerCount: Number(w.followerCount ?? 0),
      })),
      coverageGaps,
    }),
  );
});

export default router;
