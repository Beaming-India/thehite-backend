import { Router, type IRouter } from "express";
import { db, auditLogTable, usersTable, userProfilesTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { ListAdminAuditLogQueryParams, ListAdminAuditLogResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/admin/audit-log", async (req, res): Promise<void> => {
  const q = ListAdminAuditLogQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  const rows = await db
    .select({ log: auditLogTable, user: usersTable, profile: userProfilesTable })
    .from(auditLogTable)
    .leftJoin(usersTable, eq(usersTable.id, auditLogTable.actorId))
    .leftJoin(userProfilesTable, eq(userProfilesTable.userId, auditLogTable.actorId))
    .orderBy(desc(auditLogTable.createdAt))
    .limit(q.data.limit);
  res.json(
    ListAdminAuditLogResponse.parse(
      rows.map((r) => ({
        id: r.log.id,
        action: r.log.action,
        targetType: r.log.targetType,
        targetId: r.log.targetId,
        note: r.log.note,
        createdAt: r.log.createdAt,
        actor: {
          id: r.user?.id ?? "",
          displayName: r.profile?.displayName ?? r.user?.email ?? "System",
          profileImageUrl: r.user?.profileImageUrl,
          verified: r.profile?.isVerified ?? false,
        },
      })),
    ),
  );
});

export default router;
