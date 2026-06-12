import { Router, type IRouter } from "express";
import {
  db,
  crmContactsTable,
  crmOrganizationsTable,
  crmActivitiesTable,
  crmTasksTable,
  locationsTable,
  usersTable,
  userProfilesTable,
} from "@workspace/db";
import { and, desc, eq, gte, ilike, isNull, or, sql, count } from "drizzle-orm";
import { requireAdmin } from "../middleware/requireRole";
import { audit } from "../utils/audit";

const router: IRouter = Router();
router.use(requireAdmin);

type ContactRow = typeof crmContactsTable.$inferSelect;
type OrgRow = typeof crmOrganizationsTable.$inferSelect;
type ActivityRow = typeof crmActivitiesTable.$inferSelect;
type TaskRow = typeof crmTasksTable.$inferSelect;
type UserRow = typeof usersTable.$inferSelect;
type ProfileRow = typeof userProfilesTable.$inferSelect;
type LocationRow = typeof locationsTable.$inferSelect;

function userRef(user: UserRow | null, profile: ProfileRow | null) {
  if (!user) return null;
  return {
    id: user.id,
    displayName: profile?.displayName ?? user.email ?? "User",
    email: user.email ?? null,
    profileImageUrl: user.profileImageUrl ?? null,
  };
}

function orgRef(o: OrgRow | null) {
  if (!o) return null;
  return { id: o.id, name: o.name, type: o.type };
}

function locationRef(l: LocationRow | null) {
  if (!l) return null;
  return {
    id: l.id,
    slug: l.slug,
    type: l.type,
    nameHi: l.nameHi,
    nameEn: l.nameEn,
  };
}

function contactRef(c: ContactRow | null) {
  if (!c) return null;
  return { id: c.id, fullName: c.fullName };
}

