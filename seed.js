/**
 * seed.js — Generate and insert 200,000 products fast.
 *
 * Approach: Build large batched INSERTs (5,000 rows per query) instead of
 * looping one row at a time. A single-row loop with 200k iterations takes
 * minutes; batched multi-value inserts finish in seconds.
 *
 * Run: node seed.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const CATEGORIES = [
  'Electronics', 'Clothing', 'Books', 'Home & Garden', 'Sports',
  'Toys', 'Automotive', 'Health', 'Beauty', 'Food & Grocery',
  'Office Supplies', 'Music', 'Movies', 'Pet Supplies', 'Jewelry',
];

const ADJECTIVES = ['Premium', 'Classic', 'Modern', 'Vintage', 'Pro', 'Lite', 'Max', 'Mini', 'Ultra', 'Smart'];
const NOUNS = ['Widget', 'Gadget', 'Device', 'Tool', 'Kit', 'Set', 'Pack', 'Bundle', 'Unit', 'Module'];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomPrice() {
  return (Math.random() * 999 + 1).toFixed(2);
}

function randomDate(start, end) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

async function seed() {
  const client = await pool.connect();

  try {
    console.log('Creating table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id          BIGSERIAL PRIMARY KEY,
        name        TEXT NOT NULL,
        category    TEXT NOT NULL,
        price       NUMERIC(10,2) NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Index on (created_at DESC, id DESC) — the exact order used in pagination query.
    // Composite index means the DB can satisfy ORDER BY + WHERE cursor clause with
    // a single index scan instead of a full table sort.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_products_created_id
        ON products (created_at DESC, id DESC);
    `);

    // Partial index per category for fast filtered queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_products_category_created_id
        ON products (category, created_at DESC, id DESC);
    `);

    console.log('Clearing existing data...');
    await client.query('TRUNCATE products RESTART IDENTITY');

    const TOTAL = 200_000;
    const BATCH = 5_000; // rows per INSERT statement
    const start = new Date('2020-01-01');
    const end = new Date();

    console.log(`Inserting ${TOTAL.toLocaleString()} products in batches of ${BATCH}...`);
    let inserted = 0;

    while (inserted < TOTAL) {
      const batchSize = Math.min(BATCH, TOTAL - inserted);
      const valuePlaceholders = [];
      const values = [];
      let paramIdx = 1;

      for (let i = 0; i < batchSize; i++) {
        const name = `${randomItem(ADJECTIVES)} ${randomItem(NOUNS)} ${Math.floor(Math.random() * 9000 + 1000)}`;
        const category = randomItem(CATEGORIES);
        const price = randomPrice();
        const createdAt = randomDate(start, end);
        const updatedAt = randomDate(createdAt, end);

        valuePlaceholders.push(
          `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`
        );
        values.push(name, category, price, createdAt, updatedAt);
      }

      await client.query(
        `INSERT INTO products (name, category, price, created_at, updated_at) VALUES ${valuePlaceholders.join(',')}`,
        values
      );

      inserted += batchSize;
      process.stdout.write(`\r  ${inserted.toLocaleString()} / ${TOTAL.toLocaleString()}`);
    }

    console.log('\nDone! Verifying count...');
    const { rows } = await client.query('SELECT COUNT(*) FROM products');
    console.log(`Total rows: ${rows[0].count}`);
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
