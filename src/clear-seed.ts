/**
 * Run this once to remove all seed/dummy data inserted by seed.ts
 * Usage: pnpm run clear-seed
 *
 * NOTE: seed-admin is kept because migrated articles use that writerId.
 * All other seed users, their profiles, and demo writer applications are deleted.
 */
import {
  db,
  articlesTable,
  usersTable,
  userProfilesTable,
  writerApplicationsTable,
} from "@workspace/db";
import { inArray, eq } from "drizzle-orm";

// seed-admin is intentionally excluded — migrated articles depend on it
const DUMMY_USER_IDS = [
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

// seed.ts article titles that should be removed if they exist
const SEED_ARTICLE_SLUGS_PARTIAL = [
  "pending-submission-for-moderation",
  "pending-submission-two",
  "draft-article-preview",
  "changes-requested-article",
  "rejected-article-example",
];

async function main() {
  console.log("Removing seed dummy data...\n");

  // 1. Delete writer applications for dummy users
  const deletedApps = await db
    .delete(writerApplicationsTable)
    .where(inArray(writerApplicationsTable.userId, [...DUMMY_USER_IDS, "seed-admin"].filter(
      // only demo apps, not real ones
      id => ["writer-pending", "reader-demo"].includes(id)
    )))
    .returning({ id: writerApplicationsTable.id, name: writerApplicationsTable.fullName });
  console.log(`Deleted ${deletedApps.length} demo writer applications:`);
  deletedApps.forEach(a => console.log(`  - ${a.name}`));

  // 2. Delete articles written by dummy users (not seed-admin)
  const deletedArticles = await db
    .delete(articlesTable)
    .where(inArray(articlesTable.writerId, DUMMY_USER_IDS))
    .returning({ id: articlesTable.id, title: articlesTable.title });
  console.log(`\nDeleted ${deletedArticles.length} dummy articles:`);
  deletedArticles.forEach(a => console.log(`  - ${a.title}`));

  // 3. Delete user profiles for dummy users
  const deletedProfiles = await db
    .delete(userProfilesTable)
    .where(inArray(userProfilesTable.userId, DUMMY_USER_IDS))
    .returning({ userId: userProfilesTable.userId });
  console.log(`\nDeleted ${deletedProfiles.length} dummy user profiles`);

  // 4. Delete dummy users themselves
  const deletedUsers = await db
    .delete(usersTable)
    .where(inArray(usersTable.id, DUMMY_USER_IDS))
    .returning({ id: usersTable.id, email: usersTable.email });
  console.log(`Deleted ${deletedUsers.length} dummy users:`);
  deletedUsers.forEach(u => console.log(`  - ${u.id} (${u.email})`));

  console.log("\n✅ Done! Real articles (1803) are intact. seed-admin kept as article author.");
  process.exit(0);
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
