// Migration script: MySQL (old) → PostgreSQL (new)
// Migrates: categories + articles (blogs) from u151751738_thehit.sql
// Does NOT migrate: users/auth

import pg from './node_modules/.pnpm/pg@8.21.0/node_modules/pg/esm/index.mjs';
import fs from 'fs';

const { Client } = pg;
const SQL_FILE = 'C:/Users/Naveen/Downloads/u151751738_thehit.sql';

const client = new Client({
  host: 'localhost', port: 5432,
  database: 'thehit', user: 'postgres', password: 'root',
});

function unquote(v) {
  if (v === null || v === undefined) return null;
  v = String(v).trim();
  if (v === 'NULL') return null;
  if (v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1)
      .replace(/\\'/g, "'").replace(/\\"/g, '"')
      .replace(/\\n/g, '\n').replace(/\\r/g, '\r')
      .replace(/\\\\/g, '\\');
  }
  if (v !== '' && !isNaN(v)) return Number(v);
  return v;
}

function splitValues(str) {
  const vals = [];
  let cur = '', inStr = false, esc = false;
  for (const ch of str) {
    if (esc) { cur += ch; esc = false; continue; }
    if (ch === '\\') { cur += ch; esc = true; continue; }
    if (ch === "'" && !inStr) { inStr = true; cur += ch; continue; }
    if (ch === "'" && inStr) { inStr = false; cur += ch; continue; }
    if (ch === ',' && !inStr) { vals.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  vals.push(cur.trim());
  return vals;
}

// Extract all row tuples from VALUES block — quote-aware depth tracking
function extractTuples(valuesBlock) {
  const tuples = [];
  let depth = 0, cur = '', inStr = false, esc = false;
  for (const ch of valuesBlock) {
    if (esc) { cur += ch; esc = false; continue; }
    if (ch === '\\') { cur += ch; esc = true; continue; }
    if (ch === "'" && !inStr) { inStr = true; cur += ch; continue; }
    if (ch === "'" && inStr) { inStr = false; cur += ch; continue; }
    if (inStr) { cur += ch; continue; }
    if (ch === '(') { depth++; if (depth === 1) { cur = ''; continue; } }
    if (ch === ')') { depth--; if (depth === 0) { tuples.push(cur); cur = ''; continue; } }
    cur += ch;
  }
  return tuples;
}

// Find end of SQL statement (semicolon outside quotes), returns index
function findStatementEnd(sql, start) {
  let inStr = false, esc = false;
  for (let i = start; i < sql.length; i++) {
    const ch = sql[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === "'" && !inStr) { inStr = true; continue; }
    if (ch === "'" && inStr) { inStr = false; continue; }
    if (ch === ';' && !inStr) return i;
  }
  return sql.length;
}

// Parse all INSERT statements for a table, handling both single and multi-row
function parseTable(sqlText, tableName) {
  const rows = [];
  const headerRe = new RegExp(
    `INSERT INTO \`${tableName}\` \\(([^)]+)\\) VALUES`,
    'g'
  );
  let m;
  while ((m = headerRe.exec(sqlText)) !== null) {
    const columns = m[1].split(',').map(c => c.trim().replace(/`/g, ''));
    const valuesStart = m.index + m[0].length;
    const stmtEnd = findStatementEnd(sqlText, valuesStart);
    const valuesBlock = sqlText.slice(valuesStart, stmtEnd);

    const tuples = extractTuples(valuesBlock);
    for (const tuple of tuples) {
      const vals = splitValues(tuple);
      const obj = {};
      columns.forEach((col, i) => { obj[col] = unquote(vals[i]); });
      rows.push(obj);
    }
  }
  return rows;
}

function slugify(text, id) {
  const base = String(text)
    .toLowerCase()
    .replace(/[ऀ-ॿ]/g, c => c.codePointAt(0).toString(16))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 180);
  return `${base || 'article'}-${id}`;
}

async function migrate() {
  console.log('📖 Reading SQL file...');
  const sql = fs.readFileSync(SQL_FILE, 'utf-8');
  console.log(`   Size: ${(sql.length / 1024 / 1024).toFixed(1)} MB`);

  const categories = parseTable(sql, 'categories');
  const blogs = parseTable(sql, 'blogs');
  console.log(`   Found ${categories.length} categories, ${blogs.length} blogs\n`);

  await client.connect();
  console.log('✅ Connected to PostgreSQL\n');

  try {
    await client.query('BEGIN');

    // ── Step 1: Ensure seed-admin user exists ──────────────────────────────
    await client.query(`
      INSERT INTO users (id, email, first_name, last_name)
      VALUES ('seed-admin', 'admin@thehit.in', 'Admin', 'TheHit')
      ON CONFLICT (id) DO NOTHING
    `);
    console.log('✅ seed-admin user ensured');

    // ── Step 2: Insert categories ──────────────────────────────────────────
    const categoryMap = {};

    for (const cat of categories) {
      const slug = String(cat.name)
        .toLowerCase()
        .replace(/[ऀ-ॿ]/g, c => c.codePointAt(0).toString(16))
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 79);

      const res = await client.query(`
        INSERT INTO categories (slug, name_hi, name_en, sort_order)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (slug) DO UPDATE SET name_hi = EXCLUDED.name_hi, sort_order = EXCLUDED.sort_order
        RETURNING id
      `, [slug, cat.name, cat.name, cat.order_place || 0]);

      categoryMap[String(cat.name).trim()] = res.rows[0].id;
      console.log(`  📁 ${cat.name} → ${res.rows[0].id}`);
    }
    console.log(`\n✅ ${categories.length} categories done\n`);

    // ── Step 3: Insert / update articles ──────────────────────────────────
    let inserted = 0, updated = 0, skipped = 0;

    for (const blog of blogs) {
      const slug = slugify(blog.blog_name, blog.blog_id);
      const status = 'published';
      const catName = String(blog.blog_category || '').trim();
      const categoryId = categoryMap[catName] || null;
      const createdAt = new Date(blog.blog_createdon);
      const publishedAt = createdAt;

      try {
        const res = await client.query(`
          INSERT INTO articles (
            slug, title, summary, body, cover_image_url, youtube_url,
            lang, status, writer_id, category_id,
            published_at, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,'hi',$7,'seed-admin',$8,$9,$10,$10)
          ON CONFLICT (slug) DO UPDATE
            SET category_id  = EXCLUDED.category_id,
                status       = EXCLUDED.status,
                published_at = EXCLUDED.published_at,
                title        = EXCLUDED.title,
                summary      = EXCLUDED.summary,
                body         = EXCLUDED.body,
                cover_image_url = EXCLUDED.cover_image_url
          RETURNING (xmax = 0) AS is_insert
        `, [
          slug,
          blog.blog_name,
          String(blog.blog_short_desc || '').slice(0, 2000),
          String(blog.blog_desc || ''),
          blog.blog_image || null,
          blog.blog_youtube || null,
          status,
          categoryId,
          publishedAt,
          createdAt,
        ]);
        if (res.rows[0].is_insert) inserted++; else updated++;
        if ((inserted + updated) % 20 === 0) process.stdout.write(`  ... ${inserted + updated} articles processed\n`);
      } catch (err) {
        console.warn(`  ⚠️  Skipped blog id=${blog.blog_id}: ${err.message}`);
        skipped++;
      }
    }

    console.log(`\n✅ Articles: ${inserted} new, ${updated} updated, ${skipped} skipped`);
    await client.query('COMMIT');
    console.log('\n🎉 Migration complete!');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed, rolled back:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
