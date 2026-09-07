#!/usr/bin/env node

'use strict';

require('dotenv/config');

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { Pool } = require('pg');

const STORE_IDS = Object.freeze([2, 15, 18]);
const NAME_PATTERN = '%-New%';
const SOURCE = 'POS_PRE_REGISTRATION_SERVICE';
const MANIFEST_VERSION = 1;
const GRPC_BATCH_SIZE = 10;

const CATEGORY_TARGET_SQL = `
  WITH RECURSIVE direct_targets AS (
    SELECT id
    FROM public.categories
    WHERE name NOT ILIKE $1
  ), category_tree AS (
    SELECT c.id, 0 AS depth, ARRAY[c.id] AS path
    FROM public.categories c
    JOIN direct_targets d ON d.id = c.id

    UNION ALL

    SELECT child.id, parent.depth + 1, parent.path || child.id
    FROM public.categories child
    JOIN category_tree parent ON child.parent_id = parent.id
    WHERE NOT child.id = ANY(parent.path)
  ), target_depth AS (
    SELECT id, MAX(depth)::int AS depth
    FROM category_tree
    GROUP BY id
  )
  SELECT c.*, target_depth.depth AS cleanup_depth
  FROM public.categories c
  JOIN target_depth ON target_depth.id = c.id
  ORDER BY target_depth.depth DESC, c.id ASC
`;

function usage() {
  const executable = path.relative(process.cwd(), __filename) || __filename;
  return [
    'Usage:',
    `  node ${executable} [--dry-run]`,
    `  node ${executable} --apply [--force]`,
    `  node ${executable} --resume <manifest-path>`,
  ].join('\n');
}

function parseArgs(args) {
  let explicitMode = null;
  const result = {
    mode: 'dry-run',
    force: false,
    manifestPath: null,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run') {
      if (explicitMode && explicitMode !== 'dry-run') {
        throw new Error('Choose only one mode.');
      }
      explicitMode = 'dry-run';
    } else if (arg === '--apply') {
      if (explicitMode && explicitMode !== 'apply') {
        throw new Error('Choose only one mode.');
      }
      explicitMode = 'apply';
      result.mode = 'apply';
    } else if (arg === '--force') {
      result.force = true;
    } else if (arg === '--resume') {
      if (explicitMode && explicitMode !== 'resume') {
        throw new Error('Choose only one mode.');
      }
      explicitMode = 'resume';
      const manifestPath = args[index + 1];
      if (!manifestPath || manifestPath.startsWith('--')) {
        throw new Error('--resume requires a manifest path.');
      }
      result.mode = 'resume';
      result.manifestPath = path.resolve(manifestPath);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (result.force && result.mode !== 'apply') {
    throw new Error('--force can only be used with --apply.');
  }
  return result;
}

function requireEnv(names) {
  const missing = names.filter(
    (name) => !String(process.env[name] ?? '').trim(),
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }
}

function buildStoreUrl(baseUrl, prefix, storeId) {
  const url = new URL(baseUrl);
  url.pathname = `/${prefix}_${storeId}`;
  return url.toString();
}

function sourceEventId() {
  const now = new Date();
  return `${now.getDate()}-${now.getMonth() + 1}-${now.getFullYear()}-${crypto
    .randomBytes(5)
    .toString('hex')}`;
}

function toCamelKey(key) {
  return key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
}

function toPayload(row) {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => key !== 'cleanup_depth')
      .map(([key, value]) => [toCamelKey(key), value]),
  );
}

function createSyncEntries(
  categories,
  skuCategories,
  idFactory = sourceEventId,
) {
  return [
    ...skuCategories.map((row) => ({
      entityType: 'SkuCategory',
      entityId: String(row.id),
      operation: 'DELETE',
      payloadVersion: 1,
      payloadJson: JSON.stringify(toPayload(row)),
      source: SOURCE,
      sourceEventId: idFactory(),
    })),
    ...categories.map((row) => ({
      entityType: 'Category',
      entityId: String(row.id),
      operation: 'DELETE',
      payloadVersion: 1,
      payloadJson: JSON.stringify(toPayload(row)),
      source: SOURCE,
      sourceEventId: idFactory(),
    })),
  ];
}

function manifestFilePath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(
    os.tmpdir(),
    `category-cleanup-${stamp}-${process.pid}.json`,
  );
}

function writeManifest(filePath, manifest) {
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, filePath);
}

