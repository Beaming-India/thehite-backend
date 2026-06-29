import { db, userProfilesTable, usersTable } from "@workspace/db";
import { like, sql } from "drizzle-orm";
import { logger } from "./lib/logger";

async function main() {
  // Fix emails: @cgavp.local → @thehit.in
  const emailResult = await db
    .update(usersTable)
    .set({
      email: sql`REPLACE(email, '@cgavp.local', '@thehit.in')`,
    })
    .where(like(usersTable.email, "%@cgavp.local"))
    .returning({ id: usersTable.id, email: usersTable.email });

  logger.info({ updated: emailResult }, `Fixed ${emailResult.length} emails`);

  // Fix displayName: CGAVP → TheHit (admin profile)
  const adminResult = await db
    .update(userProfilesTable)
    .set({
      displayName: "TheHit संपादकीय",
      bio: "TheHit.in की संपादकीय टीम। ज़मीनी पत्रकारिता, समुदाय की आवाज़।",
    })
    .where(like(userProfilesTable.displayName, "%CGAVP%"))
    .returning({ userId: userProfilesTable.userId, displayName: userProfilesTable.displayName });

  logger.info({ updated: adminResult }, `Fixed ${adminResult.length} CGAVP display names`);

  logger.info("All done!");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "Fix failed");
  process.exit(1);
});
