import { Router, type IRouter } from "express";
import {
  db,
  articlesTable,
  articleLikesTable,
  articleBookmarksTable,
  articleSharesTable,
  articleViewsTable,
  commentsTable,
  reportsTable,
  followsWritersTable,
  usersTable,
  userProfilesTable,
} from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  LikeArticleParams,
  LikeArticleResponse,
  UnlikeArticleParams,
  UnlikeArticleResponse,
  BookmarkArticleParams,
  BookmarkArticleResponse,
  UnbookmarkArticleParams,
  UnbookmarkArticleResponse,
  ShareArticleParams,
  ShareArticleBody,
  ShareArticleResponse,
  RecordArticleViewParams,
  RecordArticleViewResponse,
  ListArticleCommentsParams,
  ListArticleCommentsResponse,
  CreateArticleCommentParams,
  CreateArticleCommentBody,
  ReportCommentParams,
  ReportCommentBody,
  FollowWriterParams,
  FollowWriterResponse,
  UnfollowWriterParams,
  UnfollowWriterResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middleware/requireRole";
import { getEngagementCounts } from "../utils/engagement";

const router: IRouter = Router();

router.post("/articles/:id/like", requireAuth, async (req, res): Promise<void> => {
  const p = LikeArticleParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  const uid = req.user!.id;
  const inserted = await db
    .insert(articleLikesTable)
    .values({ articleId: p.data.id, userId: uid })
    .onConflictDoNothing()
    .returning();
  if (inserted.length) {
    await db
      .update(articlesTable)
      .set({ likeCount: sql`${articlesTable.likeCount} + 1` })
      .where(eq(articlesTable.id, p.data.id));
  }
  res.json(LikeArticleResponse.parse(await getEngagementCounts(p.data.id, uid)));
});

router.delete("/articles/:id/like", requireAuth, async (req, res): Promise<void> => {
  const p = UnlikeArticleParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  const uid = req.user!.id;
  const deleted = await db
    .delete(articleLikesTable)
    .where(and(eq(articleLikesTable.articleId, p.data.id), eq(articleLikesTable.userId, uid)))
    .returning();
  if (deleted.length) {
    await db
      .update(articlesTable)
      .set({ likeCount: sql`GREATEST(${articlesTable.likeCount} - 1, 0)` })
      .where(eq(articlesTable.id, p.data.id));
  }
  res.json(UnlikeArticleResponse.parse(await getEngagementCounts(p.data.id, uid)));
});

router.post("/articles/:id/bookmark", requireAuth, async (req, res): Promise<void> => {
  const p = BookmarkArticleParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  const uid = req.user!.id;
  const inserted = await db
    .insert(articleBookmarksTable)
    .values({ articleId: p.data.id, userId: uid })
    .onConflictDoNothing()
    .returning();
  if (inserted.length) {
    await db
      .update(articlesTable)
      .set({ bookmarkCount: sql`${articlesTable.bookmarkCount} + 1` })
      .where(eq(articlesTable.id, p.data.id));
  }
  res.json(BookmarkArticleResponse.parse(await getEngagementCounts(p.data.id, uid)));
});

router.delete("/articles/:id/bookmark", requireAuth, async (req, res): Promise<void> => {
  const p = UnbookmarkArticleParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  const uid = req.user!.id;
  const deleted = await db
    .delete(articleBookmarksTable)
    .where(and(eq(articleBookmarksTable.articleId, p.data.id), eq(articleBookmarksTable.userId, uid)))
    .returning();
  if (deleted.length) {
    await db
      .update(articlesTable)
      .set({ bookmarkCount: sql`GREATEST(${articlesTable.bookmarkCount} - 1, 0)` })
      .where(eq(articlesTable.id, p.data.id));
  }
  res.json(UnbookmarkArticleResponse.parse(await getEngagementCounts(p.data.id, uid)));
});

