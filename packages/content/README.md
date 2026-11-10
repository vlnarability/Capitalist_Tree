# @capitalist-tree/content

**Status:** Stub (P0). P2/P3/P5+ will populate this package.

Data-driven content for the game. Per the GDD/TDD, species, fertilizers,
equipment, weather, and upgrades are data — not hardcoded in engine logic.
Each category lives in its own subfolder:

| Subfolder    | Owner phase | Contents                                  |
|--------------|-------------|-------------------------------------------|
| `species/`   | P2          | TreeSpecies definitions                   |
| `fertilizers/`| P3         | Fertilizer nutrient compositions          |
| `equipment/` | P5          | Automation/equipment definitions           |
| `weather/`   | P2          | Weather event definitions                 |
| `upgrades/`  | P8+         | Research/upgrade definitions              |

P0 leaves the subfolders empty with placeholder index files so downstream
agents can drop content in without restructuring the layout.
