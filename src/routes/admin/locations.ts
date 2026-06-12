import { Router, type IRouter } from "express";
import {
  db,
  articlesTable,
  locationsTable,
  locationResourcesTable,
  usersTable,
  userProfilesTable,
  followsLocationsTable,
  validationReportSharesTable,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { randomBytes } from "crypto";
import {
  ListAdminLocationsQueryParams,
  ListAdminLocationsResponse,
  ListLocationWritersParams,
  ListLocationWritersResponse,
  CreateLocationBody,
  UpdateLocationParams,
  UpdateLocationBody,
  UpdateLocationResponse,
  DeleteLocationParams,
  DeleteLocationResponse,
  ImportLocationsBody,
  ImportLocationsResponse,
  ListAdminLocationResourcesParams,
  ListAdminLocationResourcesResponse,
  CreateLocationResourceParams,
  CreateLocationResourceBody,
  UpdateLocationResourceParams,
  UpdateLocationResourceBody,
  UpdateLocationResourceResponse,
  DeleteLocationResourceParams,
  DeleteLocationResourceResponse,
  ReorderLocationResourcesParams,
  ReorderLocationResourcesBody,
  ReorderLocationResourcesResponse,
  CreateValidationReportShareBody,
} from "@workspace/api-zod";
import { audit } from "../../utils/audit";
import { slugify } from "../../utils/slug";
import { logger } from "../../lib/logger";

const REQUIRED_PARENT_TYPE: Record<string, string | null> = {
  state: null,
  district: "state",
  assembly: "district",
  block: "district",
  village: "block",
};

const VALID_LOCATION_TYPES = ["state", "district", "assembly", "block", "village"] as const;
type LocationType = (typeof VALID_LOCATION_TYPES)[number];

async function validateParent(
  childType: string,
  parentId: string | null | undefined,
  selfId?: string,
): Promise<{ ok: true } | { ok: false; status: number; code: string; message: string }> {
  const requiredType = REQUIRED_PARENT_TYPE[childType];
  if (!parentId) {
    if (requiredType) {
      return { ok: false, status: 400, code: "PARENT_REQUIRED", message: `A ${childType} must have a ${requiredType} parent` };
    }
    return { ok: true };
  }
  if (selfId && parentId === selfId) {
    return { ok: false, status: 400, code: "INVALID_PARENT", message: "A location cannot be its own parent" };
  }
  const [parent] = await db.select().from(locationsTable).where(eq(locationsTable.id, parentId));
  if (!parent) {
    return { ok: false, status: 400, code: "INVALID_PARENT", message: "Parent location not found" };
  }
  if (requiredType && parent.type !== requiredType) {
    return { ok: false, status: 400, code: "INVALID_PARENT_TYPE", message: `A ${childType} must be under a ${requiredType}, not a ${parent.type}` };
  }
  if (!requiredType) {
    return { ok: false, status: 400, code: "INVALID_PARENT", message: `A ${childType} cannot have a parent` };
  }
  if (selfId) {
    let cursor: string | null = parent.parentId;
    const seen = new Set<string>([parent.id]);
    while (cursor) {
      if (cursor === selfId) {
        return { ok: false, status: 400, code: "INVALID_PARENT", message: "Cannot assign a descendant as parent" };
      }
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const [next]: { parentId: string | null }[] = await db
        .select({ parentId: locationsTable.parentId })
        .from(locationsTable)
        .where(eq(locationsTable.id, cursor));
      cursor = next?.parentId ?? null;
    }
  }
  return { ok: true };
}

function mapLocation(
  r: typeof locationsTable.$inferSelect,
  articleCount = 0,
  writerCount = 0,
  followerCount = 0,
  writerArticleCount?: number,
) {
  return {
    id: r.id,
    slug: r.slug,
    type: r.type as LocationType,
    nameHi: r.nameHi,
    nameEn: r.nameEn,
    parentId: r.parentId,
    articleCount,
    writerCount,
    followerCount,
    ...(writerArticleCount !== undefined ? { writerArticleCount } : {}),
  };
}

function mapResource(r: typeof locationResourcesTable.$inferSelect) {
  return {
    id: r.id,
    category: r.category as "administration" | "police" | "health" | "education" | "emergency" | "utility" | "other",
    nameHi: r.nameHi,
    nameEn: r.nameEn,
    phone: r.phone,
    address: r.address,
    mapsQuery: r.mapsQuery,
    sortOrder: r.sortOrder,
  };
}

async function loadLocationBySlug(slug: string) {
  const [loc] = await db.select().from(locationsTable).where(eq(locationsTable.slug, slug));
  return loc;
}

const router: IRouter = Router();

router.get("/admin/locations/export.csv", async (req, res): Promise<void> => {
  const typesParam = typeof req.query.types === "string" ? req.query.types : undefined;
  const typeParam = typeof req.query.type === "string" ? req.query.type : undefined;
  const rawTypes = typesParam ?? typeParam;
  let filterTypes: LocationType[] | undefined;

  if (rawTypes !== undefined) {
    const parts = rawTypes.split(",").map((s) => s.trim()).filter(Boolean);
    const invalid = parts.find((p) => !(VALID_LOCATION_TYPES as readonly string[]).includes(p));
    if (invalid) {
      res.status(400).json({ error: `Invalid type "${invalid}". Must be one of: ${VALID_LOCATION_TYPES.join(", ")}` });
      return;
    }
    filterTypes = parts.length > 0 ? (parts as LocationType[]) : undefined;
  }

  const parentLoc = alias(locationsTable, "parent_loc");
  const conds = filterTypes && filterTypes.length > 0 ? [inArray(locationsTable.type, filterTypes)] : [];
  const rows = await db
    .select({ loc: locationsTable, parentSlug: parentLoc.slug })
    .from(locationsTable)
    .leftJoin(parentLoc, eq(parentLoc.id, locationsTable.parentId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(locationsTable.type), asc(locationsTable.nameEn));

  const escape = (v: string | null | undefined) => {
    const s = v ?? "";
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const filename = filterTypes?.length ? `locations-${filterTypes.join("-")}.csv` : "locations.csv";
  const lines: string[] = ["type,slug,name_hi,name_en,parent_slug"];
  for (const r of rows) {
    lines.push([escape(r.loc.type), escape(r.loc.slug), escape(r.loc.nameHi), escape(r.loc.nameEn), escape(r.parentSlug)].join(","));
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(lines.join("\r\n"));
});

router.get("/admin/locations/dormant-writers", async (_req, res): Promise<void> => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const rows = await db.execute(sql`
    WITH writer_last_pub AS (
      SELECT a.location_id, a.writer_id, MAX(a.published_at) AS last_published
      FROM ${articlesTable} a WHERE a.status = 'published'
      GROUP BY a.location_id, a.writer_id
    )
    SELECT
      l.id, l.slug, l.name_hi AS "nameHi", l.name_en AS "nameEn", l.type,
      COUNT(wlp.writer_id) FILTER (WHERE wlp.last_published <= ${thirtyDaysAgo}) AS "inactiveWriterCount",
      COUNT(wlp.writer_id) AS "totalWriterCount"
    FROM writer_last_pub wlp
    JOIN ${locationsTable} l ON l.id = wlp.location_id
    GROUP BY l.id, l.slug, l.name_hi, l.name_en, l.type
    HAVING COUNT(wlp.writer_id) FILTER (WHERE wlp.last_published <= ${thirtyDaysAgo}) > 0
    ORDER BY "inactiveWriterCount" DESC LIMIT 10
  `);
  res.json(
    rows.rows.map((r: any) => ({
      id: String(r.id),
      slug: String(r.slug),
      nameHi: String(r.nameHi),
      nameEn: String(r.nameEn),
      type: String(r.type),
      inactiveWriterCount: Number(r.inactiveWriterCount),
      totalWriterCount: Number(r.totalWriterCount),
    })),
  );
});

router.get("/admin/locations", async (req, res): Promise<void> => {
  const q = ListAdminLocationsQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  const conds = [];
  if (q.data.type) conds.push(eq(locationsTable.type, q.data.type));
  if (q.data.parentId) conds.push(eq(locationsTable.parentId, q.data.parentId));
  if (q.data.writerId) {
    conds.push(sql`EXISTS (SELECT 1 FROM ${articlesTable} WHERE ${articlesTable.locationId} = ${locationsTable.id} AND ${articlesTable.writerId} = ${q.data.writerId} AND ${articlesTable.status} = 'published')`);
  }
  if (q.data.coverage === "has_writers") {
    conds.push(sql`EXISTS (SELECT 1 FROM ${articlesTable} WHERE ${articlesTable.locationId} = ${locationsTable.id} AND ${articlesTable.writerId} IS NOT NULL)`);
  } else if (q.data.coverage === "no_writers") {
    conds.push(sql`NOT EXISTS (SELECT 1 FROM ${articlesTable} WHERE ${articlesTable.locationId} = ${locationsTable.id} AND ${articlesTable.writerId} IS NOT NULL)`);
  }
  const writerId = q.data.writerId;
  const rows = await db
    .select({
      loc: locationsTable,
      articleCount: sql<number>`(select count(*)::int from ${articlesTable} where ${articlesTable.locationId} = ${locationsTable.id})`,
      writerCount: sql<number>`(select count(distinct ${articlesTable.writerId})::int from ${articlesTable} where ${articlesTable.locationId} = ${locationsTable.id} and ${articlesTable.writerId} is not null)`,
      followerCount: sql<number>`(select count(*)::int from ${followsLocationsTable} where ${followsLocationsTable.locationId} = ${locationsTable.id})`,
      writerArticleCount: writerId
        ? sql<number>`(select count(*)::int from ${articlesTable} where ${articlesTable.locationId} = ${locationsTable.id} and ${articlesTable.writerId} = ${writerId} and ${articlesTable.status} = 'published')`
        : sql<number>`0`,
    })
    .from(locationsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(locationsTable.nameEn));
  res.json(
    ListAdminLocationsResponse.parse(
      rows.map((r) =>
        mapLocation(r.loc, Number(r.articleCount), Number(r.writerCount), Number(r.followerCount), writerId ? Number(r.writerArticleCount) : undefined),
      ),
    ),
  );
});

router.get("/admin/locations/:id/writers", async (req, res): Promise<void> => {
  const p = ListLocationWritersParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [loc] = await db.select({ id: locationsTable.id }).from(locationsTable).where(eq(locationsTable.id, p.data.id));
  if (!loc) { res.status(404).json({ error: "Location not found" }); return; }
  const rows = await db
    .select({
      id: usersTable.id,
      displayName: userProfilesTable.displayName,
      profileImageUrl: usersTable.profileImageUrl,
      role: userProfilesTable.role,
      articleCount: sql<number>`count(${articlesTable.id})::int`,
      lastPublishedAt: sql<Date | null>`max(${articlesTable.publishedAt})`,
    })
    .from(articlesTable)
    .innerJoin(usersTable, eq(usersTable.id, articlesTable.writerId))
    .innerJoin(userProfilesTable, eq(userProfilesTable.userId, articlesTable.writerId))
    .where(and(eq(articlesTable.locationId, p.data.id), eq(articlesTable.status, "published")))
    .groupBy(usersTable.id, userProfilesTable.displayName, usersTable.profileImageUrl, userProfilesTable.role)
    .orderBy(desc(sql`max(${articlesTable.publishedAt})`));
  res.json(
    ListLocationWritersResponse.parse(
      rows.map((r) => ({
        id: r.id,
        displayName: r.displayName,
        profileImageUrl: r.profileImageUrl ?? null,
        role: r.role,
        articleCount: r.articleCount,
        lastPublishedAt: r.lastPublishedAt ?? null,
      })),
    ),
  );
});

router.post("/admin/locations", async (req, res): Promise<void> => {
  const b = CreateLocationBody.safeParse(req.body);
  if (!b.success) { res.status(400).json({ error: b.error.message }); return; }
  const slug = slugify(b.data.slug);
  if (!slug) { res.status(400).json({ error: { code: "INVALID_SLUG", message: "Slug is required" } }); return; }
  const parentCheck = await validateParent(b.data.type, b.data.parentId ?? null);
  if (!parentCheck.ok) {
    res.status(parentCheck.status).json({ error: { code: parentCheck.code, message: parentCheck.message } });
    return;
  }
  const [existing] = await db.select().from(locationsTable).where(eq(locationsTable.slug, slug));
  if (existing) { res.status(409).json({ error: { code: "SLUG_TAKEN", message: "Slug already in use" } }); return; }
  const [loc] = await db
    .insert(locationsTable)
    .values({ slug, type: b.data.type, nameHi: b.data.nameHi, nameEn: b.data.nameEn, parentId: b.data.parentId ?? null })
    .returning();
  await audit(req.user!.id, "location.create", "location", loc.id, slug);
  res.status(201).json(mapLocation(loc, 0));
});

router.patch("/admin/locations/:id", async (req, res): Promise<void> => {
  const p = UpdateLocationParams.safeParse(req.params);
  const b = UpdateLocationBody.safeParse(req.body);
  if (!p.success || !b.success) {
    res.status(400).json({ error: p.success ? b.error?.message : p.error.message });
    return;
  }
  const [current] = await db.select().from(locationsTable).where(eq(locationsTable.id, p.data.id));
  if (!current) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Location not found" } }); return; }
  const nextType = b.data.type ?? current.type;
  const nextParentId = b.data.parentId !== undefined ? (b.data.parentId ?? null) : current.parentId;
  if (b.data.type !== undefined || b.data.parentId !== undefined) {
    const parentCheck = await validateParent(nextType, nextParentId, p.data.id);
    if (!parentCheck.ok) {
      res.status(parentCheck.status).json({ error: { code: parentCheck.code, message: parentCheck.message } });
      return;
    }
  }
  const update: Record<string, unknown> = {};
  if (b.data.slug !== undefined) {
    const slug = slugify(b.data.slug);
    if (!slug) { res.status(400).json({ error: { code: "INVALID_SLUG", message: "Slug is required" } }); return; }
    const [other] = await db.select().from(locationsTable).where(eq(locationsTable.slug, slug));
    if (other && other.id !== p.data.id) {
      res.status(409).json({ error: { code: "SLUG_TAKEN", message: "Slug already in use" } });
      return;
    }
    update.slug = slug;
  }
  if (b.data.type !== undefined) update.type = b.data.type;
  if (b.data.nameHi !== undefined) update.nameHi = b.data.nameHi;
  if (b.data.nameEn !== undefined) update.nameEn = b.data.nameEn;
  if (b.data.parentId !== undefined) update.parentId = b.data.parentId;
  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: { code: "EMPTY_UPDATE", message: "Provide at least one field to update" } });
    return;
  }
  const [loc] = await db.update(locationsTable).set(update).where(eq(locationsTable.id, p.data.id)).returning();
  if (!loc) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Location not found" } }); return; }
  await audit(req.user!.id, "location.update", "location", loc.id, loc.slug);
  res.json(UpdateLocationResponse.parse(mapLocation(loc, 0)));
});

