"""Dietary restrictions as hard filters over KB ingredients.

Every KB ingredient name maps to the classes it belongs to; each canonical
restriction excludes some classes. tests/test_diet.py fails when a KB
ingredient is missing from INGREDIENT_CLASSES, so new recipes can't slip
past the filter unclassified.

Conservative on purpose: calamari count as shellfish (EU allergen lists
molluscs separately, but users saying "no shellfish" rarely mean squid is
fine), and filled or egg pasta carries its dough and filling classes.
Custom restrictions are free text and stay with the model.
"""
from __future__ import annotations

from app.schemas.chat import StoredDietaryRestriction
from app.schemas.tools import DietaryRestriction

GLUTEN = "gluten"
DAIRY = "dairy"
EGG = "egg"
MEAT = "meat"
PORK = "pork"
FISH = "fish"
SHELLFISH = "shellfish"
RENNET = "animal_rennet"  # soft: DOP hard cheeses, flagged for vegetarians

INGREDIENT_CLASSES: dict[str, set[str]] = {
    # pasta and bread
    "bucatini": {GLUTEN}, "cavatelli": {GLUTEN}, "linguine": {GLUTEN},
    "orecchiette": {GLUTEN}, "rigatoni": {GLUTEN}, "spaghetti": {GLUTEN},
    "strascinati": {GLUTEN}, "trenette": {GLUTEN}, "tria": {GLUTEN},
    "trofie": {GLUTEN}, "farina_00": {GLUTEN},
    "mollica_di_pane": {GLUTEN}, "mollica_di_pane_raffermo": {GLUTEN},
    "tagliatelle": {GLUTEN, EGG}, "sfoglia_verde": {GLUTEN, EGG},
    "pansoti": {GLUTEN, EGG, DAIRY},  # preboggion filling bound with prescinsêua
    "tortellini": {GLUTEN, EGG},  # filling listed as separate ingredients
    # meat
    "guanciale": {MEAT, PORK}, "guanciale_amatriciano": {MEAT, PORK},
    "pancetta_fresca": {MEAT, PORK}, "lombo_di_maiale": {MEAT, PORK},
    "prosciutto_crudo": {MEAT, PORK}, "mortadella": {MEAT, PORK},
    "polpa_di_manzo": {MEAT}, "carne_di_manzo": {MEAT},
    "gallina_ruspante": {MEAT}, "brodo_di_carne": {MEAT},
    "ragu_alla_bolognese": {MEAT, PORK, DAIRY},
    # fish and shellfish
    "acciuga_salata": {FISH}, "acciughe": {FISH},
    "cozze": {SHELLFISH}, "vongole": {SHELLFISH}, "scampi": {SHELLFISH},
    "calamari": {SHELLFISH},
    # dairy and eggs
    "burro": {DAIRY}, "latte_intero": {DAIRY},
    "parmigiano_reggiano": {DAIRY, RENNET}, "pecorino_romano_dop": {DAIRY, RENNET},
    "fiore_sardo": {DAIRY, RENNET},
    "uova": {EGG}, "tuorli_d_uovo": {EGG},
    # plant-based, no restricted class
    **{name: set() for name in (
        "aglio", "alloro", "basilico_genovese", "capperi", "carota",
        "ceci_secchi", "cime_di_rapa", "cipolla", "cipolla_dorata",
        "concentrato_di_pomodoro", "fagioli_cannellini", "fagiolini",
        "noce_moscata", "noci", "olio_extravergine_di_oliva", "olive_di_gaeta",
        "passata_di_pomodoro", "patate", "pepe_nero", "pepe_nero_in_grani",
        "peperoncino", "pinoli", "pomodori_pelati", "pomodorini", "prezzemolo",
        "sale", "sale_fino", "sale_grosso", "sedano",
        "vino_bianco_secco", "vino_rosso_o_bianco",
    )},
}

EXCLUDES: dict[DietaryRestriction, set[str]] = {
    DietaryRestriction.VEGETARIAN: {MEAT, FISH, SHELLFISH},
    DietaryRestriction.VEGAN: {MEAT, FISH, SHELLFISH, DAIRY, EGG},
    DietaryRestriction.PESCATARIAN: {MEAT},
    DietaryRestriction.GLUTEN_FREE: {GLUTEN},
    DietaryRestriction.DAIRY_FREE: {DAIRY},
    DietaryRestriction.NO_PORK: {PORK},
    DietaryRestriction.NO_SHELLFISH: {SHELLFISH},
}
CAVEATS: dict[DietaryRestriction, set[str]] = {DietaryRestriction.VEGETARIAN: {RENNET}}


def conflicts(ingredients: list[dict], restrictions: list[StoredDietaryRestriction]) -> dict:
    """{"conflicts": [...], "caveats": [...]} for one recipe's ingredients.

    Each entry: {"restriction", "ingredient", "class"}. Unknown ingredients
    count as conflicts for every restriction (fail closed).
    """
    out: dict[str, list[dict]] = {"conflicts": [], "caveats": []}
    for r in restrictions:
        for ing in ingredients:
            classes = INGREDIENT_CLASSES.get(ing["name"], {"unclassified"})
            for key, table in (("conflicts", EXCLUDES), ("caveats", CAVEATS)):
                banned = table.get(r.restriction, set())
                if "unclassified" in classes and key == "conflicts" and banned:
                    hit = {"unclassified"}
                else:
                    hit = classes & banned
                for cls in sorted(hit):
                    out[key].append({"restriction": r.restriction.value, "ingredient": ing["name"], "class": cls})
    return out
