import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { db, usersTable, userProfilesTable, accountsTable } from "@workspace/db";
import { auth } from "../lib/better-auth";

const router: IRouter = Router();

// Only available in development mode
if (process.env.NODE_ENV === "development") {
  const DEV_ADMIN_PASSWORD = "devpassword123";
  const DEV_ADMIN_ID = process.env.SEED_ADMIN_ID ?? "seed-admin";

  async function ensureDevAdmin(): Promise<string> {
    // Get the actual email of the seed admin from the DB
    const existing = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, DEV_ADMIN_ID))
      .limit(1);

    let adminEmail: string;

    if (existing.length > 0 && existing[0].email) {
      // User exists — use their actual email
      adminEmail = existing[0].email;
    } else {
      // Create the user with a default dev email
      adminEmail = "admin@dev.local";
      await db.insert(usersTable).values({
        id: DEV_ADMIN_ID,
        email: adminEmail,
        firstName: "Admin",
        lastName: "Dev",
        emailVerified: true,
      }).onConflictDoNothing();
    }

    // Ensure super_admin profile
    await db
      .insert(userProfilesTable)
      .values({ userId: DEV_ADMIN_ID, displayName: "Admin Dev", role: "super_admin", isWriterApproved: true })
      .onConflictDoUpdate({
        target: userProfilesTable.userId,
        set: { role: "super_admin", isWriterApproved: true },
      });

    // Upsert ba_accounts with hashed password (uses actual email as accountId)
    const hashed = await hashPassword(DEV_ADMIN_PASSWORD);
    await db
      .insert(accountsTable)
      .values({
        id: `dev-account-${DEV_ADMIN_ID}`,
        accountId: adminEmail,
        providerId: "credential",
        userId: DEV_ADMIN_ID,
        password: hashed,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: accountsTable.id,
        set: { accountId: adminEmail, password: hashed, updatedAt: new Date() },
      });

    return adminEmail;
  }

  // POST /api/dev-login — creates dev admin + signs in (sets session cookie)
  router.post("/dev-login", async (req, res): Promise<void> => {
    const adminEmail = await ensureDevAdmin();

    // Sign in via BetterAuth to get a real session cookie
    const signInRes = await auth.api.signInEmail({
      body: { email: adminEmail, password: DEV_ADMIN_PASSWORD },
      asResponse: true,
    });

    // Forward all Set-Cookie headers from BetterAuth to the browser
    signInRes.headers.forEach((value: string, key: string) => {
      if (key.toLowerCase() === "set-cookie") {
        res.append("Set-Cookie", value);
      }
    });

    res.json({ ok: true, email: adminEmail, password: DEV_ADMIN_PASSWORD });
  });
}

export default router;
