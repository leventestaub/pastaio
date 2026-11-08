// =============================================================================
// __tests__/cookbookStarter.test.ts
// =============================================================================
//
// Tests for buildCookbookStarter. Mocks the kb queries since we don't want
// to load a real .db in unit tests.
//
// =============================================================================

import { buildCookbookStarter } from '@/services/cookbookStarter';
import * as kb from '@/services/kb';
import * as discover from '@/services/discover';

jest.mock('@/services/kb');
jest.mock('@/services/discover');

const mockedKb = jest.mocked(kb);
const mockedDiscover = jest.mocked(discover);

const summary = (
  id: string,
  region: string | null,
  shape = 'spaghetti',
): kb.RecipeSummary => ({
  recipe_id: id,
  title: id,
  shape_id: shape,
  region_id: region,
  sauce_category_id: 'tomato_based',
  description: '',
  cook_time_minutes: 25,
  serves: 4,
  tags: [],
});

const ALL_RECIPES = [
  summary('carbonara', 'lazio'),
  summary('gricia', 'lazio'),
  summary('matriciana', 'lazio'),
  summary('cacio-e-pepe', 'lazio'),
  summary('trofie-al-pesto', 'liguria', 'trofie'),
  summary('trenette-al-pesto', 'liguria', 'trenette'),
  summary('tagliatelle-ragu', 'emilia_romagna', 'tagliatelle'),
];

beforeEach(() => {
  jest.resetAllMocks();
  mockedKb.findRecipes.mockResolvedValue(ALL_RECIPES);
  mockedKb.getRecipeSummariesByIds.mockImplementation(async (ids) =>
    ids.map((id) => ALL_RECIPES.find((r) => r.recipe_id === id)).filter(
      (r): r is kb.RecipeSummary => !!r,
    ),
  );
  mockedDiscover.resolveRegionName.mockImplementation(async (id) => {
    const map: Record<string, string> = {
      lazio: 'Lazio',
      liguria: 'Liguria',
      emilia_romagna: 'Emilia-Romagna',
    };
    return map[id] ?? id;
  });
});

describe('buildCookbookStarter', () => {
  test('returns null when cooking history is empty', async () => {
    expect(
      await buildCookbookStarter({
        cookingHistoryIds: [],
        savedRecipeIds: [],
      }),
    ).toBeNull();
  });

  test('picks dominant region from history', async () => {
    const starter = await buildCookbookStarter({
      cookingHistoryIds: ['carbonara', 'gricia', 'trofie-al-pesto'],
      savedRecipeIds: [],
    });
    expect(starter?.dominantRegionId).toBe('lazio');
    expect(starter?.dominantRegionName).toBe('Lazio');
  });

  test('suggestions exclude already-cooked recipes', async () => {
    const starter = await buildCookbookStarter({
      cookingHistoryIds: ['carbonara', 'gricia'],
      savedRecipeIds: [],
    });
    const ids = starter!.suggestions.map((r) => r.recipe_id);
    expect(ids).not.toContain('carbonara');
    expect(ids).not.toContain('gricia');
    expect(ids).toContain('matriciana');
    expect(ids).toContain('cacio-e-pepe');
  });

  test('suggestions exclude saved (cookbook) recipes', async () => {
    const starter = await buildCookbookStarter({
      cookingHistoryIds: ['carbonara'],
      savedRecipeIds: ['matriciana'],
    });
    const ids = starter!.suggestions.map((r) => r.recipe_id);
    expect(ids).not.toContain('matriciana');
  });

  test('pads with other regions when dominant is sparse', async () => {
    // User has cooked 3 of 4 Lazio recipes → only matriciana unseen in dominant
    const starter = await buildCookbookStarter({
      cookingHistoryIds: ['carbonara', 'gricia', 'cacio-e-pepe'],
      savedRecipeIds: [],
    });
    expect(starter!.suggestions.length).toBe(3);
    // Dominant-region candidate ranks first
    expect(starter!.suggestions[0].recipe_id).toBe('matriciana');
    // Padding is from non-Lazio
    const padded = starter!.suggestions.slice(1);
    expect(padded.every((r) => r.region_id !== 'lazio')).toBe(true);
  });

  test('caps suggestions at 3', async () => {
    const starter = await buildCookbookStarter({
      cookingHistoryIds: ['carbonara'],
      savedRecipeIds: [],
    });
    expect(starter!.suggestions.length).toBeLessThanOrEqual(3);
  });

  test('returns null when KB has no candidates after filtering', async () => {
    // User has cooked everything
    const allCooked = ALL_RECIPES.map((r) => r.recipe_id);
    const starter = await buildCookbookStarter({
      cookingHistoryIds: allCooked,
      savedRecipeIds: [],
    });
    expect(starter).toBeNull();
  });

  test('dedups history before tallying regions', async () => {
    // Same recipe cooked 3 times shouldn't dominate over 2 different recipes
    // from another region. recordCooking allows duplicate entries.
    const starter = await buildCookbookStarter({
      cookingHistoryIds: [
        'carbonara',
        'carbonara',
        'carbonara',
        'trofie-al-pesto',
        'trenette-al-pesto',
      ],
      savedRecipeIds: [],
    });
    // After dedup: lazio=1 (carbonara), liguria=2 → liguria wins
    expect(starter?.dominantRegionId).toBe('liguria');
  });

  test('handles recipes with null region_id gracefully', async () => {
    mockedKb.getRecipeSummariesByIds.mockResolvedValue([
      summary('mystery-pasta', null),
    ]);
    const starter = await buildCookbookStarter({
      cookingHistoryIds: ['mystery-pasta'],
      savedRecipeIds: [],
    });
    // No regions tallied → null
    expect(starter).toBeNull();
  });
});