router.post("/articles/:id/share", async (req, res): Promise<void> => {
  const p = ShareArticleParams.safeParse(req.params);
  const b = ShareArticleBody.safeParse(req.body ?? {});
  if (!p.success || !b.success) {
    res.status(400).json({ error: p.success ? b.error?.message : p.error.message });
    return;
  }
  await db.insert(articleSharesTable).values({
    articleId: p.data.id,
    userId: req.user?.id ?? null,
    platform: b.data.platform ?? null,
  });
  await db
    .update(articlesTable)
    .set({ shareCount: sql`${articlesTable.shareCount} + 1` })
    .where(eq(articlesTable.id, p.data.id));
  res.json(ShareArticleResponse.parse(await getEngagementCounts(p.data.id, req.user?.id)));
});

router.post("/articles/:id/view", async (req, res): Promise<void> => {
  const p = RecordArticleViewParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  await db.insert(articleViewsTable).values({
    articleId: p.data.id,
    userId: req.user?.id ?? null,
  });
  await db
    .update(articlesTable)
    .set({ viewCount: sql`${articlesTable.viewCount} + 1` })
    .where(eq(articlesTable.id, p.data.id));
  res.json(RecordArticleViewResponse.parse(await getEngagementCounts(p.data.id, req.user?.id)));
});

// --- comments ---

router.get("/articles/:id/comments", async (req, res): Promise<void> => {
  const p = ListArticleCommentsParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  const rows = await db
    .select({
      id: commentsTable.id,
      body: commentsTable.body,
      createdAt: commentsTable.createdAt,
      isHidden: commentsTable.isHidden,
      articleId: commentsTable.articleId,
      parentId: commentsTable.parentId,
      authorId: commentsTable.userId,
      displayName: userProfilesTable.displayName,
      profileImageUrl: usersTable.profileImageUrl,
      verified: userProfilesTable.isVerified,
    })
    .from(commentsTable)
    .leftJoin(userProfilesTable, eq(userProfilesTable.userId, commentsTable.userId))
    .leftJoin(usersTable, eq(usersTable.id, commentsTable.userId))
    .where(and(eq(commentsTable.articleId, p.data.id), eq(commentsTable.isHidden, false)))
    .orderBy(asc(commentsTable.createdAt));

  const byParent = new Map<string, typeof rows>();
  const roots: typeof rows = [];
  for (const r of rows) {
    if (r.parentId) {
      const arr = byParent.get(r.parentId) ?? [];
      arr.push(r);
      byParent.set(r.parentId, arr);
    } else {
      roots.push(r);
    }
  }
  const toItem = (r: (typeof rows)[number]): unknown => ({
    id: r.id,
    body: r.body,
    createdAt: r.createdAt,
    isHidden: r.isHidden,
    articleId: r.articleId,
    parentId: r.parentId,
    author: {
      id: r.authorId,
      displayName: r.displayName ?? "User",
      profileImageUrl: r.profileImageUrl,
      verified: r.verified ?? false,
    },
    replies: (byParent.get(r.id) ?? []).map(toItem),
  });

  res.json(ListArticleCommentsResponse.parse(roots.map(toItem)));
});

router.post("/articles/:id/comments", async (req, res): Promise<void> => {
  const p = CreateArticleCommentParams.safeParse(req.params);
  const b = CreateArticleCommentBody.safeParse(req.body);
  if (!p.success || !b.success) {
    res.status(400).json({ error: p.success ? b.error?.message : p.error.message });
    return;
  }

  // Require either logged-in user OR guestName
  if (!req.user && !b.data.guestName?.trim()) {
    res.status(400).json({ error: { code: "GUEST_NAME_REQUIRED", message: "Please provide your name to comment" } });
    return;
  }

  const [c] = await db
    .insert(commentsTable)
    .values({
      articleId: p.data.id,
      userId: req.user?.id ?? null,
      guestName: req.user ? null : (b.data.guestName?.trim() ?? null),
      parentId: b.data.parentId ?? null,
      body: b.data.body,
    })
    .returning();
  await db
    .update(articlesTable)
    .set({ commentCount: sql`${articlesTable.commentCount} + 1` })
    .where(eq(articlesTable.id, p.data.id));

  let displayName = b.data.guestName?.trim() ?? "Reader";
  let profileImageUrl: string | null = null;
  let verified = false;

  if (req.user) {
    const [profile] = await db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, req.user.id));
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id));
    displayName = profile?.displayName ?? "User";
    profileImageUrl = user?.profileImageUrl ?? null;
    verified = profile?.isVerified ?? false;
  }

  res.status(201).json({
    id: c.id,
    body: c.body,
    createdAt: c.createdAt,
    isHidden: c.isHidden,
    articleId: c.articleId,
    parentId: c.parentId,
    author: {
      id: req.user?.id ?? null,
      displayName,
      profileImageUrl,
      verified,
    },
    replies: [],
  });
});

