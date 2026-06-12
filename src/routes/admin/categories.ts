import { Router, type IRouter } from "express";
import { db, articlesTable, categoriesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  ListAdminCategoriesResponse,
  CreateCategoryBody,
  UpdateCategoryParams,
  UpdateCategoryBody,
  UpdateCategoryResponse,
  DeleteCategoryParams,
  DeleteCategoryResponse,
  ReorderCategoriesBody,
  ReorderCategoriesResponse,
} from "@workspace/api-zod";
import { audit } from "../../utils/audit";
import { slugify } from "../../utils/slug";

const router: IRouter = Router();

async function listCategoriesWithCount() {
  const rows = await db
    .select({
      id: categoriesTable.id,
      slug: categoriesTable.slug,
      nameHi: categoriesTable.nameHi,
      nameEn: categoriesTable.nameEn,
      sortOrder: categoriesTable.sortOrder,
      articleCount: sql<number>`(select count(*)::int from ${articlesTable} where ${articlesTable.categoryId} = ${categoriesTable.id})`,
    })
    .from(categoriesTable)
    .orderBy(categoriesTable.sortOrder);
  return rows.map((r) => ({ ...r, articleCount: Number(r.articleCount) }));
}

router.get("/admin/categories", async (_req, res): Promise<void> => {
  res.json(ListAdminCategoriesResponse.parse(await listCategoriesWithCount()));
});

router.post("/admin/categories", async (req, res): Promise<void> => {
  const b = CreateCategoryBody.safeParse(req.body);
  if (!b.success) { res.status(400).json({ error: b.error.message }); return; }
  const [c] = await db
    .insert(categoriesTable)
    .values({
      slug: b.data.slug ?? slugify(b.data.nameEn),
      nameHi: b.data.nameHi,
      nameEn: b.data.nameEn,
      sortOrder: b.data.sortOrder ?? 0,
    })
    .returning();
  await audit(req.user!.id, "category.create", "category", c.id);
  res.status(201).json({ ...c, articleCount: 0 });
});

router.post("/admin/categories/reorder", async (req, res): Promise<void> => {
  const b = ReorderCategoriesBody.safeParse(req.body);
  if (!b.success) { res.status(400).json({ error: b.error.message }); return; }
  const existing = await db.select().from(categoriesTable);
  const existingIds = new Set(existing.map((c) => c.id));
  const seen = new Set<string>();
  for (const id of b.data.ids) {
    if (!existingIds.has(id) || seen.has(id)) {
      res.status(400).json({ error: { code: "BAD_IDS", message: "ids must match categories and be unique" } });
      return;
    }
    seen.add(id);
  }
  if (b.data.ids.length !== existing.length) {
    res.status(400).json({ error: { code: "INCOMPLETE", message: "ids must include every category" } });
    return;
  }
  await db.transaction(async (tx) => {
    for (let i = 0; i < b.data.ids.length; i++) {
      await tx.update(categoriesTable).set({ sortOrder: i }).where(eq(categoriesTable.id, b.data.ids[i]!));
    }
  });
  await audit(req.user!.id, "category.reorder", "category", null);
  res.json(ReorderCategoriesResponse.parse(await listCategoriesWithCount()));
});

router.patch("/admin/categories/:id", async (req, res): Promise<void> => {
  const p = UpdateCategoryParams.safeParse(req.params);
  const b = UpdateCategoryBody.safeParse(req.body);
  if (!p.success || !b.success) {
    res.status(400).json({ error: p.success ? b.error?.message : p.error.message });
    return;
  }
  const update: Record<string, unknown> = {};
  if (b.data.nameHi !== undefined) update.nameHi = b.data.nameHi;
  if (b.data.nameEn !== undefined) update.nameEn = b.data.nameEn;
  if (b.data.slug !== undefined) update.slug = b.data.slug;
  if (b.data.sortOrder !== undefined) update.sortOrder = b.data.sortOrder;
  const [c] = await db.update(categoriesTable).set(update).where(eq(categoriesTable.id, p.data.id)).returning();
  if (!c) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Category not found" } }); return; }
  await audit(req.user!.id, "category.update", "category", c.id);
  res.json(UpdateCategoryResponse.parse({ id: c.id, slug: c.slug, nameHi: c.nameHi, nameEn: c.nameEn, sortOrder: c.sortOrder }));
});

router.delete("/admin/categories/:id", async (req, res): Promise<void> => {
  const p = DeleteCategoryParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [c] = await db.delete(categoriesTable).where(eq(categoriesTable.id, p.data.id)).returning();
  if (!c) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Category not found" } }); return; }
  await audit(req.user!.id, "category.delete", "category", p.data.id);
  res.json(DeleteCategoryResponse.parse({ deleted: true }));
});

export default router;
