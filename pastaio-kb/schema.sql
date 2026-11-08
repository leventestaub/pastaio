-- Pastaio KB schema (v2)
--
-- Bundled with the React Native app, queried via expo-sqlite from
-- services/toolDispatcher.ts. Built from YAML sources by build.py.
--
-- v2 changes:
--   - Sources are first-class entities (sources table).
--   - Recipes and substitutions link to sources via typed join tables
--     (recipe_sources, substitution_sources).
--   - Recipes and substitutions carry evidence_strength + confidence
--     enums and a traditional_notes prose field.
--   - kb_version table records build metadata (one row per build).
--
-- Design notes:
-- - String primary keys (shape_id='orecchiette') for debuggability in
--   tool calls and prompts.
-- - JSON fields for ingredients/steps/tags: never queried independently,
--   always fetched as part of a recipe.
-- - Substitutions enforce "at most one scope" via CHECK constraint
--   (Option B+ from KB_DESIGN.md).
-- - Enum-like fields are TEXT with CHECK constraints. SQLite has no
--   native enum; CHECK + Pydantic Enum on the build side is the spine.

PRAGMA foreign_keys = ON;

-- ── KB build metadata ─────────────────────────────────────────────
-- Single row, rewritten on every build. Lets the app surface the
-- methodology version and build timestamp in the sources viewer.
CREATE TABLE kb_version (
    methodology_version TEXT NOT NULL,
    built_at            TEXT NOT NULL,  -- ISO 8601 UTC
    recipe_count        INTEGER NOT NULL,
    substitution_count  INTEGER NOT NULL,
    shape_count         INTEGER NOT NULL,
    region_count        INTEGER NOT NULL,
    source_count        INTEGER NOT NULL
);

-- ── Vocabulary tables ─────────────────────────────────────────────

-- Pasta shapes. Vocabulary for find_recipes(shape) and the VLM's
-- constrained output set.
CREATE TABLE shapes (
    shape_id           TEXT PRIMARY KEY,           -- e.g. 'orecchiette'
    canonical_name     TEXT NOT NULL,              -- e.g. 'Orecchiette'
    alt_names          TEXT NOT NULL DEFAULT '[]', -- JSON array of strings
    region_id          TEXT,                       -- region of origin
    description        TEXT NOT NULL,              -- 1-3 sentences, visual + tradition
    traditional_sauces TEXT NOT NULL DEFAULT '[]', -- JSON array of sauce_category ids
    FOREIGN KEY (region_id) REFERENCES regions(region_id)
);

-- Italian regions. Targeted at the 5-7 the spec calls for.
CREATE TABLE regions (
    region_id                  TEXT PRIMARY KEY,           -- e.g. 'lazio'
    canonical_name             TEXT NOT NULL,              -- e.g. 'Lazio'
    description                TEXT NOT NULL,              -- 2-4 sentences on culinary character
    characteristic_ingredients TEXT NOT NULL DEFAULT '[]', -- JSON array
    traditional_sauces         TEXT NOT NULL DEFAULT '[]'  -- JSON array of sauce_category ids
);

-- Sauce categories. Coarse buckets ('tomato_based', 'cheese_based',
-- 'egg_based', 'meat_based', 'oil_based', 'cream_based',
-- 'seafood_based', 'vegetable_based'). Used for both recipe
-- categorization and substitution scoping.
CREATE TABLE sauce_categories (
    sauce_category_id  TEXT PRIMARY KEY,           -- e.g. 'cheese_based'
    canonical_name     TEXT NOT NULL,              -- e.g. 'Cheese-based'
    description        TEXT NOT NULL               -- what defines this category
);

-- ── Recipes ───────────────────────────────────────────────────────

CREATE TABLE recipes (
    recipe_id           TEXT PRIMARY KEY,           -- e.g. 'bucatini-allamatriciana'
    title               TEXT NOT NULL,
    shape_id            TEXT NOT NULL,
    region_id           TEXT,                       -- nullable: not every recipe is regional
    sauce_category_id   TEXT,                       -- nullable: not every recipe fits a category
    description         TEXT NOT NULL,              -- 2-3 sentences, source-grounded
    cook_time_minutes   INTEGER NOT NULL,
    serves              INTEGER NOT NULL,
    ingredients         TEXT NOT NULL,              -- JSON: [{name, amount?, unit?, notes?}]
    steps               TEXT NOT NULL,              -- JSON: [{order, text, timer_seconds?}]
    tags                TEXT NOT NULL DEFAULT '[]', -- JSON: ['vegetarian', 'quick', ...]
    -- v2 additions:
    traditional_notes   TEXT NOT NULL DEFAULT '',   -- where contested orthodoxies and reasoning live
    evidence_strength   TEXT NOT NULL,              -- enum, see CHECK
    confidence          TEXT NOT NULL,              -- enum, see CHECK
    FOREIGN KEY (shape_id) REFERENCES shapes(shape_id),
    FOREIGN KEY (region_id) REFERENCES regions(region_id),
    FOREIGN KEY (sauce_category_id) REFERENCES sauce_categories(sauce_category_id),
    CHECK (evidence_strength IN (
        'stg_dop_protected', 'comune_disciplinare', 'accademia_published',
        'slow_food_presidia', 'cookbook_consensus', 'contemporary_convention'
    )),
    CHECK (confidence IN (
        'directly_stated', 'inferred_from_source', 'synthesized_across_sources'
    ))
);

