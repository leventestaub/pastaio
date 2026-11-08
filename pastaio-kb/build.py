"""
Pastaio KB build script.

Reads YAML sources from source/, validates against Pydantic models,
emits pastaio-kb.db.

Usage:
    python build.py            # build to ./pastaio-kb.db
    python build.py --output /path/to/foo.db
    python build.py --verbose  # print row counts per table

Validation strategy:
- Each YAML file is loaded and validated against a Pydantic model.
- Foreign keys (shape_id references, region_id references, etc.) are
  checked in a second pass after all entities are loaded.
- SQLite's own foreign key + check constraints are the final backstop.
- Sources are de-duplicated by URL during build (one row per unique URL).

v2 changes:
- Recipes and substitutions carry traditional_notes, evidence_strength,
  confidence, and a list of sources (validated structurally).
- New `sources`, `recipe_sources`, `substitution_sources` tables.
- New `kb_version` table populated on every build.

Failure modes:
- Validation error -> print which file/entry failed, exit 1.
- FK violation     -> print the unresolved reference, exit 1.
- Constraint error -> sqlite3 error propagates, exit 1.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import date, datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Optional

import yaml
from pydantic import BaseModel, Field, ValidationError, model_validator


# ── KB methodology version ────────────────────────────────────────
# Bump when schema or curation methodology changes.
METHODOLOGY_VERSION = "v1"


# ── Enums ──────────────────────────────────────────────────────────
# Mirrored exactly in schema.sql CHECK constraints. Keep in sync.

class EvidenceStrength(str, Enum):
    STG_DOP_PROTECTED = "stg_dop_protected"
    COMUNE_DISCIPLINARE = "comune_disciplinare"
    ACCADEMIA_PUBLISHED = "accademia_published"
    SLOW_FOOD_PRESIDIA = "slow_food_presidia"
    COOKBOOK_CONSENSUS = "cookbook_consensus"
    CONTEMPORARY_CONVENTION = "contemporary_convention"


class Confidence(str, Enum):
    DIRECTLY_STATED = "directly_stated"
    INFERRED_FROM_SOURCE = "inferred_from_source"
    SYNTHESIZED_ACROSS_SOURCES = "synthesized_across_sources"


class SourceType(str, Enum):
    EU_REGULATION = "eu_regulation"
    MIPAAF_REGISTER = "mipaaf_register"
    COMUNE_DISCIPLINARE = "comune_disciplinare"
    ACCADEMIA_PUBLICATION = "accademia_publication"
    SLOW_FOOD_DOCUMENTATION = "slow_food_documentation"
    ITALIAN_WIKIPEDIA_WITH_CITATIONS = "italian_wikipedia_with_citations"
    ITALIAN_CULINARY_MAGAZINE = "italian_culinary_magazine"
    REGIONAL_GOVERNMENT = "regional_government"
    COOKBOOK_EXCERPT_VIA_CITATION = "cookbook_excerpt_via_citation"


# ── Pydantic models for YAML validation ────────────────────────────


class Ingredient(BaseModel):
    name: str
    # Optional because of 'q.b.' (quanto basta = to taste): when amount
    # is None, unit must be 'q.b.'. Validator below enforces this.
    amount: Optional[float] = None
    unit: Optional[str] = None  # None = countable (e.g. "3 cloves")
    notes: Optional[str] = None

    @model_validator(mode="after")
    def amount_or_qb(self):
        if self.amount is None and self.unit != "q.b.":
            raise ValueError(
                f"ingredient '{self.name}': amount may only be omitted "
                f"when unit='q.b.' (got unit={self.unit!r})"
            )
        return self


class Step(BaseModel):
    order: int
    text: str
    timer_seconds: Optional[int] = None


class Source(BaseModel):
    source_name: str
    source_url: str = Field(min_length=1)
    source_type: SourceType
    source_tier: int = Field(ge=1, le=3)
    quoted_excerpt: str = Field(max_length=400)  # ~30 words, with slack
    excerpt_translation: str = ""  # empty if source is English
    accessed_date: date

    @model_validator(mode="after")
    def url_starts_with_http(self):
        if not (self.source_url.startswith("http://") or self.source_url.startswith("https://")):
            raise ValueError(f"source_url must start with http(s)://, got {self.source_url!r}")
        return self


class ShapeYaml(BaseModel):
    shape_id: str
    canonical_name: str
    alt_names: list[str] = Field(default_factory=list)
    region_id: Optional[str] = None
    description: str
    traditional_sauces: list[str] = Field(default_factory=list)


class RegionYaml(BaseModel):
    region_id: str
    canonical_name: str
    description: str
    characteristic_ingredients: list[str] = Field(default_factory=list)
    traditional_sauces: list[str] = Field(default_factory=list)


class SauceCategoryYaml(BaseModel):
    sauce_category_id: str
    canonical_name: str
    description: str


class RecipeYaml(BaseModel):
    recipe_id: str
    title: str
    shape_id: str
    region_id: Optional[str] = None
    sauce_category_id: Optional[str] = None
    description: str
    cook_time_minutes: int
    serves: int
    ingredients: list[Ingredient]
    steps: list[Step]
    tags: list[str] = Field(default_factory=list)
    # v2 additions:
    traditional_notes: str = ""
    evidence_strength: EvidenceStrength
    confidence: Confidence
    sources: list[Source] = Field(min_length=1)


class SubstitutionYaml(BaseModel):
    original_ingredient: str
    replacement_ingredient: str
    reasoning: str
    score: float = Field(ge=0.0, le=1.0)
    applies_to_sauce_category: Optional[str] = None
    applies_to_recipe_id: Optional[str] = None
    # v2 additions:
    evidence_strength: EvidenceStrength
    confidence: Confidence
    sources: list[Source] = Field(min_length=1)

    @model_validator(mode="after")
    def at_most_one_scope(self):
        if (
            self.applies_to_sauce_category is not None
            and self.applies_to_recipe_id is not None
        ):
            raise ValueError(
                "substitution may set at most one of "
                "applies_to_sauce_category or applies_to_recipe_id, not both"
            )
        return self


# ── Loaders ────────────────────────────────────────────────────────


def _load_yaml(path: Path) -> dict | list | None:
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_shapes(source_dir: Path) -> list[ShapeYaml]:
    path = source_dir / "shapes.yaml"
    raw = _load_yaml(path) or []
    return [ShapeYaml(**entry) for entry in raw]


def load_regions(source_dir: Path) -> list[RegionYaml]:
    path = source_dir / "regions.yaml"
    raw = _load_yaml(path) or []
    return [RegionYaml(**entry) for entry in raw]


def load_sauce_categories(source_dir: Path) -> list[SauceCategoryYaml]:
    path = source_dir / "sauce_categories.yaml"
    raw = _load_yaml(path) or []
    return [SauceCategoryYaml(**entry) for entry in raw]


def load_substitutions(source_dir: Path) -> list[SubstitutionYaml]:
    path = source_dir / "substitutions.yaml"
    raw = _load_yaml(path) or []
    return [SubstitutionYaml(**entry) for entry in raw]


def load_recipes(source_dir: Path) -> list[RecipeYaml]:
    recipes_dir = source_dir / "recipes"
    if not recipes_dir.exists():
        return []
    out: list[RecipeYaml] = []
    for path in sorted(recipes_dir.glob("*.yaml")):
        raw = _load_yaml(path)
        if raw is None:
            continue
        out.append(RecipeYaml(**raw))
    return out


# ── FK resolution (second pass) ────────────────────────────────────


def check_foreign_keys(
    shapes: list[ShapeYaml],
    regions: list[RegionYaml],
    sauce_categories: list[SauceCategoryYaml],
    recipes: list[RecipeYaml],
    substitutions: list[SubstitutionYaml],
) -> list[str]:
    """Return list of FK violation messages. Empty list = clean."""
    errors: list[str] = []
    shape_ids = {s.shape_id for s in shapes}
    region_ids = {r.region_id for r in regions}
    sauce_ids = {s.sauce_category_id for s in sauce_categories}
    recipe_ids = {r.recipe_id for r in recipes}

    for s in shapes:
        if s.region_id and s.region_id not in region_ids:
            errors.append(
                f"shape '{s.shape_id}': region_id '{s.region_id}' not found"
            )
        for sc in s.traditional_sauces:
            if sc not in sauce_ids:
                errors.append(
                    f"shape '{s.shape_id}': traditional_sauces references "
                    f"unknown sauce_category '{sc}'"
                )

    for r in regions:
        for sc in r.traditional_sauces:
            if sc not in sauce_ids:
                errors.append(
                    f"region '{r.region_id}': traditional_sauces references "
                    f"unknown sauce_category '{sc}'"
                )

    for rec in recipes:
        if rec.shape_id not in shape_ids:
            errors.append(
                f"recipe '{rec.recipe_id}': shape_id '{rec.shape_id}' not found"
            )
        if rec.region_id and rec.region_id not in region_ids:
            errors.append(
                f"recipe '{rec.recipe_id}': region_id '{rec.region_id}' not found"
            )
        if rec.sauce_category_id and rec.sauce_category_id not in sauce_ids:
            errors.append(
                f"recipe '{rec.recipe_id}': sauce_category_id "
                f"'{rec.sauce_category_id}' not found"
            )

    for sub in substitutions:
        if (
            sub.applies_to_sauce_category
            and sub.applies_to_sauce_category not in sauce_ids
        ):
            errors.append(
                f"substitution {sub.original_ingredient}->{sub.replacement_ingredient}: "
                f"applies_to_sauce_category '{sub.applies_to_sauce_category}' not found"
            )
        if (
            sub.applies_to_recipe_id
            and sub.applies_to_recipe_id not in recipe_ids
        ):
            errors.append(
                f"substitution {sub.original_ingredient}->{sub.replacement_ingredient}: "
                f"applies_to_recipe_id '{sub.applies_to_recipe_id}' not found"
            )

    return errors


# ── Source de-duplication ──────────────────────────────────────────


def collect_unique_sources(
    recipes: list[RecipeYaml],
    substitutions: list[SubstitutionYaml],
) -> dict[str, Source]:
    """
    Walk every embedded source in recipes and substitutions, return a
    dict keyed by source_url so duplicates collapse. If two YAML entries
    cite the same URL with different metadata (different excerpt,
    different accessed_date), the FIRST occurrence wins and a warning is
    raised at build time. This is intentional — same URL should mean same
    source.
    """
    by_url: dict[str, Source] = {}
    conflicts: list[str] = []

    def _record(src: Source, owner: str) -> None:
        existing = by_url.get(src.source_url)
        if existing is None:
            by_url[src.source_url] = src
            return
        if (
            existing.quoted_excerpt != src.quoted_excerpt
            or existing.source_type != src.source_type
            or existing.source_tier != src.source_tier
        ):
            conflicts.append(
                f"source URL {src.source_url} appears with conflicting "
                f"metadata in {owner}; first occurrence wins"
            )

    for rec in recipes:
        for src in rec.sources:
            _record(src, f"recipe '{rec.recipe_id}'")
    for sub in substitutions:
        for src in sub.sources:
            _record(
                src,
                f"substitution {sub.original_ingredient}->{sub.replacement_ingredient}",
            )

    for c in conflicts:
        print(f"WARN: {c}", file=sys.stderr)

    return by_url


# ── DB writer ──────────────────────────────────────────────────────


def build_db(
    output_path: Path,
    schema_path: Path,
    shapes: list[ShapeYaml],
    regions: list[RegionYaml],
    sauce_categories: list[SauceCategoryYaml],
    recipes: list[RecipeYaml],
    substitutions: list[SubstitutionYaml],
    verbose: bool = False,
) -> None:
    if output_path.exists():
        output_path.unlink()

    conn = sqlite3.connect(output_path)
    conn.executescript(schema_path.read_text(encoding="utf-8"))

    # Insert order matters for FK constraints:
    # regions -> sauce_categories -> shapes -> recipes
    #         -> sources -> recipe_sources
    #         -> substitutions -> substitution_sources
    #         -> kb_version (last; counts everything)

    conn.executemany(
        "INSERT INTO regions VALUES (?, ?, ?, ?, ?)",
        [
            (
                r.region_id,
                r.canonical_name,
                r.description,
                json.dumps(r.characteristic_ingredients),
                json.dumps(r.traditional_sauces),
            )
            for r in regions
        ],
    )

    conn.executemany(
        "INSERT INTO sauce_categories VALUES (?, ?, ?)",
        [
            (s.sauce_category_id, s.canonical_name, s.description)
            for s in sauce_categories
        ],
    )

    conn.executemany(
        "INSERT INTO shapes VALUES (?, ?, ?, ?, ?, ?)",
        [
            (
                s.shape_id,
                s.canonical_name,
                json.dumps(s.alt_names),
                s.region_id,
                s.description,
                json.dumps(s.traditional_sauces),
            )
            for s in shapes
        ],
    )

    conn.executemany(
        """INSERT INTO recipes
           (recipe_id, title, shape_id, region_id, sauce_category_id,
            description, cook_time_minutes, serves, ingredients, steps, tags,
            traditional_notes, evidence_strength, confidence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [
            (
                r.recipe_id,
                r.title,
                r.shape_id,
                r.region_id,
                r.sauce_category_id,
                r.description,
                r.cook_time_minutes,
                r.serves,
                json.dumps(
                    [i.model_dump(exclude_none=True) for i in r.ingredients]
                ),
                json.dumps(
                    [s.model_dump(exclude_none=True) for s in r.steps]
                ),
                json.dumps(r.tags),
                r.traditional_notes,
                r.evidence_strength.value,
                r.confidence.value,
            )
            for r in recipes
        ],
    )

    # Sources: de-dup by URL, insert, capture URL→source_id mapping for joins.
    by_url = collect_unique_sources(recipes, substitutions)
    url_to_id: dict[str, int] = {}
    for src in by_url.values():
        cur = conn.execute(
            """INSERT INTO sources
               (source_name, source_url, source_type, source_tier,
                quoted_excerpt, excerpt_translation, accessed_date)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                src.source_name,
                src.source_url,
                src.source_type.value,
                src.source_tier,
                src.quoted_excerpt,
                src.excerpt_translation,
                src.accessed_date.isoformat(),
            ),
        )
        url_to_id[src.source_url] = cur.lastrowid

    # recipe_sources join table
    recipe_source_rows: list[tuple[str, int]] = []
    for rec in recipes:
        for src in rec.sources:
            recipe_source_rows.append((rec.recipe_id, url_to_id[src.source_url]))
    # de-dup (a recipe might list the same URL twice in YAML by mistake)
    recipe_source_rows = list(set(recipe_source_rows))
    conn.executemany(
        "INSERT INTO recipe_sources VALUES (?, ?)",
        recipe_source_rows,
    )

    # substitutions: insert and capture autoincrement IDs for the join table.
    sub_ids: list[int] = []
    for sub in substitutions:
        cur = conn.execute(
            """INSERT INTO substitutions
               (original_ingredient, replacement_ingredient, reasoning, score,
                applies_to_sauce_category, applies_to_recipe_id,
                evidence_strength, confidence)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                sub.original_ingredient,
                sub.replacement_ingredient,
                sub.reasoning,
                sub.score,
                sub.applies_to_sauce_category,
                sub.applies_to_recipe_id,
                sub.evidence_strength.value,
                sub.confidence.value,
            ),
        )
        sub_ids.append(cur.lastrowid)

    sub_source_rows: list[tuple[int, int]] = []
    for sub, sid in zip(substitutions, sub_ids):
        for src in sub.sources:
            sub_source_rows.append((sid, url_to_id[src.source_url]))
    sub_source_rows = list(set(sub_source_rows))
    conn.executemany(
        "INSERT INTO substitution_sources VALUES (?, ?)",
        sub_source_rows,
    )

    # kb_version: one row, build metadata.
    conn.execute(
        """INSERT INTO kb_version
           (methodology_version, built_at, recipe_count, substitution_count,
            shape_count, region_count, source_count)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            METHODOLOGY_VERSION,
            datetime.now(timezone.utc).isoformat(),
            len(recipes),
            len(substitutions),
            len(shapes),
            len(regions),
            len(by_url),
        ),
    )

    conn.commit()
    if verbose:
        for table in (
            "regions", "sauce_categories", "shapes", "recipes",
            "substitutions", "sources",
            "recipe_sources", "substitution_sources", "kb_version",
        ):
            count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            print(f"  {table}: {count} rows")
    conn.close()


# ── Entrypoint ─────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(description="Build pastaio-kb.db from YAML sources.")
    parser.add_argument(
        "--source",
        type=Path,
        default=Path(__file__).parent / "source",
        help="Source YAML directory (default: ./source)",
    )
    parser.add_argument(
        "--schema",
        type=Path,
        default=Path(__file__).parent / "schema.sql",
        help="SQLite schema file (default: ./schema.sql)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).parent / "pastaio-kb.db",
        help="Output SQLite path (default: ./pastaio-kb.db)",
    )
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    if not args.source.exists():
        print(f"Source directory not found: {args.source}", file=sys.stderr)
        return 1
    if not args.schema.exists():
        print(f"Schema file not found: {args.schema}", file=sys.stderr)
        return 1

    try:
        shapes = load_shapes(args.source)
        regions = load_regions(args.source)
        sauce_categories = load_sauce_categories(args.source)
        substitutions = load_substitutions(args.source)
        recipes = load_recipes(args.source)
    except ValidationError as e:
        print(f"YAML validation failed:\n{e}", file=sys.stderr)
        return 1
    except yaml.YAMLError as e:
        print(f"YAML parse error:\n{e}", file=sys.stderr)
        return 1

    fk_errors = check_foreign_keys(
        shapes, regions, sauce_categories, recipes, substitutions
    )
    if fk_errors:
        print("Foreign key violations:", file=sys.stderr)
        for err in fk_errors:
            print(f"  - {err}", file=sys.stderr)
        return 1

    if args.verbose:
        print(f"Building {args.output}...")
        print(
            f"  loaded: {len(shapes)} shapes, {len(regions)} regions, "
            f"{len(sauce_categories)} sauce_categories, "
            f"{len(recipes)} recipes, {len(substitutions)} substitutions"
        )

    build_db(
        args.output,
        args.schema,
        shapes,
        regions,
        sauce_categories,
        recipes,
        substitutions,
        verbose=args.verbose,
    )
    print(f"Built {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())