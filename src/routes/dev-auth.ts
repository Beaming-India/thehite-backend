import { Router, type IRouter } from "express";
import { db, usersTable, userProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createSession } from "../lib/auth";

const router: IRouter = Router();

// Only available in development mode
if (process.env.NODE_ENV === "development") {
  router.post("/dev-login", async (req, res): Promise<void> => {
    const DEV_ADMIN_ID = process.env.SEED_ADMIN_ID ?? "seed-admin";
    const DEV_ADMIN_EMAIL = "admin@dev.local";

    // Ensure the dev admin user exists
    await db
      .insert(usersTable)
      .values({
        id: DEV_ADMIN_ID,
        email: DEV_ADMIN_EMAIL,
        firstName: "Admin",
        lastName: "Dev",
        profileImageUrl: null,
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
        set: { role: "super_admin" },
      });

    const sid = await createSession({
      user: {
        id: DEV_ADMIN_ID,
        email: DEV_ADMIN_EMAIL,
        firstName: "Admin",
        lastName: "Dev",
        profileImageUrl: null,
      },
      access_token: "dev-token",
    });

    res.cookie("sid", sid, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ ok: true, userId: DEV_ADMIN_ID });
  });
}

export default router;
