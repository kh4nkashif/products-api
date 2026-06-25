const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const path = require('path');
const app = express();
app.use(cors());
app.use(express.json());

// Serve the bonus UI
app.use(express.static(path.join(__dirname, '..', 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// GET /products
// Query params:
//   cursor   - base64-encoded "{created_at}_{id}" from previous response (for next page)
//   limit    - page size (default 20, max 100)
//   category - filter by category name (optional)
//   dir      - "next" (default) or "prev"
//
// Why cursor pagination?
//   Offset-based (LIMIT x OFFSET y) breaks when rows are inserted/deleted mid-browse:
//   you skip rows or see duplicates. A cursor anchored to (created_at, id) is stable —
//   even if 50 new products arrive, your position in the list never shifts.

function encodeCursor(createdAt, id) {
  return Buffer.from(`${createdAt.toISOString()}__${id}`).toString('base64url');
}

function decodeCursor(cursor) {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const sepIndex = raw.lastIndexOf('__');
  if (sepIndex === -1) throw new Error('Invalid cursor');
  const createdAt = raw.slice(0, sepIndex);
  const id = raw.slice(sepIndex + 2);
  return { createdAt, id };
}

app.get('/products', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const category = req.query.category || null;
    const cursor = req.query.cursor || null;

    const values = [];
    let idx = 1;

    // Category filter clause
    let categoryClause = '';
    if (category) {
      values.push(category);
      categoryClause = `AND category = $${idx++}`;
    }

    // Cursor clause — we want rows OLDER than the cursor (created_at DESC, id DESC)
    let cursorClause = '';
    if (cursor) {
      const { createdAt, id } = decodeCursor(cursor);
      values.push(createdAt, id);
      // (created_at, id) DESC: next page means strictly before this position
      cursorClause = `AND (created_at < $${idx++} OR (created_at = $${idx - 1} AND id < $${idx++}))`;
    }

    // Fetch limit+1 rows so we know if there's a next page
    values.push(limit + 1);
    const query = `
      SELECT id, name, category, price, created_at, updated_at
      FROM products
      WHERE 1=1
        ${categoryClause}
        ${cursorClause}
      ORDER BY created_at DESC, id DESC
      LIMIT $${idx}
    `;

    const { rows } = await pool.query(query, values);

    const hasNextPage = rows.length > limit;
    const items = hasNextPage ? rows.slice(0, limit) : rows;

    const nextCursor =
      hasNextPage ? encodeCursor(items[items.length - 1].created_at, items[items.length - 1].id) : null;

    res.json({
      data: items,
      pagination: {
        limit,
        hasNextPage,
        nextCursor,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /categories — for filter dropdown
app.get('/categories', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT DISTINCT category FROM products ORDER BY category'
    );
    res.json(rows.map((r) => r.category));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/health', (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
