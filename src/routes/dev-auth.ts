import { Router, type IRouter } from "express";
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

  // POST /api/dev-login — returns credentials for the frontend to use
  router.post("/dev-login", async (_req, res): Promise<void> => {
    await ensureDevAdmin();
    // Return the dev credentials so the frontend can call /api/auth/sign-in/email
    res.json({
      ok: true,
      email: DEV_ADMIN_EMAIL,
      password: DEV_ADMIN_PASSWORD,
    });
  });
}

export default router;
