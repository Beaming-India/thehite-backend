import { Router, type IRouter, type Request, type Response } from "express";
import { GetCurrentAuthUserResponse } from "@workspace/api-zod";
import { db, usersTable, userProfilesTable, teamInvitationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  clearSession,
  getSessionId,
  createSession,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
} from "../lib/auth";

const IS_PROD = process.env.NODE_ENV === "production";
const USE_MOCK_AUTH = process.env.USE_MOCK_AUTH === "true";

const router: IRouter = Router();

function getOrigin(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || (IS_PROD ? "https" : "http");
  const host = req.headers["x-forwarded-host"] || req.headers["host"] || "localhost";
  return `${proto}://${host}`;
}

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

function getSafeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

async function upsertUser(claims: Record<string, unknown>) {
  const userData = {
    id: claims.sub as string,
    email: (claims.email as string) || null,
    firstName: (claims.first_name as string) || null,
    lastName: (claims.last_name as string) || null,
    profileImageUrl: (claims.profile_image_url || claims.picture) as string | null,
  };

  const [user] = await db
    .insert(usersTable)
    .values(userData)
    .onConflictDoUpdate({
      target: usersTable.id,
      set: { ...userData, updatedAt: new Date() },
    })
    .returning();

  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.email ||
    "Reader";

  await db
    .insert(userProfilesTable)
    .values({ userId: user.id, displayName })
    .onConflictDoNothing();

  if (user.email) {
    const [invitation] = await db
      .select()
      .from(teamInvitationsTable)
      .where(eq(teamInvitationsTable.email, user.email.toLowerCase()))
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
        .where(eq(userProfilesTable.userId, user.id));
      await db.delete(teamInvitationsTable).where(eq(teamInvitationsTable.id, invitation.id));
    }
  }

  return user;
}

router.get("/auth/user", (req: Request, res: Response) => {
  res.json(
    GetCurrentAuthUserResponse.parse({
      user: req.isAuthenticated() ? req.user : null,
    }),
  );
});

router.get("/login", async (req: Request, res: Response) => {
  const returnTo = getSafeReturnTo(req.query.returnTo);

  if (USE_MOCK_AUTH) {
    // Local dev: auto-login as seeded super-admin
    const adminId = process.env.SEED_ADMIN_ID || "seed-admin";
    const [dbUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, adminId))
      .limit(1);

    if (!dbUser) {
      res.status(500).send("Database not seeded. Run: npm run seed");
      return;
    }

    const sessionData: SessionData = {
      user: {
        id: dbUser.id,
        email: dbUser.email,
        firstName: dbUser.firstName,
        lastName: dbUser.lastName,
        profileImageUrl: dbUser.profileImageUrl,
      },
      access_token: "mock-access-token",
    };

    const sid = await createSession(sessionData);
    setSessionCookie(res, sid);
    res.redirect(returnTo);
    return;
  }

  // Production: login not configured — return 501
  res.status(501).json({
    error: "Authentication not configured",
    message: "Please configure an OAuth provider or set USE_MOCK_AUTH=true for development.",
  });
});

router.get("/callback", async (req: Request, res: Response) => {
  res.status(501).json({ error: "OAuth callback not configured" });
});

router.get("/auth/mobile-handoff", (req: Request, res: Response) => {
  const redirect = typeof req.query.redirect === "string" ? req.query.redirect : "";
  const sid = req.cookies?.[SESSION_COOKIE];

  if (!redirect) {
    res.status(400).send("Missing redirect");
    return;
  }

  if (!/^cgavp:\/\//i.test(redirect)) {
    res.status(400).send("Invalid redirect: only the cgavp:// scheme is permitted");
    return;
  }

  const sep = redirect.includes("?") ? "&" : "?";
  const target = sid
    ? `${redirect}${sep}token=${encodeURIComponent(sid)}`
    : `${redirect}${sep}error=not_authenticated`;
  res.redirect(target);
});

router.get("/logout", async (req: Request, res: Response) => {
  const origin = getOrigin(req);
  const sid = getSessionId(req);
  await clearSession(res, sid);
  res.redirect(origin);
});

export default router;
