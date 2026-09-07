/**
 * normalize-store-status-values.ts
 *
 * Normalizes status columns in all store databases to only "ACTIVE" or "INACTIVE".
 * Maps: "active" → "ACTIVE", "inactive" → "INACTIVE", "disabled" → "INACTIVE"
 *
* # Preview changes (safe)
  npm run db:normalize:status:dry

  # Apply changes
  npm run db:normalize:status
 * Usage: npx ts-node scripts/normalize-store-status-values.ts [--dry-run]
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const STORE_DB_PREFIX = process.env.STORE_DB_PREFIX || 'pos_store';
const MASTER_DATABASE_URL = process.env.DATABASE_URL!;
const STORE_DATABASE_URL = process.env.STORE_DATABASE_URL!;

const TABLES_TO_NORMALIZE = [
  'selling_sku_records',
  'sku_outlet_records',
  'discount_setup_records',
  'outlet_category_records',
  'selling_category_records',
  'tax_records',
  'outlet_brand_records',
  'outlet_product_records',
  'selling_brand_records',
  'selling_product_records',
];

/**
 * Normalize any status string to "ACTIVE" or "INACTIVE".
 * Handles: any case, whitespace, trailing "d"/"ed"/"s", typos.
 */
function normalizeStatus(raw: string): string | null {
  const s = raw.trim().toLowerCase();

  // Exact matches
  if (s === 'active' || s === 'actived' || s === 'actives') return 'ACTIVE';

  if (
    s === 'inactive' ||
    s === 'inactived' ||
    s === 'inactives' ||
    s === 'disabled' ||
    s === 'disabledd' ||
    s === 'disableds' ||
    s === 'disable' ||
    s === 'deactivated' ||
    s === 'deactivateds'
  ) {
    return 'INACTIVE';
  }

  // Fuzzy: strip common suffixes and re-check
  const stripped = s.replace(/d$|ed$|s$|ss$/, '').replace(/ness$/, '');

  if (stripped === 'active' || stripped === 'act') return 'ACTIVE';
  if (
    stripped === 'inactiv' ||
    stripped === 'inact' ||
    stripped === 'disabl' ||
    stripped === 'disab' ||
    stripped === 'deactiv'
  ) {
    return 'INACTIVE';
  }

  return null;
}

const DRY_RUN = process.argv.includes('--dry-run');

async function getAllStoreIds(adminPool: Pool): Promise<number[]> {
  const { rows } = await adminPool.query(
    `SELECT id FROM "stores" ORDER BY id ASC`,
  );
  return rows.map((r: any) => r.id);
}

async function normalizeTable(
  client: Pool,
  tableName: string,
): Promise<{ changed: number; details: string[] }> {
  const details: string[] = [];
  let changed = 0;

  // Find all non-uppercase values
  const { rows: badRows } = await client.query(
    `SELECT DISTINCT status FROM "${tableName}" WHERE status IS NOT NULL AND status NOT IN ('ACTIVE', 'INACTIVE')`,
  );

  for (const row of badRows) {
    const current = row.status as string;
    const normalized = normalizeStatus(current);

    if (!normalized) {
      details.push(
        `  ⚠️  Unknown value "${current}" in ${tableName} — skipping`,
      );
      continue;
    }

    if (DRY_RUN) {
      const { rows: countRows } = await client.query(
        `SELECT COUNT(*)::int AS cnt FROM "${tableName}" WHERE status = $1`,
        [current],
      );
      details.push(
        `  [DRY RUN] Would update ${countRows[0].cnt} rows: "${current}" → "${normalized}"`,
      );
      changed += countRows[0].cnt;
    } else {
      const result = await client.query(
        `UPDATE "${tableName}" SET status = $1 WHERE status = $2`,
        [normalized, current],
      );
      details.push(
        `  Updated ${result.rowCount} rows: "${current}" → "${normalized}"`,
      );
      changed += result.rowCount!;
    }
  }

  return { changed, details };
}

async function main() {
  console.log(
    `\n🔧 Normalize Store Status Values ${DRY_RUN ? '(DRY RUN)' : ''}`,
  );
  console.log('='.repeat(60));

  const adminPool = new Pool({ connectionString: MASTER_DATABASE_URL });

  try {
    const storeIds = await getAllStoreIds(adminPool);
    console.log(`\nFound ${storeIds.length} stores\n`);

    for (const storeId of storeIds) {
      const dbName = `${STORE_DB_PREFIX}_${storeId}`;
      console.log(`📦 Store ${storeId} (${dbName})`);

      const storeUrl = new URL(STORE_DATABASE_URL);
      storeUrl.pathname = `/${dbName}`;
      const storePool = new Pool({
        connectionString: storeUrl.toString(),
      });

      try {
        for (const table of TABLES_TO_NORMALIZE) {
          const { details } = await normalizeTable(storePool, table);
          if (details.length > 0) {
            console.log(`  📋 ${table}`);
            for (const d of details) {
              console.log(d);
            }
          }
        }
      } catch (err: any) {
        console.log(`  ❌ Error: ${err.message}`);
      } finally {
        await storePool.end();
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(
      DRY_RUN
        ? '✅ Dry run complete. Re-run without --dry-run to apply changes.'
        : '✅ All stores normalized.',
    );
  } finally {
    await adminPool.end();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
