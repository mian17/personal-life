# MyFitnessPal nutrient fields — per food and per day (research notes)

Research goal: enumerate the nutrient fields MyFitnessPal tracks and displays per food
item and per day, with exact field names and units where sources reveal them.

**Source-access caveat (read this first).** In the environment where this research was
run, `websearch` returned HTTP 403 and nearly every consumer host was blocked: the
official MyFitnessPal Help Center (`support.myfitnesspal.com`, `myfitnesspal.zendesk.com`),
`myfitnesspal.com` itself (including `/api`), the Wayback Machine, and the Zendesk
help-center JSON API all returned 403. **The source families that remained reachable
were**: the Google Play store listing for the app, and GitHub — both raw files and the
JSON API — via unofficial/community API clients and MCP servers that reverse-engineer
MyFitnessPal's own web, legacy Rails, and native mobile endpoints, whose code and READMEs
document the real nutrient payloads, field names, and units.

Consequence: the **field-level data model** (sections 1, 3, 5, 8) is well sourced from
reverse-engineered payloads that were "live-verified" by their authors against real
accounts. Anything about the **official on-screen wording, the exact free/Premium gating
boundary, and Help-Center-documented behavior** (sections 2, 6, 7) is only partly sourced
and anything not backed below is marked **UNVERIFIED** (with **[UNVERIFIED guess]** for
plausible-but-unsourced items). No nutrient, field name, or unit below is invented.

---

## 1. Core macros tracked per food and per day

MyFitnessPal's core macro set, appearing identically across every reachable surface
(legacy web diary, v2/native API, and community clients), is **calories (energy)**,
**protein**, **carbohydrates**, and **fat**, with the fat fractions and the
carbohydrate fractions as subdivisions.

- The app advertises "Macro tracker lets you see carbs, fat, & protein breakdown" and
  "Set goals for macros, protein, sodium, fiber, and more"
  ([Google Play listing](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)).
- The canonical nutrient record from MyFitnessPal's `api.myfitnesspal.com/v2/foods`
  endpoint uses these exact JSON keys for the macros and their subdivisions:
  `protein`, `carbohydrates`, `fat`, `fiber`, `sugar`, `saturated_fat`,
  `polyunsaturated_fat`, `monounsaturated_fat`, `trans_fat`
  ([python-myfitnesspal `types.py` `FoodItemNutritionDict`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/types.py),
  [thesaaspreneur `myfitnesspal-mcp` `capabilities.py` `NUTRIENT_IDS`](https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/src/mfp_mcp/capabilities.py)).
