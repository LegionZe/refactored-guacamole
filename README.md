# SR5 Character PDF Export

Foundry VTT **v14** module that exports a **Shadowrun 5th Edition** (`shadowrun5e` system, v0.37.x) character actor to a PDF character sheet, generated in the browser with [jsPDF](https://github.com/parallax/jsPDF) and [jspdf-autotable](https://github.com/simonbengtsson/jsPDF-AutoTable).

## Install

In Foundry: **Add-on Modules → Install Module → Manifest URL**:

```
https://github.com/LegionZe/refactored-guacamole/releases/latest/download/module.json
```

Enable **SR5 Character PDF Export** in the world (requires the `shadowrun5e` system).

## Use

- **Actor sheet**: open the character sheet's header menu (⋮) → **Export PDF**.
- **Actors sidebar**: right-click a character → **Export PDF**.
- A dialog lets you choose sections; the choice is remembered per client.
- Only `character` actors are exported, and only by users with Owner permission on the actor.

Macro / API:

```js
const api = game.modules.get('sr5-pdf-export').api;
await api.promptAndExport(game.user.character);           // with dialog
await api.exportActorPdf(game.user.character, { format: 'letter' }); // direct
```

### Settings (per client)

| Setting | Default |
|---|---|
| PDF page format (A4 / US Letter) | A4 |
| Include portrait | on |
| Include untrained active skills | off |

## What is exported

Attributes (base / modified, with active-effect sources), Edge (and uses), Essence, Magic/Resonance, Initiation/Submersion, limits, initiative per mode, armor, movement, Composure / Judge Intentions / Memory / Lift-Carry, condition monitors (physical, stun, overflow with wound-modifier markers), karma, nuyen, reputation, active skills with dice pool and specializations, skill groups, knowledge skills, languages, qualities, weapons, armor, cyberware/bioware, spells, adept powers, complex forms, critter powers / metamagics / echoes / sprite powers, devices, gear, SINs and licenses, lifestyles, contacts, and the description (HTML stripped).

Notes on values:
- All values are read from the actor's **prepared** data, so active effects and system modifiers are included.
- *Pool* for active skills = skill rating + linked attribute value. Wound modifiers and situational modifiers are **not** applied (matches a printed sheet).
- Composure (CHA+WIL), Judge Intentions (CHA+INT), Memory (LOG+WIL) and Lift/Carry (BOD+STR) use the attribute pairs from the system's general action packs (`packs/_source/sr5e-general-actions/composure.json`, `judge-intentions.json`, `memory.json`, `lift-carry.json`) plus the matching `system.modifiers.*` value; wounds/global modifiers are not applied.

## Data sources (field paths)

All field paths were taken from the `shadowrun5e` source at commit `3c4746b` (system v0.37.9, Foundry compatibility 14.363–14.367), <https://github.com/SR5-FoundryVTT/SR5-FoundryVTT>:

| Data | Path | Source file |
|---|---|---|
| Attributes `{base, value, changes}` | `system.attributes.<key>` | `src/module/types/template/Attributes.ts` |
| Limits | `system.limits.<key>.value` | `src/module/types/template/Limits.ts` |
| Initiative | `system.initiative.<mode>.constant.value`, `.dice.value` | `src/module/types/template/Initiative.ts`, `src/module/actor/prep/functions/InitiativePrep.ts` |
| Condition monitors | `system.track.physical|stun`, `.physical.overflow` | `src/module/types/template/ConditionMonitors.ts` |
| Skills (derived from skill items) | `system.skills.active|language|knowledge.<type>` | `src/module/types/template/Skills.ts`, `src/module/actor/prep/functions/SkillFieldPrep.ts` |
| Weapon accuracy / DV / AP | `system.action.limit.value`, `system.action.damage.value`, `.type.value`, `.ap.value` | `src/module/types/item/Action.ts`, `src/module/types/item/Weapon.ts` |
| Items (quality, spell, cyberware, …) | `system.*` | `src/module/types/item/*.ts` |

Foundry hooks used (Foundry v14 API, <https://foundryvtt.com/api/v14/modules/hookEvents.html>):
- `getHeaderControlsApplicationV2(application, controls)` — adds the sheet header control.
- `getActorContextOptions(application, menuItems)` — the `getDocumentContextOptions` hook for Actors; entries use `{label, icon, visible, onClick}` (<https://foundryvtt.com/api/v14/interfaces/foundry.ContextMenuEntry.html>).

### Verifying against a live world

Field paths can differ between system versions. To dump what the exporter actually reads for a character, select its token (or set it as your assigned character) and run this script macro, then inspect the browser console (F12):

```js
game.modules.get('sr5-pdf-export').api.diagnose();
```

The report contains the Foundry and system versions, raw attributes/limits/initiative/tracks/skills, every owned item's `system` data grouped by type, and the collected export data. Use it to confirm a field before changing `scripts/collect.js`.

## Development

```bash
npm test
```

`test/render.test.mjs` builds a PDF from a mock actor shaped like the system's data model and asserts the collected values. Pass a path to write the PDF: `node test/render.test.mjs out.pdf`.

## Releasing

Bump `version` in `module.json` and merge to `main`. `.github/workflows/release.yml` runs the tests, builds `module.zip`, and publishes release `v<version>` with `module.json` and `module.zip` attached (skipped if that tag already exists).

## License

MIT (see `LICENSE`). Vendored libraries in `lib/` are MIT-licensed by their authors (`lib/LICENSE-jspdf.txt`, `lib/LICENSE-jspdf-autotable.txt`). Shadowrun is a trademark of The Topps Company, Inc.; this module contains no game text.
