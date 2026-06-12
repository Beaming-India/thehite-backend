export function slugify(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 160);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base || "article"}-${suffix}`;
}
