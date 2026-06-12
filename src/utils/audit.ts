import { db, auditLogTable } from "@workspace/db";

export async function audit(
  actorId: string | null,
  action: string,
  targetType: string | null,
  targetId: string | null,
  note?: string,
): Promise<void> {
  await db.insert(auditLogTable).values({ actorId, action, targetType, targetId, note: note ?? null });
}
