import { type Request, type Response, type NextFunction } from "express";
import { db, userProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const ADMIN_ROLES = [
  "super_admin",
  "state_admin",
  "district_admin",
  "moderator",
] as const;

export async function getRole(userId: string): Promise<string> {
  const [profile] = await db
    .select()
    .from(userProfilesTable)
    .where(eq(userProfilesTable.userId, userId));
  return profile?.role ?? "reader";
}

export function isAdminRole(role: string): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user?.id) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Login required" } });
    return;
  }
  next();
}

export async function requireWriter(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user?.id) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Login required" } });
    return;
  }
  const role = await getRole(req.user.id);
  if (role !== "writer" && !isAdminRole(role)) {
    res.status(403).json({ error: { code: "FORBIDDEN", message: "Writer role required" } });
    return;
  }
  next();
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user?.id) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Login required" } });
    return;
  }
  const role = await getRole(req.user.id);
  if (!isAdminRole(role)) {
    res.status(403).json({ error: { code: "FORBIDDEN", message: "Admin role required" } });
    return;
  }
  next();
}

export async function requireSuperAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user?.id) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Login required" } });
    return;
  }
  const role = await getRole(req.user.id);
  if (role !== "super_admin") {
    res.status(403).json({ error: { code: "FORBIDDEN", message: "Super admin role required" } });
    return;
  }
  next();
}