function readManifest(filePath) {
  const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (
    manifest.version !== MANIFEST_VERSION ||
    !Array.isArray(manifest.grpcEntries)
  ) {
    throw new Error('Unsupported or invalid recovery manifest.');
  }
  return manifest;
}

function normalizedSnapshot(rows) {
  return rows
    .map(toPayload)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    .map((row) => JSON.stringify(row));
}

function assertSnapshotsUnchanged(label, expectedRows, actualRows) {
  const expected = normalizedSnapshot(expectedRows);
  const actual = normalizedSnapshot(actualRows);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(
      `${label} changed after preflight; aborting before primary deletion.`,
    );
  }
}

async function verifyPrimarySchema(pool) {
  await pool.query('SELECT id, name, parent_id FROM public.categories LIMIT 0');
  await pool.query(
    'SELECT id, sku_id, category_id FROM public.sku_categories LIMIT 0',
  );
}

async function verifyStoreSchema(pool) {
  await pool.query(
    `SELECT id, organization_id, store_id, master_category_id, updated_at
     FROM public.selling_category_records LIMIT 0`,
  );
  await pool.query(
    `SELECT target_org_id, target_store_id, entity_type, entity_id,
            operation, payload_version, payload_json, source, source_event_id
     FROM public.server_change_logs LIMIT 0`,
  );
}

async function discoverPrimaryTargets(pool) {
  const categoryResult = await pool.query(CATEGORY_TARGET_SQL, [NAME_PATTERN]);
  const categories = categoryResult.rows;
  const categoryIds = categories.map((row) => Number(row.id));
  const skuCategoryResult = categoryIds.length
    ? await pool.query(
        `SELECT * FROM public.sku_categories
         WHERE category_id = ANY($1::int[])
         ORDER BY id ASC`,
        [categoryIds],
      )
    : { rows: [] };

  return { categories, categoryIds, skuCategories: skuCategoryResult.rows };
}

async function discoverStoreTargets(pool, categoryIds) {
  if (categoryIds.length === 0) return [];
  const result = await pool.query(
    `SELECT * FROM public.selling_category_records
     WHERE master_category_id = ANY($1::text[])
     ORDER BY id ASC`,
    [categoryIds.map(String)],
  );
  return result.rows;
}

