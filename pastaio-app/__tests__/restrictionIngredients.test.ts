import { detectIngredientConflicts } from '@/services/restrictionIngredients';

const rules = {
  classes: { guanciale: ['meat', 'pork'], pecorino_romano_dop: ['dairy', 'animal_rennet'], pepe_nero: [] },
  excludes: { vegetarian: ['meat', 'fish', 'shellfish'], dairy_free: ['dairy'] },
};
const gricia = ['rigatoni', 'guanciale', 'pecorino_romano_dop', 'pepe_nero'];

test('canonical restrictions use KB classes, one conflict per restriction', () => {
  const out = detectIngredientConflicts({
    ingredientNames: gricia,
    restrictions: [{ restriction: 'vegetarian' }, { restriction: 'dairy_free' }, { restriction: 'no_shellfish' }],
    rules,
  });
  expect(out.map((c) => [c.restriction, c.matchedIngredient])).toEqual([
    ['vegetarian', 'guanciale'],
    ['dairy_free', 'pecorino_romano_dop'],
  ]);
});

test('custom restrictions match their text against ingredient names', () => {
  const out = detectIngredientConflicts({
    ingredientNames: gricia,
    restrictions: [{ restriction: 'custom', customText: 'Pepe nero' }],
    rules,
  });
  expect(out[0]?.matchedIngredient).toBe('pepe_nero');
});