router.delete("/admin/locations/:id", async (req, res): Promise<void> => {
  const p = DeleteLocationParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [children] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(locationsTable)
    .where(eq(locationsTable.parentId, p.data.id));
  if (Number(children?.count ?? 0) > 0) {
    res.status(409).json({ error: { code: "HAS_CHILDREN", message: "Remove or reassign child locations first" } });
    return;
  }
  const [loc] = await db.delete(locationsTable).where(eq(locationsTable.id, p.data.id)).returning();
  if (!loc) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Location not found" } }); return; }
  await audit(req.user!.id, "location.delete", "location", p.data.id, loc.slug);
  res.json(DeleteLocationResponse.parse({ deleted: true }));
});

router.post("/admin/locations/import", async (req, res): Promise<void> => {
  const b = ImportLocationsBody.safeParse(req.body);
  if (!b.success) { res.status(400).json({ error: b.error.message }); return; }
  const { rows, dryRun = false } = b.data;
  const allExisting = await db
    .select({ id: locationsTable.id, slug: locationsTable.slug, type: locationsTable.type })
    .from(locationsTable);
  const bySlug = new Map(allExisting.map((r) => [r.slug, { id: r.id, type: r.type }]));

  type ImportResult = {
    row: number;
    status: "created" | "skipped" | "failed";
    slug: string | null;
    message: string | null;
    location: { id: string; slug: string; type: LocationType; nameHi: string; nameEn: string; parentId: string | null; articleCount: number } | null;
  };
  const results: ImportResult[] = [];
  let created = 0, skipped = 0, failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = i + 1;
    const slug = slugify(raw.slug);
    if (!slug) { results.push({ row: rowNum, status: "failed", slug: null, message: "Slug is required", location: null }); failed++; continue; }
    if (bySlug.has(slug)) { results.push({ row: rowNum, status: "skipped", slug, message: "Slug already exists", location: null }); skipped++; continue; }
    const nameHi = raw.nameHi?.trim();
    const nameEn = raw.nameEn?.trim();
    if (!nameHi || !nameEn) { results.push({ row: rowNum, status: "failed", slug, message: "nameHi and nameEn are required", location: null }); failed++; continue; }

    let parentId: string | null = null;
    const requiredParentType = REQUIRED_PARENT_TYPE[raw.type];
    const parentSlug = raw.parentSlug ? slugify(raw.parentSlug) : null;
    if (requiredParentType) {
      if (!parentSlug) { results.push({ row: rowNum, status: "failed", slug, message: `A ${raw.type} requires a parent_slug (${requiredParentType})`, location: null }); failed++; continue; }
      const parent = bySlug.get(parentSlug);
      if (!parent) { results.push({ row: rowNum, status: "failed", slug, message: `Parent slug "${parentSlug}" not found`, location: null }); failed++; continue; }
      if (parent.type !== requiredParentType) { results.push({ row: rowNum, status: "failed", slug, message: `A ${raw.type} must be under a ${requiredParentType}, not a ${parent.type}`, location: null }); failed++; continue; }
      parentId = parent.id;
    } else if (parentSlug) {
      results.push({ row: rowNum, status: "failed", slug, message: `A ${raw.type} cannot have a parent`, location: null }); failed++; continue;
    }

    if (dryRun) {
      bySlug.set(slug, { id: `dry-run-${slug}`, type: raw.type });
      results.push({ row: rowNum, status: "created", slug, message: null, location: { id: `dry-run-${slug}`, slug, type: raw.type, nameHi, nameEn, parentId, articleCount: 0 } });
      created++;
    } else {
      try {
        const [loc] = await db.insert(locationsTable).values({ slug, type: raw.type, nameHi, nameEn, parentId }).returning();
        bySlug.set(slug, { id: loc.id, type: loc.type });
        results.push({ row: rowNum, status: "created", slug, message: null, location: mapLocation(loc, 0) });
        created++;
      } catch (e: unknown) {
        results.push({ row: rowNum, status: "failed", slug, message: String((e as Error)?.message ?? e), location: null }); failed++;
      }
    }
  }

  if (!dryRun) {
    await audit(req.user!.id, "location.import", "location", null, `created=${created} skipped=${skipped} failed=${failed}`);
  }
  res.json(ImportLocationsResponse.parse({ dryRun, created, skipped, failed, results }));
});

