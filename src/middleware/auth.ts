import { type Request, type Response, type NextFunction } from "express";
import { auth } from "../lib/better-auth";

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  req.isAuthenticated = function (this: Request) {
    return this.user != null;
  } as Request["isAuthenticated"];

  // Skip better-auth's own routes — they handle auth internally
  if (req.path.startsWith("/api/auth/")) {
    next();
    return;
  }

  try {
    const session = await auth.api.getSession({
      headers: req.headers as unknown as Headers,
    });


    if (session?.user) {
      req.user = {
        id: session.user.id,
        email: session.user.email ?? null,
        firstName: (session.user as Record<string, unknown>).firstName as string ?? null,
        lastName: (session.user as Record<string, unknown>).lastName as string ?? null,
        profileImageUrl: session.user.image ?? null,
      };
    }
  } catch {
    // Invalid/expired session — continue as unauthenticated
  }

  next();
}
