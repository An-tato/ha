# Congestion variable store — data dictionary

Makati Mobility Intelligence keeps **every variable that affects traffic congestion in one CSV
table**, paired with the congestion level it produced. The map, the KPI strip, the root-cause
accordion and the exports are all downstream of this file.

| | |
|---|---|
| **Store** | [`data/traffic_variables.csv`](traffic_variables.csv) — 66 rows, 50 variables, 7 categories, 6 corridors |
| **Schema version** | 1 (21 columns, see below) |
| **Seeded from** | `Traffic_Variables_Data_Sheet.xlsx` (50 variables / 7 categories) |
| **Generator** | [`tools/seed-variables-csv.mjs`](../tools/seed-variables-csv.mjs) + [`tools/variable-catalog.mjs`](../tools/variable-catalog.mjs) |
| **Regenerate** | `node tools/seed-variables-csv.mjs` (rewrites the CSV **and** the embedded seed copy in `index.html`) |
| **Consumers** | `index.html` → heat layer weighting, *Evidence · Congestion variables* panel, hotspot click popups, root-cause evidence chips, policy brief, variable-table export |

A row is **one occurrence of one variable observed at one place and time window** — for example
*illegal parking on J.P. Rizal between 20:00 and 02:00, paired with congestion index 86 (severe)*.
The same variable appears on several rows when it was recorded on several corridors or windows.

## 1. Columns

| # | Column | Type | Allowed values / format | Purpose |
|---|---|---|---|---|
| 1 | `variable_id` | string | `VAR-<CAT>-NN`, e.g. `VAR-DRV-01` | Stable key. Cited by root causes, exports and popups. |
| 2 | `category` | string | one of the 7 categories in §2 (exact match) | Groups the variable; drives chip colour + rollup. |
| 3 | `variable_name` | string | sheet wording, Filipino terms kept | What was observed ("Illegal Parking / Bad Parking"). |
| 4 | `effect` | enum | `increases` \| `decreases` | Direction of the effect. `decreases` rows subtract from pressure (e.g. protected bike lane, holiday). |
| 5 | `corridor` | enum | `all` \| `ayala` \| `buendia` \| `edsa` \| `poblacion` \| `sanlorenzo` | Binds the row to a WHERE filter key. `all` = network-wide context row. |
| 6 | `location_name` | string | free text | Human-readable spot shown in the UI. |
| 7–8 | `lat`, `lng` | float | WGS-84, 6 dp | Geography. Drives the heat layer and hotspot popups (0.45 km binding radius). |
| 9–10 | `hour_start`, `hour_end` | int | `0`–`23`, inclusive | Observation window. `hour_end < hour_start` wraps past midnight (e.g. `20 → 2`). |
| 11 | `day_type` | enum | `any` \| `weekday` \| `weekend` \| `holiday` \| `school_day` \| `workday` | Calendar context. |
| 12 | `congestion_level` | enum | `low` \| `moderate` \| `high` \| `severe` | **The paired traffic congestion level** shown beside the variable. |
| 13 | `congestion_index` | float | `0`–`100` | **The paired level as a number.** `congestion_level` is derived from it — see §3. |
| 14–16 | `observed_value`, `unit`, `threshold` | number, string, number | e.g. `340`, `violations/week`, `50` | Measurement plus the planning trigger it is compared against (not a legal limit). |
| 17 | `weight` | float | `0`–`1` | Relative contribution to congestion pressure. Renormalised at load; rows need not sum to 1. |
| 18 | `confidence` | float | `0`–`1` | Confidence in the observation; dampens pressure. |
| 19 | `source` | string | free text | Provenance shown in the UI and in every export. |
| 20 | `last_updated` | date | `YYYY-MM-DD` | Freshness of the observation. |
| 21 | `notes` | string | free text | Why it congests — rendered verbatim as the "Why it congests" line. Quote the field if it contains a comma. |

## 2. Categories (the `category` column)

| Category (exact string) | Code | Variables in sheet | Rows seeded |
|---|---|---|---|
| `Vehicle Related Variables` | `VEH` | 5 | 10 |
| `Urban Development Variables` | `URB` | 9 | 12 |
| `Driver Based Variables` | `DRV` | 12 | 17 |
| `Pedestrian Variables` | `PED` | 6 | 8 |
| `Safety Hazards Variables` | `SAF` | 4 | 4 |
| `Event Variables` | `EVT` | 9 | 10 |
| `Weather Variables` | `WX` | 5 | 5 |