router.post("/admin/locations/import-stream", async (req, res): Promise<void> => {
  const b = ImportLocationsBody.safeParse(req.body);
  if (!b.success) { res.status(400).json({ error: b.error.message }); return; }
  const { rows, dryRun = false } = b.data;

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const allExisting = await db
    .select({ id: locationsTable.id, slug: locationsTable.slug, type: locationsTable.type })
    .from(locationsTable);
  const bySlug = new Map(allExisting.map((r) => [r.slug, { id: r.id, type: r.type }]));

  type StreamResult = {
    row: number;
    status: "created" | "skipped" | "failed";
    slug: string | null;
    message: string | null;
    location: { id: string; slug: string; type: LocationType; nameHi: string; nameEn: string; parentId: string | null; articleCount: number } | null;
  };
  const results: StreamResult[] = [];
  let created = 0, skipped = 0, failed = 0;
  const sendLine = (obj: unknown) => res.write(JSON.stringify(obj) + "\n");

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = i + 1;
    const slug = slugify(raw.slug);
    if (!slug) {
      results.push({ row: rowNum, status: "failed", slug: null, message: "Slug is required", location: null }); failed++;
    } else if (bySlug.has(slug)) {
      results.push({ row: rowNum, status: "skipped", slug, message: "Slug already exists", location: null }); skipped++;
    } else {
      const nameHi = raw.nameHi?.trim();
      const nameEn = raw.nameEn?.trim();
      if (!nameHi || !nameEn) {
        results.push({ row: rowNum, status: "failed", slug, message: "nameHi and nameEn are required", location: null }); failed++;
      } else {
        let parentId: string | null = null;
        const requiredParentType = REQUIRED_PARENT_TYPE[raw.type];
        const parentSlug = raw.parentSlug ? slugify(raw.parentSlug) : null;
        let rowFailed = false;
        if (requiredParentType) {
          if (!parentSlug) {
            results.push({ row: rowNum, status: "failed", slug, message: `A ${raw.type} requires a parent_slug (${requiredParentType})`, location: null }); failed++; rowFailed = true;
          } else {
            const parent = bySlug.get(parentSlug);
            if (!parent) {
              results.push({ row: rowNum, status: "failed", slug, message: `Parent slug "${parentSlug}" not found`, location: null }); failed++; rowFailed = true;
            } else if (parent.type !== requiredParentType) {
              results.push({ row: rowNum, status: "failed", slug, message: `A ${raw.type} must be under a ${requiredParentType}, not a ${parent.type}`, location: null }); failed++; rowFailed = true;
            } else {
              parentId = parent.id;
            }
          }
        } else if (parentSlug) {
          results.push({ row: rowNum, status: "failed", slug, message: `A ${raw.type} cannot have a parent`, location: null }); failed++; rowFailed = true;
        }
        if (!rowFailed) {
          if (dryRun) {
            bySlug.set(slug, { id: `dry-run-${slug}`, type: raw.type });
            results.push({ row: rowNum, status: "created", slug, message: null, location: { id: `dry-run-${slug}`, slug, type: raw.type, nameHi, nameEn, parentId, articleCount: 0 } }); created++;
          } else {
            try {
              const [loc] = await db.insert(locationsTable).values({ slug, type: raw.type, nameHi, nameEn, parentId }).returning();
              bySlug.set(slug, { id: loc.id, type: loc.type });
              results.push({ row: rowNum, status: "created", slug, message: null, location: mapLocation(loc, 0) }); created++;
            } catch (e: unknown) {
              results.push({ row: rowNum, status: "failed", slug, message: String((e as Error)?.message ?? e), location: null }); failed++;
            }
          }
        }
      }
    }
    sendLine({ type: "progress", processed: rowNum, total: rows.length });
  }

  if (!dryRun) {
    await audit(req.user!.id, "location.import", "location", null, `created=${created} skipped=${skipped} failed=${failed}`);
  }
  sendLine({ type: "done", dryRun, created, skipped, failed, results: ImportLocationsResponse.shape.results.parse(results) });
  res.end();
});

