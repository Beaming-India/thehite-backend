export const config = {
  port: Number(process.env["PORT"] ?? 5000),
  databaseUrl: process.env["DATABASE_URL"]!,
  issuerUrl: process.env["ISSUER_URL"]!,
  oidcClientId: process.env["OIDC_CLIENT_ID"]!,
  seedAdminId: process.env["SEED_ADMIN_ID"] ?? "seed-admin",
  logLevel: process.env["LOG_LEVEL"] ?? "info",
  siteBaseUrl: process.env["SITE_BASE_URL"] ?? "",
  nodeEnv: process.env["NODE_ENV"] ?? "development",
} as const;

export const isDev = config.nodeEnv === "development";