-- ── Substitutions ─────────────────────────────────────────────────
-- Scope semantics (Option B+):
--   - applies_to_sauce_category set: rule applies in dishes of that sauce category
--   - applies_to_recipe_id set:      rule applies only in that specific recipe
--   - both null:                     rule is universal (e.g. parmigiano -> grana padano)
-- At most ONE scope field set per row. CHECK enforces this.
CREATE TABLE substitutions (
    substitution_id            INTEGER PRIMARY KEY AUTOINCREMENT,
    original_ingredient        TEXT NOT NULL,             -- e.g. 'basil'
    replacement_ingredient     TEXT NOT NULL,             -- e.g. 'parsley'
    reasoning                  TEXT NOT NULL,             -- the flavor/technique explanation
    score                      REAL NOT NULL,             -- 0.0-1.0; see KB_DESIGN.md anchors
    applies_to_sauce_category  TEXT,
    applies_to_recipe_id       TEXT,
    -- v2 additions:
    evidence_strength          TEXT NOT NULL,
    confidence                 TEXT NOT NULL,
    FOREIGN KEY (applies_to_sauce_category) REFERENCES sauce_categories(sauce_category_id),
    FOREIGN KEY (applies_to_recipe_id) REFERENCES recipes(recipe_id),
    CHECK (
        applies_to_sauce_category IS NULL OR applies_to_recipe_id IS NULL
    ),
    CHECK (score >= 0.0 AND score <= 1.0),
    CHECK (evidence_strength IN (
        'stg_dop_protected', 'comune_disciplinare', 'accademia_published',
        'slow_food_presidia', 'cookbook_consensus', 'contemporary_convention'
    )),
    CHECK (confidence IN (
        'directly_stated', 'inferred_from_source', 'synthesized_across_sources'
    ))
);

-- ── Sources ───────────────────────────────────────────────────────
-- One row per unique URL. Sources are de-duplicated by source_url so
-- a single EUR-Lex page that backs amatriciana recipe AND a guanciale
-- substitution rule lives once in this table.
CREATE TABLE sources (
    source_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    source_name         TEXT NOT NULL,
    source_url          TEXT NOT NULL UNIQUE,           -- de-dup key
    source_type         TEXT NOT NULL,
    source_tier         INTEGER NOT NULL,
    quoted_excerpt      TEXT NOT NULL,                  -- max ~30 words enforced in build.py
    excerpt_translation TEXT NOT NULL DEFAULT '',       -- empty if source is already English
    accessed_date       TEXT NOT NULL,                  -- ISO YYYY-MM-DD
    CHECK (source_tier IN (1, 2, 3)),
    CHECK (source_type IN (
        'eu_regulation', 'mipaaf_register', 'comune_disciplinare',
        'accademia_publication', 'slow_food_documentation',
        'italian_wikipedia_with_citations', 'italian_culinary_magazine',
        'regional_government', 'cookbook_excerpt_via_citation'
    ))
);

-- Recipe ↔ source many-to-many.
CREATE TABLE recipe_sources (
    recipe_id  TEXT NOT NULL,
    source_id  INTEGER NOT NULL,
    PRIMARY KEY (recipe_id, source_id),
    FOREIGN KEY (recipe_id) REFERENCES recipes(recipe_id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES sources(source_id) ON DELETE CASCADE
);

-- Substitution ↔ source many-to-many.
CREATE TABLE substitution_sources (
    substitution_id  INTEGER NOT NULL,
    source_id        INTEGER NOT NULL,
    PRIMARY KEY (substitution_id, source_id),
    FOREIGN KEY (substitution_id) REFERENCES substitutions(substitution_id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES sources(source_id) ON DELETE CASCADE
);

-- ── Indexes ───────────────────────────────────────────────────────
-- For the queries the read tools actually do.

CREATE INDEX idx_recipes_shape ON recipes(shape_id);
CREATE INDEX idx_recipes_region ON recipes(region_id);
CREATE INDEX idx_recipes_sauce ON recipes(sauce_category_id);

-- Substitution lookup is always by original_ingredient first, then filter by scope.
CREATE INDEX idx_subs_original ON substitutions(original_ingredient);
CREATE INDEX idx_subs_recipe   ON substitutions(applies_to_recipe_id);
CREATE INDEX idx_subs_sauce    ON substitutions(applies_to_sauce_category);

-- Sources viewer: "what backs this recipe" / "what backs this substitution".
CREATE INDEX idx_recipe_sources_recipe       ON recipe_sources(recipe_id);
CREATE INDEX idx_substitution_sources_subid  ON substitution_sources(substitution_id);
-- Sources viewer: "show all sources of tier N" / "by type".
CREATE INDEX idx_sources_tier ON sources(source_tier);
CREATE INDEX idx_sources_type ON sources(source_type);