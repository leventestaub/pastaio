/**
 * KB query layer.
 *
 * Opens the bundled pastaio-kb.db and exposes typed query functions.
 *
 * Asset loading note: expo-sqlite 16 removed `assetSource` from
 * openDatabaseAsync's options (it's only on SQLiteProvider). We use a
 * singleton pattern, so we copy the bundled .db ourselves via
 * expo-asset + expo-file-system before opening. This is the
 * pre-`assetSource` pattern; works on every SDK version and bypasses
 * the API drift.
 */
import * as SQLite from 'expo-sqlite';
import { Asset } from 'expo-asset';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

// ── Types ──────────────────────────────────────────────────────────

export type EvidenceStrength =
  | 'stg_dop_protected'
  | 'comune_disciplinare'
  | 'accademia_published'
  | 'slow_food_presidia'
  | 'cookbook_consensus'
  | 'contemporary_convention';

export type Confidence =
  | 'directly_stated'
  | 'inferred_from_source'
  | 'synthesized_across_sources';

export type SourceType =
  | 'eu_regulation'
  | 'mipaaf_register'
  | 'comune_disciplinare'
  | 'accademia_publication'
  | 'slow_food_documentation'
  | 'italian_wikipedia_with_citations'
  | 'italian_culinary_magazine'
  | 'regional_government'
  | 'cookbook_excerpt_via_citation';

export type Ingredient = {
  name: string;
  amount: number | null;
  unit: string | null;
  notes?: string;
};

export type RecipeStep = {
  order: number;
  text: string;
  timer_seconds?: number;
};

export type RecipeSummary = {
  recipe_id: string;
  title: string;
  shape_id: string;
  region_id: string | null;
  sauce_category_id: string | null;
  description: string;
  cook_time_minutes: number;
  serves: number;
  tags: string[];
};

export type RecipeDetails = RecipeSummary & {
  ingredients: Ingredient[];
  steps: RecipeStep[];
  traditional_notes: string;
  evidence_strength: EvidenceStrength;
  confidence: Confidence;
};

export type SubstitutionOption = {
  replacement_ingredient: string;
  reasoning: string;
  score: number;
  scope: 'recipe' | 'sauce_category' | 'universal';
};

export type Source = {
  source_id: number;
  source_name: string;
  source_url: string;
  source_type: SourceType;
  source_tier: 1 | 2 | 3;
  quoted_excerpt: string;
  excerpt_translation: string;
  accessed_date: string;  // ISO YYYY-MM-DD
};

export type KbVersion = {
  methodology_version: string;
  built_at: string;
  recipe_count: number;
  substitution_count: number;
  shape_count: number;
  region_count: number;
  source_count: number;
};



// ── DB singleton with manual asset copy ────────────────────────────

const DB_NAME = 'pastaio-kb.db';

// Set true in dev to overwrite any stale copy on every launch. Safe
// because the KB is read-only; user data lives in a different db.
const FORCE_OVERWRITE = true;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function ensureDbCopied(): Promise<void> {
  // expo-sqlite stores databases under a fixed subdirectory.
  const sqliteDir = `${FileSystem.documentDirectory}SQLite`;
  const targetPath = `${sqliteDir}/${DB_NAME}`;

  const dirInfo = await FileSystem.getInfoAsync(sqliteDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(sqliteDir, { intermediates: true });
  }

  const targetInfo = await FileSystem.getInfoAsync(targetPath);
  if (targetInfo.exists && !FORCE_OVERWRITE) {
    console.log('[kb] db already present, skipping copy');
    return;
  }

  // require() returns a numeric module id; Asset.fromModule resolves it.
  const assetModule = require('../../assets/pastaio-kb.db');
  const asset = Asset.fromModule(assetModule);
  await asset.downloadAsync();

  if (!asset.localUri) {
    throw new Error('[kb] asset has no localUri after downloadAsync');
  }

  console.log('[kb] copying', asset.localUri, '->', targetPath);
  if (targetInfo.exists) {
    await FileSystem.deleteAsync(targetPath, { idempotent: true });
  }
  await FileSystem.copyAsync({ from: asset.localUri, to: targetPath });
  console.log('[kb] copy done');
}