// --- location resources ---

router.get("/admin/locations/:slug/resources", async (req, res): Promise<void> => {
  const p = ListAdminLocationResourcesParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const loc = await loadLocationBySlug(p.data.slug);
  if (!loc) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Location not found" } }); return; }
  const rows = await db
    .select()
    .from(locationResourcesTable)
    .where(eq(locationResourcesTable.locationId, loc.id))
    .orderBy(asc(locationResourcesTable.sortOrder), asc(locationResourcesTable.nameEn));
  res.json(ListAdminLocationResourcesResponse.parse(rows.map(mapResource)));
});

router.post("/admin/locations/:slug/resources", async (req, res): Promise<void> => {
  const p = CreateLocationResourceParams.safeParse(req.params);
  const b = CreateLocationResourceBody.safeParse(req.body);
  if (!p.success || !b.success) {
    res.status(400).json({ error: p.success ? b.error?.message : p.error.message });
    return;
  }
  const loc = await loadLocationBySlug(p.data.slug);
  if (!loc) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Location not found" } }); return; }
  const [r] = await db
    .insert(locationResourcesTable)
    .values({
      locationId: loc.id,
      category: b.data.category,
      nameHi: b.data.nameHi,
      nameEn: b.data.nameEn,
      phone: b.data.phone ?? null,
      address: b.data.address ?? null,
      mapsQuery: b.data.mapsQuery ?? null,
      sortOrder: b.data.sortOrder ?? 0,
    })
    .returning();
  await audit(req.user!.id, "location_resource.create", "location_resource", r.id, loc.slug);
  res.status(201).json(mapResource(r));
});

