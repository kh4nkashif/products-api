# Products API

A backend for browsing ~200,000 products (newest first), with category filtering and stable cursor-based pagination.

## Live URL
> Replace with your deployed Render URL

## Stack
- **Node.js + Express** — minimal, easy to reason about
- **PostgreSQL on Neon** — free tier, excellent indexing support

## Running locally

```bash
cp .env.example .env
# Fill in DATABASE_URL from Neon dashboard

npm install
npm run seed     # Creates table, indexes, inserts 200k rows (~15s)
npm start        # API on http://localhost:3000
```

Open `http://localhost:3000` for the UI.

## API

### `GET /products`
| Param | Type | Description |
|---|---|---|
| `limit` | number | Page size (default 20, max 100) |
| `cursor` | string | Opaque token from previous response |
| `category` | string | Filter by category name |

**Response:**
```json
{
  "data": [{ "id": 1, "name": "...", "category": "...", "price": "9.99", "created_at": "...", "updated_at": "..." }],
  "pagination": {
    "limit": 20,
    "hasNextPage": true,
    "nextCursor": "eyJ..."
  }
}
```

### `GET /categories`
Returns list of distinct category names.

### `GET /health`
Returns `{ "ok": true }`.

---

## The core design decision: cursor pagination

**Why not `LIMIT x OFFSET y`?**

Offset pagination is simple but fragile. If 50 new products are inserted while a user is on page 3, every subsequent page shifts — they'll see duplicates or skip rows entirely.

**Cursor pagination** anchors each page to a specific row. The cursor encodes `(created_at, id)` — the exact sort key. The query becomes:

```sql
WHERE (created_at < $cursor_ts OR (created_at = $cursor_ts AND id < $cursor_id))
ORDER BY created_at DESC, id DESC
LIMIT n
```

No matter how many rows are inserted or updated, the user's position in the list is stable.

**The index matters:** A composite index on `(created_at DESC, id DESC)` lets Postgres satisfy both the `ORDER BY` and the cursor `WHERE` clause with a single index scan — no table sort, no seq scan. On 200k rows this keeps queries under ~5ms.

---

## Seeding

`seed.js` uses batched multi-value `INSERT` statements (5,000 rows per query) instead of a loop. This is ~50× faster than inserting row-by-row because it eliminates per-row network round-trips and transaction overhead.

---

## What I'd improve with more time

1. **`updated_at` sort option** — the task mentions data "being updated", so a second sort mode (recently-updated first) would be useful, with its own index.
2. **Total count estimate** — Postgres `COUNT(*)` on 200k rows is slow; I'd use `reltuples` from `pg_class` for an approximate count to show "~200,000 products".
3. **Search** — full-text search on `name` with a `tsvector` column and GIN index.
4. **Rate limiting** — add `express-rate-limit` before deploying publicly.
5. **Connection pooling** — PgBouncer or Neon's built-in pooling for higher concurrency.

---

## How I used AI

I used Claude to scaffold the boilerplate (Express setup, HTML/CSS for the UI) and to sense-check the cursor pagination SQL. The core design — choosing cursor over offset pagination and understanding *why* it's correct — I worked through myself, because that's the actual engineering challenge here.

Things I caught / adjusted:
- Initial cursor only encoded `id`, not `(created_at, id)` — that breaks ordering correctness when timestamps collide (many products share the same second). Fixed to composite key.
- The UI originally fetched categories on every page change — moved it to a one-time call on load.
