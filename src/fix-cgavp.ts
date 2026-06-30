import { db, userProfilesTable, usersTable } from "@workspace/db";

import { ilike, sql } from "drizzle-orm";
import { logger } from "./lib/logger";

async function main() {
  // Show all writers to find CGAVP-like names
  const all = await db
    .select({ userId: userProfilesTable.userId, displayName: userProfilesTable.displayName })
    .from(userProfilesTable);

  logger.info({ all }, "All profiles");

  // Fix emails: @cgavp.local → @thehit.in
  const emailResult = await db
    .update(usersTable)
    .set({
      email: sql`REPLACE(email, '@cgavp.local', '@thehit.in')`,
    })
    .where(ilike(usersTable.email, "%@cgavp.local"))
    .returning({ id: usersTable.id, email: usersTable.email });

  logger.info({ updated: emailResult }, `Fixed ${emailResult.length} emails`);

  // Fix displayName: CGAVP → TheHit (case-insensitive)
  const adminResult = await db
    .update(userProfilesTable)
    .set({
      displayName: "TheHit संपादकीय",
      bio: "TheHit.in की संपादकीय टीम। ज़मीनी पत्रकारिता, समुदाय की आवाज़।",
    })
    .where(ilike(userProfilesTable.displayName, "%cgavp%"))
    .returning({ userId: userProfilesTable.userId, displayName: userProfilesTable.displayName });

  logger.info({ updated: adminResult }, `Fixed ${adminResult.length} CGAVP display names`);

  logger.info("All done!");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "Fix failed");
  process.exit(1);
});
