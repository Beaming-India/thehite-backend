import { db, articlesTable, articleLikesTable, articleBookmarksTable, usersTable, userProfilesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export async function getEngagementCounts(
  articleId: string,
  userId?: string | null,
): Promise<{
  likeCount: number;
  commentCount: number;
  shareCount: number;
  bookmarkCount: number;
  isLiked: boolean;
  isBookmarked: boolean;
}> {
  const [a] = await db.select().from(articlesTable).where(eq(articlesTable.id, articleId));
  let isLiked = false;
  let isBookmarked = false;
  if (userId && a) {
    const [l] = await db
      .select({ articleId: articleLikesTable.articleId })
      .from(articleLikesTable)
      .where(and(eq(articleLikesTable.articleId, articleId), eq(articleLikesTable.userId, userId)))
      .limit(1);
    const [bm] = await db
      .select({ articleId: articleBookmarksTable.articleId })
      .from(articleBookmarksTable)
      .where(and(eq(articleBookmarksTable.articleId, articleId), eq(articleBookmarksTable.userId, userId)))
      .limit(1);
    isLiked = !!l;
    isBookmarked = !!bm;
  }
  return {
    likeCount: a?.likeCount ?? 0,
    commentCount: a?.commentCount ?? 0,
    shareCount: a?.shareCount ?? 0,
    bookmarkCount: a?.bookmarkCount ?? 0,
    isLiked,
    isBookmarked,
  };
}

export async function getDisplayName(userId: string): Promise<string> {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  const [p] = await db.select().from(userProfilesTable).where(eq(userProfilesTable.userId, userId));
  return (
    p?.displayName ||
    [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim() ||
    u?.email ||
    "User"
  );
}