async function updateStore(
  pool,
  storeId,
  categoryIds,
  idFactory = sourceEventId,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updatedResult = await client.query(
      `UPDATE public.selling_category_records
       SET master_category_id = NULL, updated_at = NOW()
       WHERE master_category_id = ANY($1::text[])
       RETURNING *`,
      [categoryIds.map(String)],
    );

    for (const row of updatedResult.rows) {
      const payload = toPayload(row);
      await client.query(
        `INSERT INTO public.server_change_logs (
           target_org_id, target_store_id, entity_type, entity_id,
           operation, payload_version, payload_json, source, source_event_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
        [
          Number(row.organization_id),
          storeId,
          'SellingCategoryRecord',
          String(row.id),
          'UPSERT',
          1,
          JSON.stringify(payload),
          SOURCE,
          idFactory(),
        ],
      );
    }

    await client.query('COMMIT');
    return updatedResult.rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function applyPrimaryCleanup(pool, snapshot) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentCategories = await client.query(
      `SELECT * FROM public.categories
       WHERE id = ANY($1::int[])
       ORDER BY id ASC
       FOR UPDATE`,
      [snapshot.categoryIds],
    );
    const currentSkuCategories = await client.query(
      `SELECT * FROM public.sku_categories
       WHERE category_id = ANY($1::int[])
       ORDER BY id ASC
       FOR UPDATE`,
      [snapshot.categoryIds],
    );

    assertSnapshotsUnchanged(
      'Category rows',
      snapshot.categories,
      currentCategories.rows,
    );
    assertSnapshotsUnchanged(
      'SkuCategory rows',
      snapshot.skuCategories,
      currentSkuCategories.rows,
    );

    const deletedLinks = await client.query(
      `DELETE FROM public.sku_categories
       WHERE category_id = ANY($1::int[])
       RETURNING id`,
      [snapshot.categoryIds],
    );

    const depthGroups = new Map();
    for (const category of snapshot.categories) {
      const depth = Number(category.cleanup_depth);
      const ids = depthGroups.get(depth) ?? [];
      ids.push(Number(category.id));
      depthGroups.set(depth, ids);
    }

    let deletedCategories = 0;
    const depths = [...depthGroups.keys()].sort((left, right) => right - left);
    for (const depth of depths) {
      const result = await client.query(
        'DELETE FROM public.categories WHERE id = ANY($1::int[]) RETURNING id',
        [depthGroups.get(depth)],
      );
      deletedCategories += result.rowCount ?? 0;
    }

    if (
      (deletedLinks.rowCount ?? 0) !== snapshot.skuCategories.length ||
      deletedCategories !== snapshot.categories.length
    ) {
      throw new Error(
        'Primary delete counts did not match the preflight snapshot.',
      );
    }

    await client.query('COMMIT');
    return {
      deletedSkuCategories: deletedLinks.rowCount ?? 0,
      deletedCategories,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function createGrpcClient() {
  const protoPath = path.resolve(
    __dirname,
    '..',
    'src/modules/data-sync-grpc/proto/data_sync.proto',
  );
  if (!fs.existsSync(protoPath))
    throw new Error(`gRPC proto not found: ${protoPath}`);
  const definition = protoLoader.loadSync(protoPath, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const loaded = grpc.loadPackageDefinition(definition);
  const Service = loaded.sync.v1.ServerChangeLogService;
  return new Service(
    process.env.DATA_SYNC_GRPC_URL,
    grpc.credentials.createInsecure(),
  );
}

async function waitForGrpc(client, timeoutMs = 5000) {
  await new Promise((resolve, reject) => {
    client.waitForReady(Date.now() + timeoutMs, (error) => {
      if (error)
        reject(new Error(`Data-sync gRPC is not ready: ${error.message}`));
      else resolve();
    });
  });
}

async function callLogChanges(client, apiKey, entries) {
  const metadata = new grpc.Metadata();
  metadata.set('x-api-key', apiKey);
  return new Promise((resolve, reject) => {
    client.logChanges({ entries }, metadata, (error, response) => {
      if (error) return reject(error);
      if (!response?.success) {
        return reject(
          new Error(response?.message || 'Data-sync rejected the change logs.'),
        );
      }
      resolve(response);
    });
  });
}

async function sendGrpcLogs(
  client,
  apiKey,
  entries,
  startIndex = 0,
  onProgress = async () => {},
) {
  let nextIndex = startIndex;
  while (nextIndex < entries.length) {
    const batch = entries.slice(nextIndex, nextIndex + GRPC_BATCH_SIZE);
    await callLogChanges(client, apiKey, batch);
    nextIndex += batch.length;
    await onProgress(nextIndex);
  }
  return nextIndex;
}

function askConfirmation(question) {
  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    terminal.question(question, (answer) => {
      terminal.close();
      resolve(['y', 'yes'].includes(answer.trim().toLowerCase()));
    });
  });
}

function printPreflight(snapshot, storeRows) {
  console.log('\nCategory cleanup preflight');
  console.log(
    `  Match: all levels where name NOT ILIKE '${NAME_PATTERN}', plus descendants`,
  );
  console.log(
    `  Category IDs (${snapshot.categories.length}): ${snapshot.categoryIds.join(', ') || 'none'}`,
  );
  console.log(`  SKU-category links: ${snapshot.skuCategories.length}`);
  for (const storeId of STORE_IDS) {
    console.log(
      `  Store ${storeId} selling-category references: ${storeRows.get(storeId).length}`,
    );
  }
}

async function resumeGrpc(manifestPath) {
  requireEnv(['DATA_SYNC_GRPC_URL', 'DATA_SYNC_GRPC_API_KEY']);
  const manifest = readManifest(manifestPath);
  if (!manifest.primaryCommitted) {
    throw new Error(
      'This manifest cannot resume gRPC logs because primary deletion did not commit.',
    );
  }
  if (manifest.completed) {
    console.log('Manifest is already complete; nothing to resume.');
    return;
  }

  const client = createGrpcClient();
  try {
    await waitForGrpc(client);
    manifest.nextGrpcIndex = await sendGrpcLogs(
      client,
      process.env.DATA_SYNC_GRPC_API_KEY.trim(),
      manifest.grpcEntries,
      manifest.nextGrpcIndex ?? 0,
      async (nextIndex) => {
        manifest.nextGrpcIndex = nextIndex;
        writeManifest(manifestPath, manifest);
      },
    );
    manifest.completed = true;
    manifest.completedAt = new Date().toISOString();
    writeManifest(manifestPath, manifest);
    console.log(
      `Recovery complete: ${manifest.grpcEntries.length} gRPC logs acknowledged.`,
    );
  } finally {
    client.close();
  }
}

async function runCleanup(options) {
  requireEnv(['DATABASE_URL', 'STORE_DATABASE_URL']);
  if (options.mode === 'apply') {
    requireEnv(['DATA_SYNC_GRPC_URL', 'DATA_SYNC_GRPC_API_KEY']);
  }

  const primaryPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const storePrefix = String(process.env.STORE_DB_PREFIX || 'pos_store').trim();
  const storeRows = new Map();
  let grpcClient = null;

  try {
    await verifyPrimarySchema(primaryPool);
    const snapshot = await discoverPrimaryTargets(primaryPool);

    for (const storeId of STORE_IDS) {
      const pool = new Pool({
        connectionString: buildStoreUrl(
          process.env.STORE_DATABASE_URL,
          storePrefix,
          storeId,
        ),
      });
      try {
        await verifyStoreSchema(pool);
        storeRows.set(
          storeId,
          await discoverStoreTargets(pool, snapshot.categoryIds),
        );
      } finally {
        await pool.end();
      }
    }

    printPreflight(snapshot, storeRows);
    if (snapshot.categories.length === 0) {
      console.log('\nNothing to delete.');
      return;
    }
    if (options.mode === 'dry-run') {
      console.log(
        '\nDRY RUN complete — no database writes or gRPC logs were made.',
      );
      return;
    }

    grpcClient = createGrpcClient();
    await waitForGrpc(grpcClient);

    if (!options.force) {
      const confirmed = await askConfirmation(
        `\nDelete ${snapshot.categories.length} categories and unlink related records? (y/N) `,
      );
      if (!confirmed) {
        console.log('Aborted; no changes were made.');
        return;
      }
    }

    const filePath = manifestFilePath();
    const manifest = {
      version: MANIFEST_VERSION,
      createdAt: new Date().toISOString(),
      criteria: { nameNotIlike: NAME_PATTERN, includeDescendants: true },
      storeIds: [...STORE_IDS],
      categoryIds: snapshot.categoryIds,
      completedStores: [],
      primaryCommitted: false,
      nextGrpcIndex: 0,
      completed: false,
      grpcEntries: createSyncEntries(
        snapshot.categories,
        snapshot.skuCategories,
      ),
    };
    writeManifest(filePath, manifest);
    console.log(`Recovery manifest: ${filePath}`);

    for (const storeId of STORE_IDS) {
      const pool = new Pool({
        connectionString: buildStoreUrl(
          process.env.STORE_DATABASE_URL,
          storePrefix,
          storeId,
        ),
      });
      try {
        const updated = await updateStore(pool, storeId, snapshot.categoryIds);
        manifest.completedStores.push(storeId);
        writeManifest(filePath, manifest);
        console.log(
          `Store ${storeId}: updated and logged ${updated.length} rows.`,
        );
      } finally {
        await pool.end();
      }
    }

    const primaryResult = await applyPrimaryCleanup(primaryPool, snapshot);
    manifest.primaryCommitted = true;
    manifest.primaryResult = primaryResult;
    writeManifest(filePath, manifest);
    console.log(
      `Primary DB: deleted ${primaryResult.deletedSkuCategories} SKU links and ` +
        `${primaryResult.deletedCategories} categories.`,
    );

    try {
      manifest.nextGrpcIndex = await sendGrpcLogs(
        grpcClient,
        process.env.DATA_SYNC_GRPC_API_KEY.trim(),
        manifest.grpcEntries,
        0,
        async (nextIndex) => {
          manifest.nextGrpcIndex = nextIndex;
          writeManifest(filePath, manifest);
        },
      );
      manifest.completed = true;
      manifest.completedAt = new Date().toISOString();
      writeManifest(filePath, manifest);
      console.log(
        `Data-sync: ${manifest.grpcEntries.length} DELETE logs acknowledged.`,
      );
      console.log('Category cleanup completed successfully.');
    } catch (error) {
      console.error(
        `Data cleanup committed, but gRPC logging failed: ${error.message}`,
      );
      console.error(
        `Resume without repeating database changes:\n  node ${path.relative(process.cwd(), __filename) || __filename} --resume ${filePath}`,
      );
      throw error;
    }
  } finally {
    if (grpcClient) grpcClient.close();
    await primaryPool.end();
  }
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    if (options.mode === 'resume') await resumeGrpc(options.manifestPath);
    else await runCleanup(options);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  CATEGORY_TARGET_SQL,
  STORE_IDS,
  applyPrimaryCleanup,
  assertSnapshotsUnchanged,
  buildStoreUrl,
  createSyncEntries,
  parseArgs,
  sendGrpcLogs,
  toPayload,
  updateStore,
};

if (require.main === module) {
  main();
}
