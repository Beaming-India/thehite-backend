/**
 * Run this once to remove all seed/dummy data inserted by seed.ts
 * Usage: pnpm run clear-seed
 */
import { db, articlesTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

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

async function main() {
  console.log("Removing seed dummy articles...");

  const deleted = await db
    .delete(articlesTable)
    .where(inArray(articlesTable.writerId, SEED_USER_IDS))
    .returning({ id: articlesTable.id, title: articlesTable.title });

  console.log(`Deleted ${deleted.length} seed articles:`);
  deleted.forEach((a) => console.log(`  - ${a.title}`));
  console.log("Done! Database cleaned.");
  process.exit(0);
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