async function dumpDiagnostics(db: SQLite.SQLiteDatabase): Promise<void> {
  console.log('━━━━━━━━━━━━━ KB DIAGNOSTIC DUMP ━━━━━━━━━━━━━');
  try {
    console.log('[kb] databasePath:', (db as any).databasePath ?? '(unknown)');
    const tables = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type='table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    );
    console.log(
      '[kb] tables:',
      tables.length === 0 ? '(none — empty db)' : tables.map((t) => t.name),
    );
    const expected = ['shapes', 'regions', 'sauce_categories', 'recipes', 'substitutions'];
    for (const tableName of expected) {
      try {
        const result = await db.getFirstAsync<{ n: number }>(
          `SELECT COUNT(*) AS n FROM ${tableName}`,
        );
        console.log(`[kb] ${tableName}: ${result?.n ?? '?'} rows`);
      } catch (e) {
        console.log(`[kb] ${tableName}: NOT PRESENT (${String(e)})`);
      }
    }
  } catch (err) {
    console.log('[kb] diagnostic dump failed:', String(err));
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

export function openKb(): Promise<SQLite.SQLiteDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    let db: SQLite.SQLiteDatabase;
    if (Platform.OS === 'web') {
      // Web (README capture): no filesystem; load the bundled db into memory.
      const asset = Asset.fromModule(require('../../assets/pastaio-kb.db'));
      const buf = await (await fetch(asset.uri)).arrayBuffer();
      // expo-sqlite web worker can reject while its VFS is still initialising; retry.
      for (let i = 0; ; i++) {
        try {
          db = await SQLite.deserializeDatabaseAsync(new Uint8Array(buf));
          await db.execAsync('PRAGMA foreign_keys = ON');
          break;
        } catch (e) {
          if (i >= 5) throw e;
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    } else {
      await ensureDbCopied();
      db = await SQLite.openDatabaseAsync(DB_NAME);
    }
    await db.execAsync('PRAGMA foreign_keys = ON');
    await dumpDiagnostics(db);
    return db;
  })();
  return dbPromise;
}

// ── Queries (unchanged) ────────────────────────────────────────────

export async function findRecipes(args: {
  shape_id?: string;
  query?: string;
  limit?: number;
}): Promise<RecipeSummary[]> {
  const db = await openKb();
  const limit = args.limit ?? 10;
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (args.shape_id) {
    where.push('shape_id = ?');
    params.push(args.shape_id);
  }
  if (args.query && args.query.trim()) {
    where.push('(LOWER(title) LIKE ? OR LOWER(description) LIKE ?)');
    const pattern = `%${args.query.trim().toLowerCase()}%`;
    params.push(pattern, pattern);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.getAllAsync<any>(
    `SELECT recipe_id, title, shape_id, region_id, sauce_category_id,
            description, cook_time_minutes, serves, tags
     FROM recipes
     ${whereClause}
     LIMIT ?`,
    [...params, limit],
  );

  return rows.map((r) => ({
    recipe_id: r.recipe_id,
    title: r.title,
    shape_id: r.shape_id,
    region_id: r.region_id,
    sauce_category_id: r.sauce_category_id,
    description: r.description,
    cook_time_minutes: r.cook_time_minutes,
    serves: r.serves,
    tags: JSON.parse(r.tags) as string[],
  }));
}

export async function getRecipeDetails(
  recipe_id: string,
): Promise<RecipeDetails | null> {
  const db = await openKb();
  const row = await db.getFirstAsync<any>(
    `SELECT recipe_id, title, shape_id, region_id, sauce_category_id,
            description, cook_time_minutes, serves, ingredients, steps,
            tags, traditional_notes, evidence_strength, confidence
     FROM recipes WHERE recipe_id = ?`,
    [recipe_id],
  );
  if (!row) return null;
  return {
    recipe_id: row.recipe_id,
    title: row.title,
    shape_id: row.shape_id,
    region_id: row.region_id,
    sauce_category_id: row.sauce_category_id,
    description: row.description,
    cook_time_minutes: row.cook_time_minutes,
    serves: row.serves,
    tags: JSON.parse(row.tags) as string[],
    ingredients: JSON.parse(row.ingredients) as Ingredient[],
    steps: JSON.parse(row.steps) as RecipeStep[],
    traditional_notes: row.traditional_notes,
    evidence_strength: row.evidence_strength as EvidenceStrength,
    confidence: row.confidence as Confidence,
  };
}

export async function getRecipeSummariesByIds(
  ids: string[],
): Promise<RecipeSummary[]> {
  if (ids.length === 0) return [];
  const db = await openKb();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.getAllAsync<any>(
    `SELECT recipe_id, title, shape_id, region_id, sauce_category_id,
            description, cook_time_minutes, serves, tags
     FROM recipes
     WHERE recipe_id IN (${placeholders})`,
    ids,
  );

  // Re-order to match the input order. SQLite IN doesn't preserve order.
  const byId = new Map<string, RecipeSummary>();
  for (const r of rows) {
    byId.set(r.recipe_id, {
      recipe_id: r.recipe_id,
      title: r.title,
      shape_id: r.shape_id,
      region_id: r.region_id,
      sauce_category_id: r.sauce_category_id,
      description: r.description,
      cook_time_minutes: r.cook_time_minutes,
      serves: r.serves,
      tags: JSON.parse(r.tags) as string[],
    });
  }
  return ids.map((id) => byId.get(id)).filter((r): r is RecipeSummary => !!r);
}

export type ShapeDetails = {
  shape_id: string;
  canonical_name: string;
  alt_names: string[];
  region_id: string | null;
  region_canonical_name: string | null;
  description: string;
  traditional_sauces: string[];
};

export async function getShape(
  shape_id: string,
): Promise<ShapeDetails | null> {
  const db = await openKb();
  // LEFT JOIN regions so shapes without region_id still come back.
  const row = await db.getFirstAsync<any>(
    `SELECT s.shape_id, s.canonical_name, s.alt_names,
            s.region_id, s.description, s.traditional_sauces,
            r.canonical_name AS region_canonical_name
     FROM shapes s
     LEFT JOIN regions r ON r.region_id = s.region_id
     WHERE s.shape_id = ?`,
    [shape_id],
  );
  if (!row) return null;
  return {
    shape_id: row.shape_id,
    canonical_name: row.canonical_name,
    alt_names: JSON.parse(row.alt_names) as string[],
    region_id: row.region_id,
    region_canonical_name: row.region_canonical_name,
    description: row.description,
    traditional_sauces: JSON.parse(row.traditional_sauces) as string[],
  };
}

export async function getSubstitutionOptions(args: {
  missing_ingredient: string;
  recipe_id?: string;
}): Promise<SubstitutionOption[]> {
  const db = await openKb();
  const ingredient = args.missing_ingredient.toLowerCase().trim();

  let sauceCategory: string | null = null;
  let resolvedRecipeId: string | null = null;
  if (args.recipe_id) {
    const recipe = await db.getFirstAsync<{ sauce_category_id: string | null }>(
      `SELECT sauce_category_id FROM recipes WHERE recipe_id = ?`,
      [args.recipe_id],
    );
    if (recipe) {
      resolvedRecipeId = args.recipe_id;
      sauceCategory = recipe.sauce_category_id;
    }
  }

  const rows = await db.getAllAsync<any>(
    `SELECT replacement_ingredient, reasoning, score,
            applies_to_sauce_category, applies_to_recipe_id
     FROM substitutions
     WHERE LOWER(original_ingredient) = ?
       AND (
         applies_to_recipe_id = ?
         OR applies_to_sauce_category = ?
         OR (applies_to_recipe_id IS NULL AND applies_to_sauce_category IS NULL)
       )
     ORDER BY
       CASE
         WHEN applies_to_recipe_id = ? THEN 0
         WHEN applies_to_sauce_category = ? THEN 1
         ELSE 2
       END,
       score DESC`,
    [
      ingredient,
      resolvedRecipeId,
      sauceCategory,
      resolvedRecipeId,
      sauceCategory,
    ],
  );

  return rows.map((r) => ({
    replacement_ingredient: r.replacement_ingredient,
    reasoning: r.reasoning,
    score: r.score,
    scope: r.applies_to_recipe_id
      ? 'recipe'
      : r.applies_to_sauce_category
        ? 'sauce_category'
        : 'universal',
  }));
}

export async function getSourcesForRecipe(
  recipe_id: string,
): Promise<Source[]> {
  const db = await openKb();
  const rows = await db.getAllAsync<any>(
    `SELECT s.source_id, s.source_name, s.source_url, s.source_type,
            s.source_tier, s.quoted_excerpt, s.excerpt_translation,
            s.accessed_date
     FROM sources s
     JOIN recipe_sources rs ON rs.source_id = s.source_id
     WHERE rs.recipe_id = ?
     ORDER BY s.source_tier, s.source_name`,
    [recipe_id],
  );
  return rows.map((r) => ({
    source_id: r.source_id,
    source_name: r.source_name,
    source_url: r.source_url,
    source_type: r.source_type as SourceType,
    source_tier: r.source_tier as 1 | 2 | 3,
    quoted_excerpt: r.quoted_excerpt,
    excerpt_translation: r.excerpt_translation,
    accessed_date: r.accessed_date,
  }));
}

export async function getSourcesForSubstitution(
  substitution_id: number,
): Promise<Source[]> {
  const db = await openKb();
  const rows = await db.getAllAsync<any>(
    `SELECT s.source_id, s.source_name, s.source_url, s.source_type,
            s.source_tier, s.quoted_excerpt, s.excerpt_translation,
            s.accessed_date
     FROM sources s
     JOIN substitution_sources ss ON ss.source_id = s.source_id
     WHERE ss.substitution_id = ?
     ORDER BY s.source_tier, s.source_name`,
    [substitution_id],
  );
  return rows.map((r) => ({
    source_id: r.source_id,
    source_name: r.source_name,
    source_url: r.source_url,
    source_type: r.source_type as SourceType,
    source_tier: r.source_tier as 1 | 2 | 3,
    quoted_excerpt: r.quoted_excerpt,
    excerpt_translation: r.excerpt_translation,
    accessed_date: r.accessed_date,
  }));
}

export async function getAllSources(): Promise<Source[]> {
  const db = await openKb();
  const rows = await db.getAllAsync<any>(
    `SELECT source_id, source_name, source_url, source_type, source_tier,
            quoted_excerpt, excerpt_translation, accessed_date
     FROM sources
     ORDER BY source_tier, source_name`,
  );
  return rows.map((r) => ({
    source_id: r.source_id,
    source_name: r.source_name,
    source_url: r.source_url,
    source_type: r.source_type as SourceType,
    source_tier: r.source_tier as 1 | 2 | 3,
    quoted_excerpt: r.quoted_excerpt,
    excerpt_translation: r.excerpt_translation,
    accessed_date: r.accessed_date,
  }));
}

export async function getKbVersion(): Promise<KbVersion | null> {
  const db = await openKb();
  const row = await db.getFirstAsync<any>(`SELECT * FROM kb_version LIMIT 1`);
  if (!row) return null;
  return {
    methodology_version: row.methodology_version,
    built_at: row.built_at,
    recipe_count: row.recipe_count,
    substitution_count: row.substitution_count,
    shape_count: row.shape_count,
    region_count: row.region_count,
    source_count: row.source_count,
  };
}