router.patch("/admin/locations/:slug/resources/:id", async (req, res): Promise<void> => {
  const p = UpdateLocationResourceParams.safeParse(req.params);
  const b = UpdateLocationResourceBody.safeParse(req.body);
  if (!p.success || !b.success) {
    res.status(400).json({ error: p.success ? b.error?.message : p.error.message });
    return;
  }
  const loc = await loadLocationBySlug(p.data.slug);
  if (!loc) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Location not found" } }); return; }
  const update: Record<string, unknown> = {};
  if (b.data.category !== undefined) update.category = b.data.category;
  if (b.data.nameHi !== undefined) update.nameHi = b.data.nameHi;
  if (b.data.nameEn !== undefined) update.nameEn = b.data.nameEn;
  if (b.data.phone !== undefined) update.phone = b.data.phone;
  if (b.data.address !== undefined) update.address = b.data.address;
  if (b.data.mapsQuery !== undefined) update.mapsQuery = b.data.mapsQuery;
  if (b.data.sortOrder !== undefined) update.sortOrder = b.data.sortOrder;
  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: { code: "EMPTY_UPDATE", message: "Provide at least one field to update" } });
    return;
  }
  const [r] = await db
    .update(locationResourcesTable)
    .set(update)
    .where(and(eq(locationResourcesTable.id, p.data.id), eq(locationResourcesTable.locationId, loc.id)))
    .returning();
  if (!r) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found" } }); return; }
  await audit(req.user!.id, "location_resource.update", "location_resource", r.id, loc.slug);
  res.json(UpdateLocationResourceResponse.parse(mapResource(r)));
});

