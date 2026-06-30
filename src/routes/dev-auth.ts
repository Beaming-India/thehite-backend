import { Router, type IRouter } from "express";
import { toNodeHandler } from "better-auth/node";
import { hashPassword } from "better-auth/crypto";
import { db, usersTable, userProfilesTable, accountsTable } from "@workspace/db";
import { auth } from "../lib/better-auth";

const router: IRouter = Router();

// Only available in development mode
if (process.env.NODE_ENV === "development") {
  const DEV_ADMIN_EMAIL = "admin@dev.local";
  const DEV_ADMIN_PASSWORD = "devpassword123";
  const DEV_ADMIN_ID = process.env.SEED_ADMIN_ID ?? "seed-admin";

  // Ensure dev admin exists in DB on first call
  async function ensureDevAdmin() {
    // Ensure the app user row exists
    await db
      .insert(usersTable)
      .values({
        id: DEV_ADMIN_ID,
        email: DEV_ADMIN_EMAIL,
        firstName: "Admin",
        lastName: "Dev",
        emailVerified: true,
      })
      .onConflictDoNothing();

    await db
      .insert(userProfilesTable)
      .values({
        userId: DEV_ADMIN_ID,
        displayName: "Admin Dev",
        role: "super_admin",
        isWriterApproved: true,
      })
      .onConflictDoUpdate({
        target: userProfilesTable.userId,
        set: { role: "super_admin", isWriterApproved: true },
      });

    // Upsert the ba_accounts row with a fresh hashed password
    const hashed = await hashPassword(DEV_ADMIN_PASSWORD);
    const accountId = `dev-account-${DEV_ADMIN_ID}`;
    await db
      .insert(accountsTable)
      .values({
        id: accountId,
        accountId: DEV_ADMIN_EMAIL,
        providerId: "credential",
        userId: DEV_ADMIN_ID,
        password: hashed,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: accountsTable.id,
        set: { password: hashed, updatedAt: new Date() },
      });
  }

  // POST /api/dev-login — creates dev admin + signs in (sets session cookie)
  router.post("/dev-login", async (req, res): Promise<void> => {
    await ensureDevAdmin();

    // Sign in via BetterAuth to get a real session cookie
    const signInRes = await auth.api.signInEmail({
      body: { email: DEV_ADMIN_EMAIL, password: DEV_ADMIN_PASSWORD },
      asResponse: true,
    });

    // Forward Set-Cookie headers from BetterAuth to the browser
    const cookies = signInRes.headers.getSetCookie?.() ?? [];
    for (const cookie of cookies) {
      res.setHeader("Set-Cookie", cookie);
    }

    res.json({ ok: true, email: DEV_ADMIN_EMAIL, password: DEV_ADMIN_PASSWORD });
  });
}

export default router;
