import {
  db,
  deviceTokensTable,
  userProfilesTable,
  pushPrefsCategoriesTable,
  pushPrefsLocationsTable,
  followsWritersTable,
  usersTable,
  breakingPushDeliveriesTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { logger } from "./logger";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default";
  priority?: "high";
  channelId?: string;
};

async function sendChunk(messages: ExpoMessage[]): Promise<void> {
  if (messages.length === 0) return;
  try {
    const resp = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(messages),
    });
    if (!resp.ok) {
      const text = await resp.text();
      logger.warn({ status: resp.status, text }, "Expo push send non-OK");
      return;
    }
    const json = (await resp.json()) as { data?: Array<{ status: string; message?: string; details?: { error?: string } }> };
    const results = json.data ?? [];
    const dead: string[] = [];
    const errors: Array<{ token?: string; message?: string; details?: { error?: string } }> = [];
    results.forEach((r, idx) => {
      if (r.status !== "error") return;
      const token = messages[idx]?.to;
      errors.push({ token, message: r.message, details: r.details });
      if (token && r.details?.error === "DeviceNotRegistered") {
        dead.push(token);
      }
    });
    if (errors.length) {
      logger.warn({ errors }, "Expo push had per-message errors");
    }
    for (const t of dead) {
      await db.delete(deviceTokensTable).where(eq(deviceTokensTable.token, t));
    }
  } catch (err) {
    logger.error({ err }, "Expo push send failed");
  }
}

async function sendMessagesInBatches(messages: ExpoMessage[]): Promise<void> {
  for (let i = 0; i < messages.length; i += 100) {
    await sendChunk(messages.slice(i, i + 100));
  }
}

export async function sendBreakingNewsPush(args: {
  articleId: string;
  slug: string;
  title: string;
  summary: string;
  categoryId?: string | null;
  locationId?: string | null;
}): Promise<void> {
  const rows = await db
    .select({
      token: deviceTokensTable.token,
      userId: deviceTokensTable.userId,
      scope: userProfilesTable.notifBreakingScope,
    })
    .from(deviceTokensTable)
    .innerJoin(userProfilesTable, eq(userProfilesTable.userId, deviceTokensTable.userId))
    .where(eq(userProfilesTable.notifPushEnabled, true));

  if (rows.length === 0) {
    logger.info({ articleId: args.articleId }, "No opted-in devices for breaking push");
    return;
  }

  // Determine filtered users and look up their preferences in batch.
  const filteredUserIds = Array.from(
    new Set(rows.filter((r) => r.scope === "filtered").map((r) => r.userId)),
  );
  const catPrefs = new Map<string, Set<string>>();
  const locPrefs = new Map<string, Set<string>>();
  if (filteredUserIds.length) {
    const cats = await db
      .select()
      .from(pushPrefsCategoriesTable)
      .where(inArray(pushPrefsCategoriesTable.userId, filteredUserIds));
    for (const c of cats) {
      const s = catPrefs.get(c.userId) ?? new Set<string>();
      s.add(c.categoryId);
      catPrefs.set(c.userId, s);
    }
    const locs = await db
      .select()
      .from(pushPrefsLocationsTable)
      .where(inArray(pushPrefsLocationsTable.userId, filteredUserIds));
    for (const l of locs) {
      const s = locPrefs.get(l.userId) ?? new Set<string>();
      s.add(l.locationId);
      locPrefs.set(l.userId, s);
    }
  }

  const eligible = rows.filter((r) => {
    if (r.scope !== "filtered") return true;
    const cats = catPrefs.get(r.userId);
    const locs = locPrefs.get(r.userId);
    // If filtered but no prefs set, treat as no match (user explicitly chose filtered).
    if (!cats && !locs) return false;
    if (cats && args.categoryId && cats.has(args.categoryId)) return true;
    if (locs && args.locationId && locs.has(args.locationId)) return true;
    return false;
  });

  if (eligible.length === 0) {
    logger.info({ articleId: args.articleId }, "No devices matched breaking push filters");
    return;
  }

  // Record one delivery row per eligible recipient so the in-app Alerts inbox
  // can show a reliable history of breaking pushes the user was sent.
  const eligibleUserIds = Array.from(new Set(eligible.map((r) => r.userId)));
  if (eligibleUserIds.length > 0) {
    try {
      await db
        .insert(breakingPushDeliveriesTable)
        .values(
          eligibleUserIds.map((userId) => ({
            userId,
            articleId: args.articleId,
            title: args.title,
            summary: args.summary,
            slug: args.slug,
          })),
        )
        .onConflictDoNothing({
          target: [breakingPushDeliveriesTable.userId, breakingPushDeliveriesTable.articleId],
        });
    } catch (err) {
      logger.error({ err, articleId: args.articleId }, "Failed to record breaking push deliveries");
    }
  }

  const messages: ExpoMessage[] = eligible.map((r) => ({
    to: r.token,
    title: "Breaking news",
    body: args.title,
    sound: "default",
    priority: "high",
    channelId: "breaking",
    data: {
      type: "breaking",
      articleId: args.articleId,
      slug: args.slug,
    },
  }));

  await sendMessagesInBatches(messages);
  logger.info({ articleId: args.articleId, count: messages.length }, "Sent breaking news push");
}

export async function sendFollowedWriterPush(args: {
  articleId: string;
  slug: string;
  title: string;
  writerId: string;
}): Promise<void> {
  const rows = await db
    .select({ token: deviceTokensTable.token, userId: deviceTokensTable.userId })
    .from(followsWritersTable)
    .innerJoin(userProfilesTable, eq(userProfilesTable.userId, followsWritersTable.followerId))
    .innerJoin(deviceTokensTable, eq(deviceTokensTable.userId, followsWritersTable.followerId))
    .where(
      and(
        eq(followsWritersTable.writerId, args.writerId),
        eq(userProfilesTable.notifPushEnabled, true),
        eq(userProfilesTable.notifFollowedWriters, true),
      ),
    );

  if (rows.length === 0) {
    logger.info({ articleId: args.articleId }, "No followers for writer push");
    return;
  }

  // Look up writer display name. Avoid falling back to email so push titles
  // never leak PII on lock screens.
  const [writer] = await db
    .select({ display: userProfilesTable.displayName })
    .from(usersTable)
    .leftJoin(userProfilesTable, eq(userProfilesTable.userId, usersTable.id))
    .where(eq(usersTable.id, args.writerId));
  const writerName = writer?.display ?? "A writer you follow";

  const messages: ExpoMessage[] = rows.map((r) => ({
    to: r.token,
    title: `New story from ${writerName}`,
    body: args.title,
    sound: "default",
    channelId: "breaking",
    data: {
      type: "writer_post",
      articleId: args.articleId,
      slug: args.slug,
      writerId: args.writerId,
    },
  }));

  await sendMessagesInBatches(messages);
  logger.info({ articleId: args.articleId, count: messages.length }, "Sent followed-writer push");
}
