import { Router, type IRouter } from "express";
import {
  db,
  commentsTable,
  reportsTable,
  usersTable,
  userProfilesTable,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  ListAdminCommentsQueryParams,
  ListAdminCommentsResponse,
  HideCommentParams,
  HideCommentResponse,
  ListAdminReportsResponse,
} from "@workspace/api-zod";
import { audit } from "../../utils/audit";

async function loadFullComment(id: string) {
  const [r] = await db
    .select({ comment: commentsTable, user: usersTable, profile: userProfilesTable })
    .from(commentsTable)
    .leftJoin(usersTable, eq(usersTable.id, commentsTable.userId))
    .leftJoin(userProfilesTable, eq(userProfilesTable.userId, commentsTable.userId))
    .where(eq(commentsTable.id, id));
  if (!r) return null;
  return {
    id: r.comment.id,
    body: r.comment.body,
    createdAt: r.comment.createdAt,
    isHidden: r.comment.isHidden,
    articleId: r.comment.articleId,
    parentId: r.comment.parentId,
    author: {
      id: r.user?.id ?? r.comment.userId ?? "",
      displayName: r.profile?.displayName ?? r.user?.email ?? "User",
      profileImageUrl: r.user?.profileImageUrl ?? null,
      verified: r.profile?.isVerified ?? false,
    },
  };
}

const router: IRouter = Router();

router.get("/admin/comments", async (req, res): Promise<void> => {
  const q = ListAdminCommentsQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  const conds = [];
  if (q.data.status === "reported") conds.push(sql`${commentsTable.reportedCount} > 0`);
  else if (q.data.status === "hidden") conds.push(eq(commentsTable.isHidden, true));
  else if (q.data.status === "visible") conds.push(eq(commentsTable.isHidden, false));
  const rows = await db
    .select({ comment: commentsTable, user: usersTable, profile: userProfilesTable })
    .from(commentsTable)
    .leftJoin(usersTable, eq(usersTable.id, commentsTable.userId))
    .leftJoin(userProfilesTable, eq(userProfilesTable.userId, commentsTable.userId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(commentsTable.createdAt))
    .limit(100);
  res.json(
    ListAdminCommentsResponse.parse(
      rows.map((r) => ({
        id: r.comment.id,
        body: r.comment.body,
        createdAt: r.comment.createdAt,
        isHidden: r.comment.isHidden,
        articleId: r.comment.articleId,
        parentId: r.comment.parentId,
        author: {
          id: r.user?.id ?? r.comment.userId,
          displayName: r.profile?.displayName ?? r.user?.email ?? "User",
          profileImageUrl: r.user?.profileImageUrl,
          verified: r.profile?.isVerified ?? false,
        },
        reportedCount: r.comment.reportedCount,
      })),
    ),
  );
});

router.post("/admin/comments/:id/hide", async (req, res): Promise<void> => {
  const p = HideCommentParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [c] = await db
    .update(commentsTable)
    .set({ isHidden: true })
    .where(eq(commentsTable.id, p.data.id))
    .returning();
  if (!c) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Comment not found" } }); return; }
  await audit(req.user!.id, "comment.hide", "comment", c.id);
  res.json(HideCommentResponse.parse(await loadFullComment(c.id)));
});

router.get("/admin/reports", async (req, res): Promise<void> => {
  const showResolved = req.query.resolved === "true";
  const resolverUser = alias(usersTable, "resolver_user");
  const resolverProfile = alias(userProfilesTable, "resolver_profile");
  const rows = await db
    .select({ report: reportsTable, user: usersTable, profile: userProfilesTable, resolverUser, resolverProfile })
    .from(reportsTable)
    .leftJoin(usersTable, eq(usersTable.id, reportsTable.reporterId))
    .leftJoin(userProfilesTable, eq(userProfilesTable.userId, reportsTable.reporterId))
    .leftJoin(resolverUser, eq(resolverUser.id, reportsTable.resolvedBy))
    .leftJoin(resolverProfile, eq(resolverProfile.userId, reportsTable.resolvedBy))
    .where(eq(reportsTable.resolved, showResolved))
    .orderBy(desc(reportsTable.createdAt))
    .limit(100);
  res.json(
    ListAdminReportsResponse.parse(
      rows.map((r) => ({
        id: r.report.id,
        targetType: r.report.targetType as "article" | "comment",
        targetId: r.report.targetId,
        reason: r.report.reason,
        resolved: r.report.resolved,
        resolvedAt: r.report.resolvedAt ?? null,
        resolvedByDisplayName: r.report.resolvedBy
          ? (r.resolverProfile?.displayName ?? r.resolverUser?.email ?? null)
          : null,
        createdAt: r.report.createdAt,
        reporter: {
          id: r.user?.id ?? "",
          displayName: r.profile?.displayName ?? r.user?.email ?? "Anonymous",
          profileImageUrl: r.user?.profileImageUrl,
          verified: r.profile?.isVerified ?? false,
        },
      })),
    ),
  );
});

router.post("/admin/reports/:id/resolve", async (req, res): Promise<void> => {
  const { id } = req.params;
  const actorId = req.user!.id;
  const result = await db
    .update(reportsTable)
    .set({ resolved: true, resolvedBy: actorId, resolvedAt: new Date() })
    .where(eq(reportsTable.id, id))
    .returning({ id: reportsTable.id });
  if (!result.length) { res.status(404).json({ error: "Report not found" }); return; }
  await audit(actorId, "report.resolve", "report", id);
  res.status(204).send();
});

export default router;