async function mapContact(c: ContactRow) {
  const [org] = c.organizationId
    ? await db.select().from(crmOrganizationsTable).where(eq(crmOrganizationsTable.id, c.organizationId))
    : [null as OrgRow | null];
  const [loc] = c.locationId
    ? await db.select().from(locationsTable).where(eq(locationsTable.id, c.locationId))
    : [null as LocationRow | null];
  let assigned = null;
  if (c.assignedTo) {
    const [row] = await db
      .select({ u: usersTable, p: userProfilesTable })
      .from(usersTable)
      .leftJoin(userProfilesTable, eq(userProfilesTable.userId, usersTable.id))
      .where(eq(usersTable.id, c.assignedTo));
    assigned = row ? userRef(row.u, row.p) : null;
  }
  return {
    id: c.id,
    fullName: c.fullName,
    type: c.type,
    phone: c.phone,
    email: c.email,
    whatsapp: c.whatsapp,
    roleTitle: c.roleTitle,
    address: c.address,
    source: c.source,
    notes: c.notes,
    tags: c.tags ?? [],
    isArchived: c.isArchived,
    organization: orgRef(org ?? null),
    location: locationRef(loc ?? null),
    assignedUser: assigned,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

async function mapOrganization(o: OrgRow) {
  const [loc] = o.locationId
    ? await db.select().from(locationsTable).where(eq(locationsTable.id, o.locationId))
    : [null as LocationRow | null];
  const [{ value: contactCount }] = await db
    .select({ value: count() })
    .from(crmContactsTable)
    .where(eq(crmContactsTable.organizationId, o.id));
  return {
    id: o.id,
    name: o.name,
    type: o.type,
    website: o.website,
    phone: o.phone,
    email: o.email,
    address: o.address,
    notes: o.notes,
    location: locationRef(loc ?? null),
    contactCount: Number(contactCount ?? 0),
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

async function mapActivity(a: ActivityRow) {
  let contact: ContactRow | null = null;
  if (a.contactId) {
    const [c] = await db.select().from(crmContactsTable).where(eq(crmContactsTable.id, a.contactId));
    contact = c ?? null;
  }
  let org: OrgRow | null = null;
  if (a.organizationId) {
    const [o] = await db.select().from(crmOrganizationsTable).where(eq(crmOrganizationsTable.id, a.organizationId));
    org = o ?? null;
  }
  let createdByUser = null;
  if (a.createdBy) {
    const [row] = await db
      .select({ u: usersTable, p: userProfilesTable })
      .from(usersTable)
      .leftJoin(userProfilesTable, eq(userProfilesTable.userId, usersTable.id))
      .where(eq(usersTable.id, a.createdBy));
    createdByUser = row ? userRef(row.u, row.p) : null;
  }
  return {
    id: a.id,
    type: a.type,
    subject: a.subject,
    body: a.body,
    occurredAt: a.occurredAt.toISOString(),
    contact: contactRef(contact),
    organization: orgRef(org),
    createdByUser,
    createdAt: a.createdAt.toISOString(),
  };
}

async function mapTask(t: TaskRow) {
  let contact: ContactRow | null = null;
  if (t.contactId) {
    const [c] = await db.select().from(crmContactsTable).where(eq(crmContactsTable.id, t.contactId));
    contact = c ?? null;
  }
  let org: OrgRow | null = null;
  if (t.organizationId) {
    const [o] = await db.select().from(crmOrganizationsTable).where(eq(crmOrganizationsTable.id, t.organizationId));
    org = o ?? null;
  }
  let assignedUser = null;
  if (t.assignedTo) {
    const [row] = await db
      .select({ u: usersTable, p: userProfilesTable })
      .from(usersTable)
      .leftJoin(userProfilesTable, eq(userProfilesTable.userId, usersTable.id))
      .where(eq(usersTable.id, t.assignedTo));
    assignedUser = row ? userRef(row.u, row.p) : null;
  }
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    contact: contactRef(contact),
    organization: orgRef(org),
    assignedUser,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

// ----- Summary -----
router.get("/admin/crm/summary", async (_req, res) => {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [contactsTotal] = await db.select({ v: count() }).from(crmContactsTable);
  const [orgsTotal] = await db.select({ v: count() }).from(crmOrganizationsTable);
  const [openTasks] = await db
    .select({ v: count() })
    .from(crmTasksTable)
    .where(or(eq(crmTasksTable.status, "open"), eq(crmTasksTable.status, "in_progress")));
  const [actsWeek] = await db
    .select({ v: count() })
    .from(crmActivitiesTable)
    .where(gte(crmActivitiesTable.occurredAt, weekAgo));

  const byType = await db
    .select({ type: crmContactsTable.type, c: count() })
    .from(crmContactsTable)
    .groupBy(crmContactsTable.type);

  const recentAct = await db
    .select()
    .from(crmActivitiesTable)
    .orderBy(desc(crmActivitiesTable.occurredAt))
    .limit(10);
  const recentActivities = await Promise.all(recentAct.map(mapActivity));

  const now = new Date();
  const overdueRaw = await db
    .select()
    .from(crmTasksTable)
    .where(
      and(
        or(eq(crmTasksTable.status, "open"), eq(crmTasksTable.status, "in_progress")),
        sql`${crmTasksTable.dueAt} IS NOT NULL`,
        sql`${crmTasksTable.dueAt} < ${now.toISOString()}`,
      ),
    )
    .orderBy(crmTasksTable.dueAt)
    .limit(10);
  const overdueTasks = await Promise.all(overdueRaw.map(mapTask));

  const upcomingRaw = await db
    .select()
    .from(crmTasksTable)
    .where(
      and(
        or(eq(crmTasksTable.status, "open"), eq(crmTasksTable.status, "in_progress")),
        sql`(${crmTasksTable.dueAt} IS NULL OR ${crmTasksTable.dueAt} >= ${now.toISOString()})`,
      ),
    )
    .orderBy(sql`${crmTasksTable.dueAt} ASC NULLS LAST`)
    .limit(10);
  const upcomingTasks = await Promise.all(upcomingRaw.map(mapTask));

  res.json({
    totals: {
      contacts: Number(contactsTotal?.v ?? 0),
      organizations: Number(orgsTotal?.v ?? 0),
      openTasks: Number(openTasks?.v ?? 0),
      activitiesThisWeek: Number(actsWeek?.v ?? 0),
    },
    byContactType: byType.map((r) => ({ type: r.type, count: Number(r.c) })),
    recentActivities,
    overdueTasks,
    upcomingTasks,
  });
});

// ----- Contacts -----
router.get("/admin/crm/contacts", async (req, res) => {
  const q = (req.query.q as string | undefined)?.trim();
  const type = req.query.type as string | undefined;
  const assignedTo = req.query.assignedTo as string | undefined;
  const organizationId = req.query.organizationId as string | undefined;
  const tag = req.query.tag as string | undefined;
  const archived = req.query.archived === "true" ? true : req.query.archived === "false" ? false : undefined;
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const offset = Number(req.query.offset ?? 0);

  const wheres = [] as any[];
  if (q) {
    wheres.push(
      or(
        ilike(crmContactsTable.fullName, `%${q}%`),
        ilike(crmContactsTable.email, `%${q}%`),
        ilike(crmContactsTable.phone, `%${q}%`),
      ),
    );
  }
  if (type) wheres.push(eq(crmContactsTable.type, type));
  if (assignedTo) wheres.push(eq(crmContactsTable.assignedTo, assignedTo));
  if (organizationId) wheres.push(eq(crmContactsTable.organizationId, organizationId));
  if (tag) wheres.push(sql`${crmContactsTable.tags} @> ${JSON.stringify([tag])}::jsonb`);
  if (archived !== undefined) wheres.push(eq(crmContactsTable.isArchived, archived));
  else wheres.push(eq(crmContactsTable.isArchived, false));

  const whereExpr = wheres.length ? and(...wheres) : undefined;

  const rows = await db
    .select()
    .from(crmContactsTable)
    .where(whereExpr as any)
    .orderBy(desc(crmContactsTable.updatedAt))
    .limit(limit)
    .offset(offset);
  const [{ v: total }] = await db.select({ v: count() }).from(crmContactsTable).where(whereExpr as any);
  const items = await Promise.all(rows.map(mapContact));
  res.json({ items, total: Number(total ?? 0) });
});

router.post("/admin/crm/contacts", async (req, res) => {
  const b = req.body ?? {};
  if (!b.fullName || typeof b.fullName !== "string") {
    res.status(400).json({ error: { code: "BAD_REQUEST", message: "fullName required" } });
    return;
  }
  const [row] = await db
    .insert(crmContactsTable)
    .values({
      fullName: b.fullName,
      type: b.type || "supporter",
      phone: b.phone ?? null,
      email: b.email ?? null,
      whatsapp: b.whatsapp ?? null,
      organizationId: b.organizationId ?? null,
      roleTitle: b.roleTitle ?? null,
      locationId: b.locationId ?? null,
      address: b.address ?? null,
      source: b.source ?? null,
      notes: b.notes ?? null,
      tags: Array.isArray(b.tags) ? b.tags : [],
      isArchived: !!b.isArchived,
      assignedTo: b.assignedTo ?? null,
      createdBy: req.user!.id,
    })
    .returning();
  await audit(req.user!.id, "crm.contact.create", "crm_contact", row.id, row.fullName);
  res.json(await mapContact(row));
});

router.get("/admin/crm/contacts/:id", async (req, res) => {
  const [c] = await db.select().from(crmContactsTable).where(eq(crmContactsTable.id, req.params.id));
  if (!c) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Contact not found" } });
    return;
  }
  const acts = await db
    .select()
    .from(crmActivitiesTable)
    .where(eq(crmActivitiesTable.contactId, c.id))
    .orderBy(desc(crmActivitiesTable.occurredAt))
    .limit(100);
  const tasks = await db
    .select()
    .from(crmTasksTable)
    .where(eq(crmTasksTable.contactId, c.id))
    .orderBy(desc(crmTasksTable.createdAt))
    .limit(100);
  res.json({
    contact: await mapContact(c),
    activities: await Promise.all(acts.map(mapActivity)),
    tasks: await Promise.all(tasks.map(mapTask)),
  });
});

router.patch("/admin/crm/contacts/:id", async (req, res) => {
  const b = req.body ?? {};
  const updates: Partial<typeof crmContactsTable.$inferInsert> = {};
  for (const k of [
    "fullName",
    "type",
    "phone",
    "email",
    "whatsapp",
    "organizationId",
    "roleTitle",
    "locationId",
    "address",
    "source",
    "notes",
    "assignedTo",
  ] as const) {
    if (k in b) (updates as any)[k] = b[k] ?? null;
  }
  if ("tags" in b && Array.isArray(b.tags)) updates.tags = b.tags;
  if ("isArchived" in b) updates.isArchived = !!b.isArchived;
  const [row] = await db
    .update(crmContactsTable)
    .set(updates)
    .where(eq(crmContactsTable.id, req.params.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Contact not found" } });
    return;
  }
  await audit(req.user!.id, "crm.contact.update", "crm_contact", row.id);
  res.json(await mapContact(row));
});

router.delete("/admin/crm/contacts/:id", async (req, res) => {
  await db.delete(crmContactsTable).where(eq(crmContactsTable.id, req.params.id));
  await audit(req.user!.id, "crm.contact.delete", "crm_contact", req.params.id);
  res.json({ ok: true });
});

// ----- Organizations -----
router.get("/admin/crm/organizations", async (req, res) => {
  const q = (req.query.q as string | undefined)?.trim();
  const type = req.query.type as string | undefined;
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const offset = Number(req.query.offset ?? 0);
  const wheres = [] as any[];
  if (q) wheres.push(ilike(crmOrganizationsTable.name, `%${q}%`));
  if (type) wheres.push(eq(crmOrganizationsTable.type, type));
  const whereExpr = wheres.length ? and(...wheres) : undefined;
  const rows = await db
    .select()
    .from(crmOrganizationsTable)
    .where(whereExpr as any)
    .orderBy(desc(crmOrganizationsTable.updatedAt))
    .limit(limit)
    .offset(offset);
  const [{ v: total }] = await db.select({ v: count() }).from(crmOrganizationsTable).where(whereExpr as any);
  const items = await Promise.all(rows.map(mapOrganization));
  res.json({ items, total: Number(total ?? 0) });
});

router.post("/admin/crm/organizations", async (req, res) => {
  const b = req.body ?? {};
  if (!b.name) {
    res.status(400).json({ error: { code: "BAD_REQUEST", message: "name required" } });
    return;
  }
  const [row] = await db
    .insert(crmOrganizationsTable)
    .values({
      name: b.name,
      type: b.type || "other",
      website: b.website ?? null,
      phone: b.phone ?? null,
      email: b.email ?? null,
      locationId: b.locationId ?? null,
      address: b.address ?? null,
      notes: b.notes ?? null,
      createdBy: req.user!.id,
    })
    .returning();
  await audit(req.user!.id, "crm.org.create", "crm_organization", row.id, row.name);
  res.json(await mapOrganization(row));
});

router.get("/admin/crm/organizations/:id", async (req, res) => {
  const [o] = await db.select().from(crmOrganizationsTable).where(eq(crmOrganizationsTable.id, req.params.id));
  if (!o) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Organization not found" } });
    return;
  }
  const cs = await db
    .select()
    .from(crmContactsTable)
    .where(eq(crmContactsTable.organizationId, o.id))
    .orderBy(desc(crmContactsTable.updatedAt));
  const acts = await db
    .select()
    .from(crmActivitiesTable)
    .where(eq(crmActivitiesTable.organizationId, o.id))
    .orderBy(desc(crmActivitiesTable.occurredAt))
    .limit(50);
  res.json({
    organization: await mapOrganization(o),
    contacts: await Promise.all(cs.map(mapContact)),
    activities: await Promise.all(acts.map(mapActivity)),
  });
});

router.patch("/admin/crm/organizations/:id", async (req, res) => {
  const b = req.body ?? {};
  const updates: Partial<typeof crmOrganizationsTable.$inferInsert> = {};
  for (const k of ["name", "type", "website", "phone", "email", "locationId", "address", "notes"] as const) {
    if (k in b) (updates as any)[k] = b[k] ?? null;
  }
  const [row] = await db
    .update(crmOrganizationsTable)
    .set(updates)
    .where(eq(crmOrganizationsTable.id, req.params.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Organization not found" } });
    return;
  }
  await audit(req.user!.id, "crm.org.update", "crm_organization", row.id);
  res.json(await mapOrganization(row));
});

router.delete("/admin/crm/organizations/:id", async (req, res) => {
  await db.delete(crmOrganizationsTable).where(eq(crmOrganizationsTable.id, req.params.id));
  await audit(req.user!.id, "crm.org.delete", "crm_organization", req.params.id);
  res.json({ ok: true });
});

// ----- Activities -----
router.get("/admin/crm/activities", async (req, res) => {
  const contactId = req.query.contactId as string | undefined;
  const organizationId = req.query.organizationId as string | undefined;
  const type = req.query.type as string | undefined;
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const wheres = [] as any[];
  if (contactId) wheres.push(eq(crmActivitiesTable.contactId, contactId));
  if (organizationId) wheres.push(eq(crmActivitiesTable.organizationId, organizationId));
  if (type) wheres.push(eq(crmActivitiesTable.type, type));
  const rows = await db
    .select()
    .from(crmActivitiesTable)
    .where(wheres.length ? and(...wheres) : (undefined as any))
    .orderBy(desc(crmActivitiesTable.occurredAt))
    .limit(limit);
  res.json(await Promise.all(rows.map(mapActivity)));
});

router.post("/admin/crm/activities", async (req, res) => {
  const b = req.body ?? {};
  if (!b.type || !b.subject) {
    res.status(400).json({ error: { code: "BAD_REQUEST", message: "type and subject required" } });
    return;
  }
  if (!b.contactId && !b.organizationId) {
    res.status(400).json({ error: { code: "BAD_REQUEST", message: "Provide contactId or organizationId" } });
    return;
  }
  const [row] = await db
    .insert(crmActivitiesTable)
    .values({
      type: b.type,
      subject: b.subject,
      body: b.body ?? null,
      occurredAt: b.occurredAt ? new Date(b.occurredAt) : new Date(),
      contactId: b.contactId ?? null,
      organizationId: b.organizationId ?? null,
      createdBy: req.user!.id,
    })
    .returning();
  await audit(req.user!.id, "crm.activity.create", "crm_activity", row.id, row.subject);
  res.json(await mapActivity(row));
});

router.delete("/admin/crm/activities/:id", async (req, res) => {
  await db.delete(crmActivitiesTable).where(eq(crmActivitiesTable.id, req.params.id));
  await audit(req.user!.id, "crm.activity.delete", "crm_activity", req.params.id);
  res.json({ ok: true });
});

// ----- Tasks -----
router.get("/admin/crm/tasks", async (req, res) => {
  const status = req.query.status as string | undefined;
  const assignedTo = req.query.assignedTo as string | undefined;
  const contactId = req.query.contactId as string | undefined;
  const organizationId = req.query.organizationId as string | undefined;
  const limit = Math.min(Number(req.query.limit ?? 100), 200);
  const wheres = [] as any[];
  if (status) wheres.push(eq(crmTasksTable.status, status));
  if (assignedTo) wheres.push(eq(crmTasksTable.assignedTo, assignedTo));
  if (contactId) wheres.push(eq(crmTasksTable.contactId, contactId));
  if (organizationId) wheres.push(eq(crmTasksTable.organizationId, organizationId));
  const rows = await db
    .select()
    .from(crmTasksTable)
    .where(wheres.length ? and(...wheres) : (undefined as any))
    .orderBy(sql`${crmTasksTable.dueAt} ASC NULLS LAST`, desc(crmTasksTable.createdAt))
    .limit(limit);
  res.json(await Promise.all(rows.map(mapTask)));
});

router.post("/admin/crm/tasks", async (req, res) => {
  const b = req.body ?? {};
  if (!b.title) {
    res.status(400).json({ error: { code: "BAD_REQUEST", message: "title required" } });
    return;
  }
  const [row] = await db
    .insert(crmTasksTable)
    .values({
      title: b.title,
      description: b.description ?? null,
      status: b.status || "open",
      priority: b.priority || "normal",
      dueAt: b.dueAt ? new Date(b.dueAt) : null,
      contactId: b.contactId ?? null,
      organizationId: b.organizationId ?? null,
      assignedTo: b.assignedTo ?? null,
      createdBy: req.user!.id,
    })
    .returning();
  await audit(req.user!.id, "crm.task.create", "crm_task", row.id, row.title);
  res.json(await mapTask(row));
});

router.patch("/admin/crm/tasks/:id", async (req, res) => {
  const b = req.body ?? {};
  const updates: Partial<typeof crmTasksTable.$inferInsert> = {};
  for (const k of ["title", "description", "priority", "contactId", "organizationId", "assignedTo"] as const) {
    if (k in b) (updates as any)[k] = b[k] ?? null;
  }
  if ("dueAt" in b) updates.dueAt = b.dueAt ? new Date(b.dueAt) : null;
  if ("status" in b) {
    updates.status = b.status;
    if (b.status === "done") updates.completedAt = new Date();
    else updates.completedAt = null;
  }
  const [row] = await db
    .update(crmTasksTable)
    .set(updates)
    .where(eq(crmTasksTable.id, req.params.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Task not found" } });
    return;
  }
  await audit(req.user!.id, "crm.task.update", "crm_task", row.id);
  res.json(await mapTask(row));
});

router.delete("/admin/crm/tasks/:id", async (req, res) => {
  await db.delete(crmTasksTable).where(eq(crmTasksTable.id, req.params.id));
  await audit(req.user!.id, "crm.task.delete", "crm_task", req.params.id);
  res.json({ ok: true });
});

export default router;
