import { Router, type IRouter } from "express";
import {
  db,
  articlesTable,
  userProfilesTable,
  teamInvitationsTable,
} from "@workspace/db";
import { desc, eq, inArray } from "drizzle-orm";
import {
  ListTeamInvitationsResponse,
  CreateTeamInvitationBody,
  DeleteTeamInvitationParams,
} from "@workspace/api-zod";
import { audit } from "../../utils/audit";

const SEED_USER_IDS = [
  "seed-admin",
  "writer-rajesh",
  "writer-anita",
  "writer-vikram",
  "writer-priya",
  "writer-pending",
  "state-admin",
  "district-admin-bastar",
  "moderator-1",
  "reader-demo",
];

const router: IRouter = Router();

router.get("/admin/team/invitations", async (_req, res): Promise<void> => {
  const rows = await db.select().from(teamInvitationsTable).orderBy(desc(teamInvitationsTable.createdAt));
  res.json(
    ListTeamInvitationsResponse.parse(
      rows.map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.displayName,
        phone: r.phone,
        role: r.role,
        notes: r.notes,
        createdAt: r.createdAt,
      })),
    ),
  );
});

router.post("/admin/team/invitations", async (req, res): Promise<void> => {
  const b = CreateTeamInvitationBody.safeParse(req.body);
  if (!b.success) { res.status(400).json({ error: b.error.message }); return; }
  const emailLower = b.data.email.toLowerCase().trim();
  try {
    const [inv] = await db
      .insert(teamInvitationsTable)
      .values({
        email: emailLower,
        displayName: b.data.displayName,
        phone: b.data.phone ?? null,
        role: b.data.role,
        notes: b.data.notes ?? null,
        invitedBy: req.user!.id,
      })
      .onConflictDoUpdate({
        target: teamInvitationsTable.email,
        set: {
          displayName: b.data.displayName,
          phone: b.data.phone ?? null,
          role: b.data.role,
          notes: b.data.notes ?? null,
          invitedBy: req.user!.id,
        },
      })
      .returning();
    await audit(req.user!.id, "team.invite", "team_invitation", inv.id, emailLower);
    res.status(201).json({ id: inv.id, email: inv.email, displayName: inv.displayName, phone: inv.phone, role: inv.role, notes: inv.notes, createdAt: inv.createdAt });
  } catch {
    res.status(409).json({ error: { code: "CONFLICT", message: "Invitation already exists for this email" } });
  }
});

router.delete("/admin/team/invitations/:id", async (req, res): Promise<void> => {
  const p = DeleteTeamInvitationParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [deleted] = await db.delete(teamInvitationsTable).where(eq(teamInvitationsTable.id, p.data.id)).returning();
  if (!deleted) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Invitation not found" } }); return; }
  await audit(req.user!.id, "team.cancel_invite", "team_invitation", p.data.id);
  res.status(204).send();
});

router.delete("/admin/seed-data", async (req, res): Promise<void> => {
  const [profile] = await db
    .select({ role: userProfilesTable.role })
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, req.user!.id));
  if (profile?.role !== "super_admin") {
    res.status(403).json({ error: "Super admin only" });
    return;
  }
  const deleted = await db
    .delete(articlesTable)
    .where(inArray(articlesTable.writerId, SEED_USER_IDS))
    .returning({ id: articlesTable.id });
  await audit(req.user!.id, "seed.clear", "article", null, `deleted=${deleted.length}`);
  res.json({ deleted: deleted.length });
});

export default router;