router.post("/admin/locations/:slug/resources/reorder", async (req, res): Promise<void> => {
  const p = ReorderLocationResourcesParams.safeParse(req.params);
  const b = ReorderLocationResourcesBody.safeParse(req.body);
  if (!p.success || !b.success) {
    res.status(400).json({ error: p.success ? b.error?.message : p.error.message });
    return;
  }
  const loc = await loadLocationBySlug(p.data.slug);
  if (!loc) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Location not found" } }); return; }
  const existing = await db.select().from(locationResourcesTable).where(eq(locationResourcesTable.locationId, loc.id));
  const existingIds = new Set(existing.map((r) => r.id));
  const seen = new Set<string>();
  for (const id of b.data.ids) {
    if (!existingIds.has(id) || seen.has(id)) {
      res.status(400).json({ error: { code: "BAD_IDS", message: "ids must match resources for this location and be unique" } });
      return;
    }
    seen.add(id);
  }
  if (b.data.ids.length !== existing.length) {
    res.status(400).json({ error: { code: "INCOMPLETE", message: "ids must include every resource for this location" } });
    return;
  }
  await db.transaction(async (tx) => {
    for (let i = 0; i < b.data.ids.length; i++) {
      await tx
        .update(locationResourcesTable)
        .set({ sortOrder: i })
        .where(and(eq(locationResourcesTable.id, b.data.ids[i]!), eq(locationResourcesTable.locationId, loc.id)));
    }
  });
  await audit(req.user!.id, "location_resource.reorder", "location", loc.id, loc.slug);
  const rows = await db
    .select()
    .from(locationResourcesTable)
    .where(eq(locationResourcesTable.locationId, loc.id))
    .orderBy(asc(locationResourcesTable.sortOrder), asc(locationResourcesTable.nameEn));
  res.json(ReorderLocationResourcesResponse.parse(rows.map(mapResource)));
});

