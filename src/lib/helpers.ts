import { type Request, type Response, type NextFunction } from "express";
import {
  db,
  userProfilesTable,
  usersTable,
  auditLogTable,
  articlesTable,
  articleLikesTable,
  articleBookmarksTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

export const ADMIN_ROLES = [
  "super_admin",
  "state_admin",
  "district_admin",
  "moderator",
] as const;

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user?.id) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Login required" } });
    return;
  }
  next();
}

export async function getRole(userId: string): Promise<string> {
  const [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));
  return profile?.role ?? "reader";
}

export function isAdminRole(role: string): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}

export async function requireWriter(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user?.id) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Login required" } });
    return;
  }
  const role = await getRole(req.user.id);
  if (role !== "writer" && !isAdminRole(role)) {
    res.status(403).json({ error: { code: "FORBIDDEN", message: "Writer role required" } });
    return;
  }
  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user?.id) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Login required" } });
    return;
  }
  const role = await getRole(req.user.id);
  if (!isAdminRole(role)) {
    res.status(403).json({ error: { code: "FORBIDDEN", message: "Admin role required" } });
    return;
  }
  next();
}

export function readingTimeMin(body: string): number {
  const words = body.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 200));
}

export function slugify(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 160);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base || "article"}-${suffix}`;
}

export interface ArticleRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  coverImageUrl: string | null;
  lang: string;
  status: string;
  writerId: string;
  categoryId: string | null;
  locationId: string | null;
  tags: string[];
  moderationNote: string | null;
  isBreaking: boolean;
  isFeatured: boolean;
  isPinned: boolean;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  bookmarkCount: number;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface JoinedArticle {
  article: ArticleRow;
  category: { id: string; slug: string; nameHi: string; nameEn: string } | null;
  location: { id: string; slug: string; type: string; nameHi: string; nameEn: string } | null;
  writer: { id: string; displayName: string; profileImageUrl: string | null; isVerified: boolean } | null;
}

export function mapArticleCard(row: JoinedArticle) {
  const a = row.article;
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    summary: a.summary,
    coverImageUrl: a.coverImageUrl,
    lang: a.lang as "hi" | "en",
    publishedAt: a.publishedAt,
    viewCount: a.viewCount,
    likeCount: a.likeCount,
    commentCount: a.commentCount,
    shareCount: a.shareCount,
    isBreaking: a.isBreaking,
    isFeatured: a.isFeatured,
    readingTimeMin: readingTimeMin(a.body),
    category: row.category ?? undefined,
    location: row.location ?? undefined,
    writer: row.writer
      ? {
          id: row.writer.id,
          displayName: row.writer.displayName,
          profileImageUrl: row.writer.profileImageUrl ?? null,
          verified: row.writer.isVerified,
        }
      : undefined,
  };
}

export function mapArticleDetail(row: JoinedArticle, isLiked = false, isBookmarked = false) {
  const a = row.article;
  return {
    ...mapArticleCard(row),
    body: a.body,
    tags: a.tags ?? [],
    isLiked,
    isBookmarked,
    updatedAt: a.updatedAt,
  };
}

export function mapMyArticle(row: JoinedArticle) {
  const a = row.article;
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    summary: a.summary,
    body: a.body,
    coverImageUrl: a.coverImageUrl,
    lang: a.lang as "hi" | "en",
    status: a.status as "draft" | "pending" | "published" | "rejected" | "changes_requested",
    categoryId: a.categoryId,
    locationId: a.locationId,
    category: row.category ?? undefined,
    location: row.location ?? undefined,
    tags: a.tags ?? [],
    moderationNote: a.moderationNote,
    isBreaking: a.isBreaking,
    isFeatured: a.isFeatured,
    isPinned: a.isPinned,
    viewCount: a.viewCount,
    likeCount: a.likeCount,
    commentCount: a.commentCount,
    publishedAt: a.publishedAt,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export async function audit(
  actorId: string | null,
  action: string,
  targetType: string | null,
  targetId: string | null,
  note?: string,
): Promise<void> {
  await db.insert(auditLogTable).values({ actorId, action, targetType, targetId, note: note ?? null });
}

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
