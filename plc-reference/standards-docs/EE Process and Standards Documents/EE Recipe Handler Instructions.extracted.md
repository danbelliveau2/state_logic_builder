# Setup Instructions – EE Recipe Handler

Purpose - This instruction defines how engineers setup the SDC Recipe Handler in Studio 5000 software, and also provides a general description of operation.
Scope – This instruction applies to all engineers programming an Allen Bradley PLC in Studio 5000 requiring recipe functionality.
Step 1 – Import Recipe program into current project
Step 2 – Setup Recipe_Structure UDT
- Highlighted elements must be included.
- Define remaining elements based upon machine requirements.  Below is an example.

/ Step 3 – Change Recipe_Data array sizes
- Set the highlighted array indexes to the total quantity of recipes to be stored.
- All three values must be equal.
- Mininum value of 10.


Step 4 on next page…


Step 4 – Set input parameters
- i_DisplayListSize – set to HMI recipe list size.  Ten is default setting.
- i_RecipeStructureUDTSizeBytes – set to Recipe_Structure Data Type Size.  This is the red circled value in step 2.
- i_SavedRecipeArrayLength – set to array index length defined in step 3.


General Operation on next page…


Recipe Select Screen

- Filter – Enter in string of text to filter the list.  Please note that string must be cleared to repopluate full recipe list.
- List – Press on the recipe name to be edited.  The recipe being actively edited will be highlighted in light blue, as shown with Recipe A above.
- Recipe Control
- Sort – Hold for two seconds to sort the recipe list in alphabetical order.
- Delete – Hold for two seconds to delete the selected recipe.
- Create New – Uploads the running recipe in the PLC and creates a new one.
- Save – Press to save the recipe to the PLC.  This button will flash on/off red when the PLC sees a difference between the edited and saved recipes.
- Download – Press to download the recipe and set as the running recipe.  This button will flash on/off red when the PLC sees a difference between the edited and running recipes.
- Edit Selected Recipe – Jump to Recipe Edit screen.
- Important Note – Always Save before a Download.

Recipe Edit screen on next page…
Recipe Edit Screen

- Edit parameters of selected recipe in recipe list as needed.
- Download/Save as required.