router.delete("/admin/locations/:slug/resources/:id", async (req, res): Promise<void> => {
  const p = DeleteLocationResourceParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const loc = await loadLocationBySlug(p.data.slug);
  if (!loc) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Location not found" } }); return; }
  const [r] = await db
    .delete(locationResourcesTable)
    .where(and(eq(locationResourcesTable.id, p.data.id), eq(locationResourcesTable.locationId, loc.id)))
    .returning();
  if (!r) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found" } }); return; }
  await audit(req.user!.id, "location_resource.delete", "location_resource", p.data.id, loc.slug);
  res.json(DeleteLocationResourceResponse.parse({ deleted: true }));
});

// --- validation report sharing ---

const VALIDATION_REPORT_MAX_BYTES = 5 * 1024 * 1024;

router.post("/admin/locations/validation-report/share", async (req, res): Promise<void> => {
  const b = CreateValidationReportShareBody.safeParse(req.body);
  if (!b.success) { res.status(400).json({ error: b.error.message }); return; }
  if (Buffer.byteLength(b.data.csvContent, "utf8") > VALIDATION_REPORT_MAX_BYTES) {
    res.status(413).json({ error: "Report CSV exceeds the 5 MB size limit." });
    return;
  }
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(validationReportSharesTable).values({
    token,
    csvContent: b.data.csvContent,
    rowCount: b.data.rowCount,
    failedCount: b.data.failedCount,
    createdByUserId: req.user!.id,
    expiresAt,
  });
  db.delete(validationReportSharesTable)
    .where(lt(validationReportSharesTable.expiresAt, new Date()))
    .catch((err) => { logger.warn({ err }, "Failed to clean up expired validation report shares"); });
  res.status(201).json({ token, expiresAt: expiresAt.toISOString() });
});

export default router;