router.post("/comments/:id/report", requireAuth, async (req, res): Promise<void> => {
  const p = ReportCommentParams.safeParse(req.params);
  const b = ReportCommentBody.safeParse(req.body);
  if (!p.success || !b.success) {
    res.status(400).json({ error: p.success ? b.error?.message : p.error.message });
    return;
  }
  const [inserted] = await db
    .insert(reportsTable)
    .values({
      targetType: "comment",
      targetId: p.data.id,
      reporterId: req.user!.id,
      reason: b.data.reason,
    })
    .returning();
  await db
    .update(commentsTable)
    .set({ reportedCount: sql`${commentsTable.reportedCount} + 1` })
    .where(eq(commentsTable.id, p.data.id));
  const profile = await db.query.userProfilesTable.findFirst({
    where: eq(userProfilesTable.userId, req.user!.id),
  });
  res.status(201).json({
    id: inserted.id,
    targetType: inserted.targetType,
    targetId: inserted.targetId,
    reason: inserted.reason,
    createdAt: inserted.createdAt.toISOString(),
    reporter: {
      id: req.user!.id,
      displayName: profile?.displayName ?? "User",
      profileImageUrl: null,
      verified: profile?.isVerified ?? false,
    },
  });
});

// --- follow writer ---

router.post("/writers/:id/follow", requireAuth, async (req, res): Promise<void> => {
  const p = FollowWriterParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  if (p.data.id === req.user!.id) {
    res.status(400).json({ error: { code: "INVALID", message: "Cannot follow yourself" } });
    return;
  }
  const inserted = await db
    .insert(followsWritersTable)
    .values({ followerId: req.user!.id, writerId: p.data.id })
    .onConflictDoNothing()
    .returning();
  let count = 0;
  if (inserted.length) {
    const [p2] = await db
      .update(userProfilesTable)
      .set({ followerCount: sql`${userProfilesTable.followerCount} + 1` })
      .where(eq(userProfilesTable.userId, p.data.id))
      .returning();
    count = p2?.followerCount ?? 0;
  } else {
    const [p2] = await db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, p.data.id));
    count = p2?.followerCount ?? 0;
  }
  res.json(FollowWriterResponse.parse({ isFollowing: true, followerCount: count }));
});

router.delete("/writers/:id/follow", requireAuth, async (req, res): Promise<void> => {
  const p = UnfollowWriterParams.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: p.error.message });
    return;
  }
  const deleted = await db
    .delete(followsWritersTable)
    .where(
      and(eq(followsWritersTable.followerId, req.user!.id), eq(followsWritersTable.writerId, p.data.id)),
    )
    .returning();
  let count = 0;
  if (deleted.length) {
    const [p2] = await db
      .update(userProfilesTable)
      .set({ followerCount: sql`GREATEST(${userProfilesTable.followerCount} - 1, 0)` })
      .where(eq(userProfilesTable.userId, p.data.id))
      .returning();
    count = p2?.followerCount ?? 0;
  } else {
    const [p2] = await db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, p.data.id));
    count = p2?.followerCount ?? 0;
  }
  res.json(UnfollowWriterResponse.parse({ isFollowing: false, followerCount: count }));
});

export default router;
