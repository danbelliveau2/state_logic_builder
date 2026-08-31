# Recipe Handler — how SDC thinks about it

> CONCEPTS, NOT RULES — when Jarvis gets something wrong, deepen the
> understanding here; do not append a rule. (Dan, Aug 2026)


## SDC Recipe Handler — setup and operation (2026-08-31)

## What it is
A reusable SDC-standard Recipe program/UDT/HMI package for Studio 5000 projects that need recipe (parameter-set) storage, editing, and download-to-running functionality. Import the Recipe program into the project rather than building recipe logic from scratch.

## Setup mechanism
1. **Import** the Recipe program into the current project.
2. **Recipe_Structure UDT**: contains required ("highlighted") system elements that must always be present, plus additional elements the ME defines per-machine to hold the actual recipe parameters (positions, speeds, setpoints, etc. — whatever that station's recipe needs to vary).
3. **Recipe_Data array sizing**: three separate array-index values must all be set equal to each other, and equal to the total quantity of recipes to be stored. Minimum value is 10 even if fewer recipes are initially needed.
4. **Input parameters** wire the UDT/array into the handler:
 - `i_DisplayListSize` — HMI recipe list size, default 10.
 - `i_RecipeStructureUDTSizeBytes` — must equal the Recipe_Structure UDT's data size in bytes.
 - `i_SavedRecipeArrayLength` — must equal the array size set in step 3.

## HMI operation model
- **Recipe Select screen**: a Filter field narrows the list by text match (must be cleared to see the full list again); tapping a recipe name selects it for editing (active-edit recipe highlights light blue).
- **Recipe Control buttons** (fixed semantics, standard across SDC):
 - Sort — hold 2 seconds, alphabetizes the recipe list.
 - Delete — hold 2 seconds, deletes the selected recipe.
 - Create New — uploads the PLC's currently-running recipe values and creates a new recipe entry from them.
 - Save — writes the edited recipe to the PLC's saved copy; flashes red when the edited version differs from what's saved.
 - Download — sets the recipe as the PLC's running recipe; flashes red when the edited version differs from the running one.
 - Edit Selected Recipe — navigates to the Recipe Edit screen.
- **Ordering rule**: always Save before Download — downloading without saving first is a defined operator error mode (the flashing indicators exist specifically to warn about this).
- **Recipe Edit screen**: simple parameter-by-parameter edit of the selected recipe's fields, with Save/Download available from there as well.

## Why it matters for controls
When a station's spec calls for recipes/product changeover, use this standard package (UDT + array sizing rule + three input parameters) rather than inventing bespoke recipe storage — the array-size-minimum-10/equal-indexes rule and the three input-parameter wiring are compile-time setup steps to get right, not per-station judgment calls.

_Source: EE Recipe Handler Instructions.docx (network: EE Process and Standards Documents), ingested 2026-08-31 by the inbox librarian._