The seed covers **all 50 variables** from the source sheet at least once, so no category is
silently dropped from the pipeline.

## 3. Pairing rule (variable ↔ congestion level)

1. `congestion_index` is the measured congestion at that location and window (`0` free-flow → `100` gridlock).
2. `congestion_level` is **derived from the index**, so the two can never contradict each other:

   | Index | Level |
   |---|---|
   | `< 40` | `low` |
   | `40 – 64` | `moderate` |
   | `65 – 84` | `high` |
   | `≥ 85` | `severe` |

3. On load the page recomputes the level from the index. If the stored `congestion_level` disagrees
   it is corrected and counted in the store-integrity line ("*n* level/index pairs corrected").
4. Congestion **pressure** per row = `weight × (congestion_index / 100)`, multiplied by
   `(0.65 + 0.35 × confidence)`. `decreases` rows carry negative pressure. Pressure is renormalised
   into a share across the rows active for the selected corridor and hour, so the panel reads as
   "this variable explains *n*% of the congestion here right now".

## 4. How the page processes the store

```
data/traffic_variables.csv
        │  fetch() at boot (no-store)                ┌── fallback if the fetch fails
        ▼                                            │   (file:// or offline): the
   parseCSV()  ── RFC4180: quotes, embedded commas,   │   seed copy embedded in
        │         comments, blank lines               └── index.html#csvSeed
        ▼
   ingestVariables()  validate → normalise → re-derive level → index by corridor
        │              ┌ reject: unknown category/corridor, bad numbers, hours
        │              └ outside 00–23, missing weight  → reported, not silently dropped
        ▼
   linkHeatVariables()  bind rows to heat cells within 0.45 km (network rows excluded:
        │               they apply as context across the whole selected view)
        ▼
   updateHeat()      intensity = modelled corridor density × (1 + up to 42% variable
        │               pressure boost for cells whose recorded rows are active now)
        ▼
   renderVariables() active rows → pressure shares → ranked "Why this corridor congests"
        │               list + category rollup + paired congestion level
        ▼
   onHeatClick()     click any hot cell → popup naming the exact rows recorded there,
        │               each with its category and paired congestion level
        ▼
   exports           . Aggregated CSV (24 hourly rows, unchanged)
                     . Variable table CSV — same 21 columns, `#` metadata preamble,
                       re-importable without transformation
                     . Policy brief §3b — top 6 variables with paired levels + sources
```

### Fallback behaviour

The page always works: if `data/traffic_variables.csv` cannot be fetched (opened straight from disk,
or the folder is not served over HTTP) it ingests the **seed copy embedded in `index.html`** and labels
itself *"Embedded seed copy"* instead of *"Live store"*. Keep the two in sync by regenerating rather
than hand-editing — the generator writes both from one catalog.

## 5. Adding or changing a variable

1. Add one entry per occurrence to [`tools/variable-catalog.mjs`](../tools/variable-catalog.mjs):
   `cat`, `v`, `eff`, `place`, `loc`, `hours`, `ci`, `value`, `unit`, `threshold`, `w`, `conf`, `src`.
   `place` accepts `['bo', bottleneckId]`, `['path', corridor, fractionAlongRoute, pathIndex]` or
   `['pt', lat, lng]`, so coordinates stay anchored to the corridors drawn on the map.
2. Run `node tools/seed-variables-csv.mjs`. It prints a coverage report
   (rows / variables / categories / corridors, level mix, wrapped windows, mitigating rows).
3. Reload the page: the panel, heat weighting, popups and exports pick the change up with no code edits.

To edit the store by hand instead (a real feed, an approved survey), edit
[`data/traffic_variables.csv`](traffic_variables.csv) directly and skip the generator — but then the
embedded fallback copy in `index.html` is stale, and the page will say so by labelling itself
*Embedded seed copy* only when the fetch fails.

## 6. Provenance and honesty of the data

Every row carries `source`, `confidence` and `last_updated`, and the panel prints a store-integrity
line (rows, categories, corridor keys, severe rows, wrapping windows, rejected rows, corrected
level/index pairs). The figures themselves are **illustrative** — built from Makati corridor
typologies, not live MMDA/LGU telemetry. Replace the CSV (and, if the access pattern changes,
`CORRIDORS`/`CONG` in `index.html`) before any budget decision.