- Energy is not a bare number: a food's energy is stored as `energy` with a unit of
  `calories` or `kilojoules`, i.e. `nutritional_contents.energy = {value, unit}`
  ([Rift-Walker `mfp-api` `docs/api-reference.md`, food entry shape](https://raw.githubusercontent.com/Rift-Walker/mfp-api/main/docs/api-reference.md),
  [python-myfitnesspal `client.py` `_get_food_item_details`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py)).
- The exact legacy form-field names used when writing a food are
  `nutritional_content[calories]`, `nutritional_content[fat]`,
  `nutritional_content[carbs]`, `nutritional_content[protein]`,
  `nutritional_content[fiber]`, `nutritional_content[sugar]`,
  `nutritional_content[saturated_fat]`, `nutritional_content[polyunsaturated_fat]`,
  `nutritional_content[monounsaturated_fat]`, `nutritional_content[trans_fat]`
  ([python-myfitnesspal `client.py` `set_new_food`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py)).
  Note the write path uses `carbs` while the read path (v2 JSON) uses `carbohydrates`
  — the library normalises this with an abbreviation map `{"carbs": "carbohydrates"}`
  ([python-myfitnesspal `client.py` `ABBREVIATIONS`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py)).
- The four fat subdivisions MyFitnessPal tracks are **saturated**, **polyunsaturated**,
  **monounsaturated**, and **trans** fat, plus **cholesterol** — these appear together
  in every food payload and goal payload
  ([HA-MyFitnessPal README, "secondary nutrient sensors"](https://raw.githubusercontent.com/Jocke1970/HA-MyFitnessPal/main/README.md),
  [Rift-Walker `mfp-api` `docs/api-reference.md`, nutrient goals](https://raw.githubusercontent.com/Rift-Walker/mfp-api/main/docs/api-reference.md)).
- The carbohydrate subdivisions are **fiber** and **sugar** (and, in the newer app,
  a derived **net carbs** value). **Added sugars** is also tracked as a distinct value
  ([HA-MyFitnessPal README, "secondary nutrient sensors"](https://raw.githubusercontent.com/Jocke1970/HA-MyFitnessPal/main/README.md)).
- **Net carbs** is a distinct stored field: MyFitnessPal stores `net_carbs` and reports
  `total = carbohydrates = net_carbs + fiber` (for a net-carb label), so `carbohydrates`
  is the total including fiber and `net_carbs` the subtraction
  ([thesaaspreneur `myfitnesspal-mcp` `server.py`, custom-food carb/country_code comment](https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/src/mfp_mcp/server.py)).
  "Net Carbs Mode / Carb Tracker — view net carbs in your food" is a **Premium** feature
  ([Google Play listing](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)).
- **Fiber is not always a free-entry field**: MyFitnessPal recomputes the *fiber goal*
  from calories and ignores a custom fiber goal value
  ([thesaaspreneur `myfitnesspal-mcp` `capabilities.py` `set_nutrient_goals`](https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/src/mfp_mcp/capabilities.py)).

## 2. Vitamins tracked

The reachable sources show **four vitamins, and only these four** — Vitamin A,
Vitamin C, and (from the food panel) no others in the standard record set:

- The canonical food record contains exactly `vitamin_a` and `vitamin_c` as the two
  vitamin keys — there is no `vitamin_d`, `vitamin_b12`, `folate`, etc. in the payload
  ([python-myfitnesspal `types.py` `FoodItemNutritionDict`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/types.py),
  [thesaaspreneur `myfitnesspal-mcp` `capabilities.py` `NUTRIENT_IDS`](https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/src/mfp_mcp/capabilities.py)).
- The custom-food entry panel exposes exactly four micronutrients, and they are all
  **%DV** values: `vitamin_a` ("Vitamin A, %DV"), `vitamin_c` ("Vitamin C, %DV"),
  and the two minerals `calcium` and `iron` (also %DV)
  ([thesaaspreneur `myfitnesspal-mcp` `server.py` `CreateCustomFoodInput`](https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/src/mfp_mcp/server.py)).
  So Vitamin A and Vitamin C are stored **as a percent of Daily Value (%DV)**, not as
  IU or mcg — at least on the write panel. (The legacy HTML form accepted the same keys
  without a unit annotation: `nutritional_content[vitamin_a]`,
  `nutritional_content[vitamin_c]`
  ([python-myfitnesspal `client.py` `set_new_food`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py)).)
- The native mobile API's nutrient-goals payload likewise carries only `vitamin_a` and
  `vitamin_c` among vitamins
  ([Rift-Walker `mfp-api` `docs/api-reference.md`, nutrient goals](https://raw.githubusercontent.com/Rift-Walker/mfp-api/main/docs/api-reference.md)).
- Whether the app displays Vitamin A/C in IU or mcg (rather than %DV) on the *food
  detail* screen is **UNVERIFIED** — the Help Center page on micronutrients was 403.
- Vitamin D, Vitamin E, Vitamin K, B-vitamins (B6/B12, folate, thiamin, riboflavin,
  niacin, pantothenic acid), and any other vitamin are **not present** in any reachable
  payload and are therefore **UNVERIFIED as unsupported** (the payloads strongly imply
  they are simply not tracked as fixed fields).
- Free-tier vs Premium for vitamins: no reachable source states that vitamin tracking is
  gated. The Google Play listing puts "Customize macros and set custom goals" and
  "Net Carbs Mode" under Premium but does not mention vitamins
  ([Google Play listing](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)).
  A paid user complaint asserts the app won't let you add magnesium even with Premium
  ([Google Play review, Sep 3 2024](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)),
  which speaks to the fixed field set, not to a vitamin gate. Any vitamin-specific gating
  is **UNVERIFIED**.

## 3. Minerals tracked

The reachable sources show exactly **four minerals** as first-class nutrient fields:
**sodium**, **potassium**, **calcium**, and **iron** — plus cholesterol (a sterol, not a
mineral) in the same block.

- The canonical food record contains `sodium`, `potassium`, `calcium`, `iron`
  ([python-myfitnesspal `types.py` `FoodItemNutritionDict`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/types.py),
  [thesaaspreneur `myfitnesspal-mcp` `capabilities.py` `NUTRIENT_IDS`](https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/src/mfp_mcp/capabilities.py)).
- Units: **cholesterol**, **sodium**, and **potassium** are stored in **milligrams (mg)**
  — the custom-food panel labels them "Cholesterol, mg", "Sodium, mg", "Potassium, mg"
  ([thesaaspreneur `myfitnesspal-mcp` `server.py` `CreateCustomFoodInput`](https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/src/mfp_mcp/server.py)).
  This is corroborated by python-myfitnesspal's unit map, which reads sodium and
  potassium (`potass.`) as **mg** and protein/fat/carbs/sugar/fiber as **g**
  ([python-myfitnesspal `client.py` `DEFAULT_MEASURE_AND_UNIT`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py)).
- **Calcium** and **iron** are stored as **%DV** — the custom-food panel labels them
  "Calcium, %DV" and "Iron, %DV"
  ([thesaaspreneur `myfitnesspal-mcp` `server.py` `CreateCustomFoodInput`](https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/src/mfp_mcp/server.py)).
  (The display unit the food screen uses is **UNVERIFIED**.)
- The Google Play listing confirms sodium is a settable goal ("Set goals for macros,
  protein, sodium, fiber, and more")
  ([Google Play listing](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)).
- **Magnesium, zinc, phosphorus, selenium, copper, manganese, iodine, chloride** and
  other minerals are **not tracked** as fixed fields — a paying user reports "can't track
  magnesium ... They don't even have the option to add magnesium when you create a food
  ... I have premium" ([Google Play review, Sep 3 2024](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)),
  matching the fixed 17-field payload.
- Free-tier vs Premium for minerals: the app markets sodium tracking as an ordinary macro
  feature, not a Premium one
  ([Google Play listing](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)).
  No reachable source states any mineral is Premium-gated; any such gating is **UNVERIFIED**.

## 4. Other tracked fields beyond food nutrients (day view)

The day view carries several non-food-nutrient values in addition to summed nutrients:

- **Water** — tracked per day and read back in **milliliters**: the legacy endpoint
  `GET /food/water?date=YYYY-MM-DD` returns `item.milliliters`, and the native API returns
  `{milliliters, cups}` on write (with MyFitnessPal's own ~240 ml "metric cup" constant)
  ([python-myfitnesspal `client.py` `_get_water`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py),
  [Rift-Walker `mfp-api` `docs/api-reference.md`, water intake](https://raw.githubusercontent.com/Rift-Walker/mfp-api/main/docs/api-reference.md),
  [Mason-Levyy `myfitnesspal-mcp` README, water](https://github.com/Mason-Levyy/myfitnesspal-mcp)).
  The app advertises "Make sure you're staying hydrated with our water tracker"
  ([Google Play listing](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)).
- **Exercise** — the exercise diary is a separate section with **calories burned**,
  **duration**, **start time**, **METS**, optional **avg/max heart rate** (cardio), and
  **sets / reps per set / total reps / weight per set** (strength); MyFitnessPal also
  returns partner "calorie adjustment" entries (e.g. Garmin Connect) flagged by
  `is_calorie_adjustment`
  ([HA-MyFitnessPal `docs/read-only-api-scope.md`, exercise diary](https://raw.githubusercontent.com/Jocke1970/HA-MyFitnessPal/main/docs/read-only-api-scope.md),
  [Rift-Walker `mfp-api` `docs/api-reference.md`, exercise diary](https://raw.githubusercontent.com/Rift-Walker/mfp-api/main/docs/api-reference.md)).
  Exercise energy can be assigned back to the day's calorie/macro goals via MyFitnessPal's
  `assign_exercise_energy` flag plus `exercise_carbohydrates_percentage`,
  `exercise_fat_percentage`, `exercise_protein_percentage`
  ([HA-MyFitnessPal `coordinator.py` `_apply_exercise_energy_to_goals`](https://raw.githubusercontent.com/Jocke1970/HA-MyFitnessPal/main/custom_components/myfitnesspal/coordinator.py)).
- **Steps** — the account metadata has a `step_sources` field (the user's connected step
  sources) ([python-myfitnesspal `types.py` `UserMetadata`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/types.py)),
  and the app advertises "Add workouts and steps with the integrated fitness tracker"
  ([Google Play listing](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)).
  A per-day step *count* surfaced in the day view is **UNVERIFIED** — it is not in the
  nutrition diary payload.
- **Notes** — a free-text daily diary note, read/written via `/food/note?date=...`
  returning `item` with a `body` ([python-myfitnesspal `client.py` `_get_notes`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py),
  [Mason-Levyy `myfitnesspal-mcp` README, `fitness_get_day` / `fitness_get_note` / `fitness_log_note`](https://github.com/Mason-Levyy/myfitnesspal-mcp)).
  Mason-Levyy's README additionally names a **"feel note"** (a subjective note stored
  locally, never sent to MyFitnessPal).
- **Diary completion status** — a per-day "complete day" state
  ([python-myfitnesspal `client.py` `_get_completion`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py)).
- **Weight / body measurements** are their own per-day resource, not nutrients: the
  native API's `GET /v2/measurements?entry_date=` returns items like
  `{type:"Weight", value, date, unit:"pounds"}`, and the app supports other measurement
  types (e.g. Body Fat, Waist, Neck) and user-added custom types
  ([Rift-Walker `mfp-api` `docs/api-reference.md`, weight measurements](https://raw.githubusercontent.com/Rift-Walker/mfp-api/main/docs/api-reference.md),
  [Andyyyy64 `myfitnesspal-cli` README, "weight types"](https://raw.githubusercontent.com/Andyyyy64/myfitnesspal-cli/main/README.md)).
- **Fasting window** — an intermittent-fasting log exists in the newer app surface
  ([thesaaspreneur `myfitnesspal-mcp` README, "Fasting" row](https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/README.md)),
  and the app advertises "an intermittent fasting tracker"
  ([Google Play listing](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)).
- **Login streak** — `system_data.login_streak` is tracked account-wide
  ([python-myfitnesspal `types.py` `SystemDataDict`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/types.py)).
- Whether the day view shows a **water goal** is **UNVERIFIED**: one community client
  explicitly notes no water goal is exposed through its read path and that MyFitnessPal's
  water goal "lives elsewhere"
  ([thesaaspreneur `myfitnesspal-mcp` `server.py`, `_water_payload` comment](https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/src/mfp_mcp/server.py)).

## 5. Per-food fields vs per-day fields

**Per-food record** (the food item, as persisted) carries the full per-reference-amount
nutrient block:

- `energy` (`{value, unit}` — calories or kilojoules), `protein`, `carbohydrates`, `fat`,
  `fiber`, `sugar`, `saturated_fat`, `polyunsaturated_fat`, `monounsaturated_fat`,
  `trans_fat`, `cholesterol`, `sodium`, `potassium`, `vitamin_a`, `vitamin_c`, `calcium`,
  `iron`, plus `net_carbs` and (in the app) `added_sugars`
  ([thesaaspreneur `myfitnesspal-mcp` `capabilities.py` `NUTRIENT_IDS`](https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/src/mfp_mcp/capabilities.py),
  [Rift-Walker `mfp-api` `docs/api-reference.md`, food entry shape](https://raw.githubusercontent.com/Rift-Walker/mfp-api/main/docs/api-reference.md),
  [HA-MyFitnessPal README, secondary nutrient sensors](https://raw.githubusercontent.com/Jocke1970/HA-MyFitnessPal/main/README.md)).
- The food also carries `grams`/`nutrition_basis_grams` (the basis the values are stated
  per), `serving_sizes[]`, `verified`, and `confirmations`
  ([python-myfitnesspal `fooditem.py`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/fooditem.py),
  [thesaaspreneur `myfitnesspal-mcp` `server.py` `get_food_v2` usage](https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/src/mfp_mcp/server.py)).

**Per-entry (food × quantity, per meal on a date)** stores the *computed* nutrient
snapshot for that actual serving under `nutritional_contents`, alongside `servings`,
`serving_size {value, unit, nutrition_multiplier, gram_weight}`, `meal_name`, `date`,
and `type:"food_entry"`
([Rift-Walker `mfp-api` `docs/api-reference.md`, `GET /v2/diary`](https://raw.githubusercontent.com/Rift-Walker/mfp-api/main/docs/api-reference.md)).
The legacy diary likewise yields a per-entry nutrient dict and sums those dicts for the
day ([python-myfitnesspal `client.py` `_get_meals`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py),
[python-myfitnesspal `day.py` `_compute_totals`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/day.py)).

**Per-day fields** (summed/derived, not on the food):

- **Totals** = sum of each entry's `nutritional_contents` across all meals
  ([HA-MyFitnessPal `coordinator.py` `_sum_totals`](https://raw.githubusercontent.com/Jocke1970/HA-MyFitnessPal/main/custom_components/myfitnesspal/coordinator.py),
  [python-myfitnesspal `day.py` `_compute_totals`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/day.py)).
- **Goals** and **remaining** (= goal − total, only where both are known)
  ([HA-MyFitnessPal `coordinator.py` `_remaining_values`](https://raw.githubusercontent.com/Jocke1970/HA-MyFitnessPal/main/custom_components/myfitnesspal/coordinator.py)).
- **Water** (ml), **notes**, **exercise totals**, **completion**
  ([python-myfitnesspal `client.py` `get_date`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py)).

**Display selection is user-configurable and capped.** Diary settings hold
`tracked_nutrients` (a list of nutrient names/ids), and the UI shows an **up-to-6**
subset the user chooses — e.g. "swap Sugar for Fiber"
([python-myfitnesspal `types.py` `DiaryPreferencesDict` `tracked_nutrients`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/types.py),
[thesaaspreneur `myfitnesspal-mcp` `capabilities.py` `NUTRIENT_IDS` + `set_tracked_nutrients` "up to 6"](https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/src/mfp_mcp/capabilities.py)).
Because only ~6 of the ~17 fields fit the diary columns, a nutrient can exist per food
yet not appear in the day summary unless selected.

**How daily goals are set / overridden.** Goals are a **versioned, per-day** record, not
a single mutable value:

- `GET /v2/nutrient-goals` returns `items[0]` with `valid_from`, `valid_to`,
  a `default_goal`, and a `daily_goals[]` array of **7 per-weekday objects**, each with
  `day_of_week` and `group_id` (daily overrides layered over `default_goal`)
  ([Rift-Walker `mfp-api` `docs/api-reference.md`, nutrient goals](https://raw.githubusercontent.com/Rift-Walker/mfp-api/main/docs/api-reference.md),
  [HA-MyFitnessPal `coordinator.py` `_effective_goals`](https://raw.githubusercontent.com/Jocke1970/HA-MyFitnessPal/main/custom_components/myfitnesspal/coordinator.py)).
- Each goal object carries: `energy {value, unit}`, `carbohydrates`, `protein`, `fat`,
  `saturated_fat`, `polyunsaturated_fat`, `monounsaturated_fat`, `trans_fat`,
  `cholesterol`, `sodium`, `potassium`, `fiber`, `sugar`, `vitamin_a`, `vitamin_c`,
  `calcium`, `iron`, plus `assign_exercise_energy` and `exercise_*_percentage`
  ([Rift-Walker `mfp-api` `docs/api-reference.md`, nutrient goals](https://raw.githubusercontent.com/Rift-Walker/mfp-api/main/docs/api-reference.md)).
- Goals are written by POSTing `{item: {valid_from, default_goal, daily_goals}}`; the
  server **ignores the sent `valid_from` and stamps the current date**; there is **no
  delete**, so reverting means writing the old values back
  ([Rift-Walker `mfp-api` `docs/api-reference.md`, nutrient goals gotcha](https://raw.githubusercontent.com/Rift-Walker/mfp-api/main/docs/api-reference.md)).
- **Exercise energy can override the effective daily goal**: when
  `assign_exercise_energy` is set, real exercise calories (plus partner adjustments) are
  added to the day's calorie target and redistributed to macros via the
  `exercise_*_percentage` settings
  ([HA-MyFitnessPal `coordinator.py`](https://raw.githubusercontent.com/Jocke1970/HA-MyFitnessPal/main/custom_components/myfitnesspal/coordinator.py)).
- On the free tier, "Values will be adjusted and rounded by MFP if no premium
  subscription is applied" — i.e. free-tier target values are constrained
  ([python-myfitnesspal `client.py` `set_new_goal` docstring](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py)).
- One client reports `day.goals` (its legacy per-day read) returns only calories,
  carbohydrates, fat, protein, sodium, and sugar, while the native goals endpoint returns
  the full set — i.e. the *displayed* per-day goal set is narrower than the stored one
  ([thesaaspreneur `myfitnesspal-mcp` `server.py`, `_water_payload` comment + `mfp_get_goals`](https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/src/mfp_mcp/server.py)).

## 6. Free vs Premium gating

Reachable sources are thin here; the Help Center pricing/feature pages were 403.

- The Google Play listing separates the tiers. **Premium** lists: "barcode scan, meal
  scan, and voice logging", "Customize macros and set custom goals", ad-free logging, and
  **"Net Carbs Mode/Carb Tracker — ... view net carbs in your food"**
  ([Google Play listing](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)).
  **Premium Plus** adds meal planning, grocery delivery, and "smart meal tracking tools".
- Custom/advanced macro targets are explicitly a premium feature: "Customized macro,
  calorie & nutrition goals tailored to your fitness targets" is under **Premium**
  ([Google Play listing](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)).
- Barcode scanning is now Premium: a reviewer complains "Ridiculous this is part of the
  premium package that you have to pay for now"
  ([Google Play review, Jan 7 2025](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)).
- What the listing places in the **free** tier: food/macro tracking ("Macro tracker lets
  you see carbs, fat, & protein breakdown"), the water tracker, "Set goals for macros,
  protein, sodium, fiber, and more", activity/steps tracking, and saving recipes/meals
  ([Google Play listing](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)).
- **No reachable source states that any specific vitamin or mineral field is Premium-only.**
  The nutrients named in the free description (macros, protein, sodium, fiber) and the
  fixed 17-field set are not described as gated. The only nutrient-like gating the sources
  confirm is **Net Carbs mode** (Premium) and **custom macro goals** (Premium).
- A paying user's complaint that custom *nutrients* can't be added ("can't track
  magnesium ... I have premium") implies that even Premium does not unlock arbitrary
  micronutrients
  ([Google Play review, Sep 3 2024](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)).
- Whether free accounts see a *reduced* nutrient panel (e.g. fewer than the full 17) on
  the food-detail screen is **UNVERIFIED** — no reachable source compares the panel across
  tiers.

## 7. Data completeness reality

- The database is **crowdsourced and user-submitted**, not a single curated dataset: the
  app advertises "over 20.5 million foods (including restaurant dishes) from one of the
  largest food databases available"
  ([Google Play listing](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)),
  while users submit their own foods into the shared DB
  ([python-myfitnesspal `client.py` `set_new_food` — submits with optional `sharepublic`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py)).
- Foods are marked **`verified`** vs not and carry a **`confirmations`** count, and search
  results show a "verified" icon — an explicit signal that many entries are unverified and
  quality varies ([python-myfitnesspal `fooditem.py`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/fooditem.py),
  [python-myfitnesspal `client.py` `_get_food_search_results`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py)).
- **Micronutrient population is partial by design.** The newer native API *preserves the
  distinction between a nutrient that is explicitly `0` and one MyFitnessPal "did not
  provide"* — a nutrient absent from the logged foods' payload leaves the value
  unavailable/unknown rather than zero
  ([HA-MyFitnessPal README](https://raw.githubusercontent.com/Jocke1970/HA-MyFitnessPal/main/README.md)).
  This is direct evidence that micro fields are frequently missing per food.
- The aggregate client only exposes the secondary nutrients "when present", and its card
  shows a count of how many secondary nutrient values are actually available — again
  implying sparse population ([HA-MyFitnessPal README](https://raw.githubusercontent.com/Jocke1970/HA-MyFitnessPal/main/README.md)).
- The **CSV export is macro-limited**, which is indirect evidence the guaranteed-complete
  fields are the macros: the community importer recognises columns for date, meal, food,
  **calories, protein, carbs, fat, fiber**, and serving/grams — vitamins and minerals are
  not in the documented export columns
  ([openplate `lib/mfp.ts` `ALIASES`](https://raw.githubusercontent.com/mohitagw15856/openplate/main/lib/mfp.ts)).
- Column-name drift across export versions ("at least three spellings of the calorie
  column") and free-text meal names indicate the export/flattening is not rigidly typed
  ([openplate `README.md`](https://raw.githubusercontent.com/mohitagw15856/openplate/main/README.md)).
- The exact **percentage of foods** with each micronutrient populated is **UNVERIFIED** —
  no reachable source gives coverage stats.

## 7b. Cross-app contrast — Lose It! (first-party user enumeration)

The user enumerated Lose It!'s tracked-nutrient set directly from the app (see
`docs/research/nutrients-loseit.md` `## 0`, the highest-confidence source for that app).
The differences from MyFitnessPal's fixed 17-field set are the design-relevant part:

| Nutrient group | MyFitnessPal | Lose It! (first-party) |
|---|---|---|
| Fat breakdown | saturated, polyunsaturated, monounsaturated, trans | same four |
| Carb breakdown | fiber, sugar, **added sugars, net carbs** | fiber, sugar only |
| Cholesterol | yes (mg) | yes |
| Sodium | yes (mg) | yes |
| Potassium | yes (mg), in the mineral block | yes (mg), in the mineral block |
| Vitamins | **Vitamin A, Vitamin C only** | **A, C, B1 (thiamin), B2 (riboflavin), B3 (niacin), B6, B9 (folate), B12** |
| Minerals | **calcium, iron only** (stored as %DV, not mg) | **calcium, iron, magnesium, phosphorus, potassium, zinc** (all mg) |
| Caffeine | not tracked | tracked (mg) |
| Water | yes (day-level, ml) | yes (day-level, per store listing) |

Two takeaways for our own nutrient model:

1. **MyFitnessPal is the narrower model**: 17 fixed fields, four of them vitamins/minerals,
   and its calcium/iron/vitamin A/vitamin C are **%DV**, not absolute mass. Lose It! goes
   wider on vitamins (8) and minerals (6) and states minerals in **mg**.
2. **Neither app tracks added sugars + net carbs *and* the wider micro set** — MFP has the
   carb subdivisions, Lose It! has the wider micros. A model covering both is a superset of
   either, which is cheap to store and expensive to backfill later.

## 8. Field naming / units table

Field names are the exact MyFitnessPal API keys as revealed by the reverse-engineered
payloads. "per-food?" = present on the food/entry nutrient record. "per-day goal?" =
present as a settable daily goal field. Units are as the sources state them; a `%DV` on
the custom-food panel is noted where that is the only stated unit.

| Nutrient | Unit | per-food? | per-day goal? | Source link |
|---|---|---|---|---|
| Energy (calories) | kcal / kJ (`energy {value, unit}`) | Yes | Yes (`energy`) | [Rift-Walker api-reference](https://raw.githubusercontent.com/Rift-Walker/mfp-api/main/docs/api-reference.md) |
| Protein | g (`protein`) | Yes | Yes | [python-myfitnesspal types.py](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/types.py) |
| Carbohydrates | g (`carbohydrates`; write path `carbs`) | Yes | Yes | [python-myfitnesspal client.py](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py) |
| Fat (total) | g (`fat`) | Yes | Yes | [python-myfitnesspal types.py](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/types.py) |
| Saturated fat | g (`saturated_fat`) | Yes | Yes | [thesaaspreneur server.py](https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/src/mfp_mcp/server.py) |
| Polyunsaturated fat | g (`polyunsaturated_fat`) | Yes | Yes | [thesaaspreneur server.py](https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/src/mfp_mcp/server.py) |
| Monounsaturated fat | g (`monounsaturated_fat`) | Yes | Yes | [thesaaspreneur server.py](https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/src/mfp_mcp/server.py) |
| Trans fat | g (`trans_fat`) | Yes | Yes | [thesaaspreneur server.py](https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/src/mfp_mcp/server.py) |
| Cholesterol | mg (`cholesterol`) | Yes | Yes | [thesaaspreneur server.py](https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/src/mfp_mcp/server.py) |
| Sodium | mg (`sodium`) | Yes | Yes | [python-myfitnesspal client.py](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py) |
| Potassium | mg (`potassium`) | Yes | Yes | [python-myfitnesspal client.py](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py) |
| Fiber | g (`fiber`) | Yes | Yes (MFP recomputes from calories) | [thesaaspreneur capabilities.py](https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/src/mfp_mcp/capabilities.py) |
| Sugar | g (`sugar`) | Yes | Yes | [python-myfitnesspal client.py](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py) |
| Added sugars | (UNVERIFIED unit) (`added_sugars`) | Yes (per HA) | UNVERIFIED | [HA-MyFitnessPal README](https://raw.githubusercontent.com/Jocke1970/HA-MyFitnessPal/main/README.md) |
| Net carbs | g (`net_carbs`) | Yes | UNVERIFIED | [thesaaspreneur server.py](https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/src/mfp_mcp/server.py) |
| Vitamin A | %DV (`vitamin_a`) | Yes | Yes | [thesaaspreneur server.py](https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/src/mfp_mcp/server.py) |
| Vitamin C | %DV (`vitamin_c`) | Yes | Yes | [thesaaspreneur server.py](https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/src/mfp_mcp/server.py) |
| Calcium | %DV (`calcium`) | Yes | Yes | [thesaaspreneur server.py](https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/src/mfp_mcp/server.py) |
| Iron | %DV (`iron`) | Yes | Yes | [thesaaspreneur server.py](https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/src/mfp_mcp/server.py) |
| Water | ml (`milliliters`) | No (day-level) | UNVERIFIED (not in read path) | [Rift-Walker api-reference](https://raw.githubusercontent.com/Rift-Walker/mfp-api/main/docs/api-reference.md) |

Non-nutrient day-level values (not nutrients, listed for completeness): exercise
`energy`/`duration`/`start_time`/`mets`/`avg_heart_rate`/`max_heart_rate`/`sets`/
`reps_per_set`/`quantity`/`weight_per_set` and the `assign_exercise_energy` +
`exercise_*_percentage` goal modifiers
([HA-MyFitnessPal read-only-api-scope.md](https://raw.githubusercontent.com/Jocke1970/HA-MyFitnessPal/main/docs/read-only-api-scope.md),
[Rift-Walker api-reference](https://raw.githubusercontent.com/Rift-Walker/mfp-api/main/docs/api-reference.md)).

Vitamins/minerals **not** present in any reachable payload (and so not in this table):
Vitamin D, E, K, B1/B2/B3/B5/B6/B12, folate, magnesium, zinc, phosphorus, selenium,
copper, manganese, and others — **UNVERIFIED as unsupported**, but implied untracked by
the fixed field set.

---

## Sources

Reachable sources only (all other attempted hosts returned HTTP 403 in this environment —
see the caveat at the top).

1. Google Play — MyFitnessPal: Calorie Counter (official store listing: app description,
   free vs Premium feature split, dated user reviews):
   https://play.google.com/store/apps/details?id=com.myfitnesspal.android
2. GitHub — `Rift-Walker/mfp-api` `docs/api-reference.md` (native mobile-app API: REST v2
   `nutritional_contents`, diary entry shape, nutrient-goals field list and semantics,
   water units, exercise, measurements):
   https://raw.githubusercontent.com/Rift-Walker/mfp-api/main/docs/api-reference.md
3. GitHub — `Jocke1970/HA-MyFitnessPal`:
   - `README.md` (primary vs secondary nutrient sensors, missing-vs-zero behaviour,
     exercise fields):
     https://raw.githubusercontent.com/Jocke1970/HA-MyFitnessPal/main/README.md
   - `docs/read-only-api-scope.md` (nutritional_contents aggregation, exercise diary,
     selected-vs-stored nutrient goals):
     https://raw.githubusercontent.com/Jocke1970/HA-MyFitnessPal/main/docs/read-only-api-scope.md
   - `custom_components/myfitnesspal/coordinator.py` (totals summation, effective goals,
     per-weekday `daily_goals`, exercise-energy goal adjustment):
     https://raw.githubusercontent.com/Jocke1970/HA-MyFitnessPal/main/custom_components/myfitnesspal/coordinator.py
4. GitHub — `thesaaspreneur/myfitnesspal-mcp`:
   - `src/mfp_mcp/capabilities.py` (`NUTRIENT_IDS` 1–17, up-to-6 tracked nutrients,
     fiber-goal recomputation, v2 nutritional_contents keys):
     https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/src/mfp_mcp/capabilities.py
   - `src/mfp_mcp/server.py` (custom-food micronutrient fields and their units — mg vs
     %DV; `net_carbs` / `carbohydrates` semantics; `day.goals` field set; water ml):
     https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/src/mfp_mcp/server.py
   - `README.md` (capability list including tracked-nutrients and deep nutrient goals):
     https://raw.githubusercontent.com/thesaaspreneur/myfitnesspal-mcp/main/README.md
5. GitHub — `coddingtonbear/python-myfitnesspal`:
   - `types.py` (`FoodItemNutritionDict` fixed field list, `tracked_nutrients`,
     `step_sources`, `login_streak`):
     https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/types.py
   - `client.py` (food write field names, `DEFAULT_MEASURE_AND_UNIT` g/mg map, legacy
     diary/goal parse, water, notes, food submission):
     https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py
   - `fooditem.py` (`verified`, `confirmations`, nutrient accessors):
     https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/fooditem.py
   - `day.py` (daily total summation):
     https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/day.py
6. GitHub — `Mason-Levyy/myfitnesspal-mcp` `README.md` (reverse-engineered web endpoints:
   diary day payload, daily note, water in ml, trends metrics):
   https://github.com/Mason-Levyy/myfitnesspal-mcp
7. GitHub — `mohitagw15856/openplate` (MFP CSV export column names/aliases and
   macro-limited export; export caveats):
   - `lib/mfp.ts` — https://raw.githubusercontent.com/mohitagw15856/openplate/main/lib/mfp.ts
   - `README.md` — https://raw.githubusercontent.com/mohitagw15856/openplate/main/README.md
8. GitHub — `Andyyyy64/myfitnesspal-cli` `README.md` (internal web API surface: goals,
   diary, food details, measurement types, water, exercise):
   https://raw.githubusercontent.com/Andyyyy64/myfitnesspal-cli/main/README.md
9. GitHub — `Rift-Walker/myfitnesspal-mcp-python` `README.md` (native-API-backed MCP:
   tool surface, goals as a single account record):
   https://raw.githubusercontent.com/Rift-Walker/myfitnesspal-mcp-python/main/README.md

**Blocked / unavailable in this environment (attempted, HTTP 403):** official MyFitnessPal
Help Center and Zendesk help-center API; `myfitnesspal.com` (including `/api`);
Wayback Machine captures of the Help Center; and `websearch` itself. Consequently the
official UI-label, Help-Center-documented, and exact pricing/gating claims that could not
be reached are marked **UNVERIFIED** above.
