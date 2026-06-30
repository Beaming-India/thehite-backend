import { Router, type IRouter, type Request, type Response } from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "../lib/better-auth";
import { db, usersTable, userProfilesTable, teamInvitationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

// Mount all better-auth endpoints (sign-in, sign-up, session, etc.)
// Handles: POST /api/auth/sign-in/email, POST /api/auth/sign-up/email,
//          GET /api/auth/session, POST /api/auth/sign-out, etc.
router.all("/auth/*path", toNodeHandler(auth));

// Ensure a user_profiles row exists after sign-up and handle team invitations
export async function ensureProfile(userId: string, email: string | null | undefined) {
  const displayName =
    (await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1))
      .map((u) => [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || "User")
      .at(0) ?? "User";

  await db
    .insert(userProfilesTable)
    .values({ userId, displayName })
    .onConflictDoNothing();

  if (email) {
    const [invitation] = await db
      .select()
      .from(teamInvitationsTable)
      .where(eq(teamInvitationsTable.email, email.toLowerCase()))
      .limit(1);

    if (invitation) {
      await db
        .update(userProfilesTable)
        .set({
          role: invitation.role,
          isWriterApproved:
            invitation.role === "writer" ||
            ["state_admin", "district_admin"].includes(invitation.role),
        })
        .where(eq(userProfilesTable.userId, userId));
      await db.delete(teamInvitationsTable).where(eq(teamInvitationsTable.id, invitation.id));
    }
  }
}

// Current user info endpoint used by the admin frontend
router.get("/auth/user", async (req: Request, res: Response) => {
  const session = await auth.api.getSession({ headers: req.headers as unknown as Headers });
  if (!session?.user) {
    res.json({ user: null });
    return;
  }

  const [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, session.user.id));

  res.json({
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: profile?.role ?? "reader",
      profileImageUrl: session.user.image,
    },
  });
});

// Mobile deep-link handoff (pass session token to app)
router.get("/auth/mobile-handoff", async (req: Request, res: Response) => {
  const redirect = typeof req.query.redirect === "string" ? req.query.redirect : "";
  if (!redirect) {
    res.status(400).send("Missing redirect");
    return;
  }
  if (!/^thehit:\/\//i.test(redirect)) {
    res.status(400).send("Invalid redirect: only the thehit:// scheme is permitted");
    return;
  }

  const session = await auth.api.getSession({ headers: req.headers as unknown as Headers });
  const token = session?.session?.token;
  const sep = redirect.includes("?") ? "&" : "?";
  const target = token
    ? `${redirect}${sep}token=${encodeURIComponent(token)}`
    : `${redirect}${sep}error=not_authenticated`;
  res.redirect(target);
});

export default router;
