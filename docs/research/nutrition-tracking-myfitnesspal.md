# MyFitnessPal food-logging & daily-calorie-tracking workflow — research notes

Research goal: describe how MyFitnessPal's end-user logging and daily calorie-tracking
workflow actually operates.

**Source-access caveat (read this first).** In the environment where this research was
run, `websearch` returned HTTP 403 and nearly every host was blocked: the official
MyFitnessPal Help Center (`support.myfitnesspal.com`, `myfitnesspal.zendesk.com`), the
main `myfitnesspal.com` site, Wikipedia, the Apple App Store, Reddit, review sites
(Healthline, CNET, wikiHow), the Wayback Machine, and the Zendesk help-center JSON API
all returned 403. Only two source families were reachable:

- **Google Play store listing & user reviews** for the app (`com.myfitnesspal.android`) —
  official app description plus dated user reviews.
- **GitHub** — unofficial/community API libraries and MCP servers that reverse-engineer
  MyFitnessPal's own web endpoints, whose code and READMEs document the real diary data
  model, goals payloads, and mutation endpoints.

Because of this, the *structural/data-model* sections (1, 3, 7) and the *friction*
section (9) are well sourced; the *exact on-screen step sequences and UI labels* (2, 4,
5, 6, 8) are only partly sourced, and anything not backed by a reachable source below is
explicitly marked **UNVERIFIED**. Small unsourced items are marked **(UNVERIFIED guess)**.

---

## 1. Goal setup & daily target

- MyFitnessPal is a food/calorie tracker with a personalized daily calorie target; the
  app lets users "Set Goals — Customise your personal weight loss, weight gain, weight
  maintenance & fitness goals" and "Customize calorie, nutrition & fitness goals – weight
  loss, gain, maintenance, or performance" ([Google Play listing](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)).
- The underlying user profile carries the inputs a target is derived from: the profile
  fields include `sex`, `birthdate`, `height`, `starting_weight`, `starting_weight_date`,
  and `activity_factor` ([python-myfitnesspal `types.py`, `UserProfile`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/types.py)).
- The goal preferences structure additionally holds `weight_change_goal` (a unit+value,
  i.e. how much to lose/gain and at what rate), `weight_goal` (target weight),
  `workouts_per_week`, `weekly_workout_duration`, and `weekly_exercise_energy`
  ([python-myfitnesspal `README` `GoalPreferences` fields](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/types.py)).
- The daily target is stored per-day as an energy goal with explicit `energy` (value +
  unit, calories or kilojoules) and macro goals (`carbohydrates`, `protein`, `fat`) — the
  API's `nutrient-goals` endpoint returns `items[0].default_goal` with these fields, and
  a `daily_goals` list ([python-myfitnesspal `client.py` `set_new_goal`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py)).
- Macro targets are the energy split by percentage: MFP's own JS computes calorie energy
  as `4*carbGrams + 4*proteinGrams + 9*fatGrams` ([python-myfitnesspal `client.py`, quoting MFP JS](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py)).
  When only a calorie target is given, macros are derived from the previous goal's
  ratios (scaled to the new energy); when percentages are given, grams are computed as
  `energy * pct / 100 / 4` (carbs, protein) and `energy * pct / 100 / 9` (fat)
  ([python-myfitnesspal `client.py` `set_new_goal`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py)).
- Custom/advanced macro targets are a premium feature: "Customized macro, calorie &
  nutrition goals tailored to your fitness targets" is listed under **Premium**
  ([Google Play listing](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)).
- "Values will be adjusted and rounded by MFP if no premium subscription is applied"
  (docstring on the goal-update function) — i.e. free-tier targets are constrained
  ([python-myfitnesspal `client.py` `set_new_goal`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py)).
- What happens to the target over time: the goal record has `valid_from`/`valid_to`
  windows and per-day `daily_goals` rows, i.e. goals are versioned by date rather than a
  single mutable value ([python-myfitnesspal `client.py` `set_new_goal`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py)).
  Whether the app *automatically* recalculates the target as weight changes is **UNVERIFIED**.
- The exact onboarding wizard wording/steps (e.g. "What is your goal?", activity-level
  picker labels) are **UNVERIFIED** — the Help Center was unreachable.

## 2. Logging loop for one meal (entry points & sequence)

Entry points the app advertises: "Type to search, add from your history, or scan a
barcode" and "Log meals effortlessly from 20.5M+ foods"; premium adds "barcode scan, meal
scan & voice logging" ([Google Play listing](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)).
So the documented entry points are: **search**, **recent/history**, **barcode scan**,
**meal scan (photo)**, and **voice logging**. A **Quick Add / quick calories** entry
point is widely known but is **UNVERIFIED** by the reachable sources.

Under the hood, a "log one food" write goes through these endpoints (reverse-engineered
from the web app), which tells us the conceptual step sequence:

1. A **food search** request returns candidates; the search supplies the `food_id` /
   `weight_id` needed to add ([Mason-Levyy `myfitnesspal-mcp` README, "How it works"](https://github.com/Mason-Levyy/myfitnesspal-mcp)).
2. The legacy **food-search page** (`/food/search`) is what supplies the ids that
   `/food/add` accepts ([Mason-Levyy `myfitnesspal-mcp` README](https://github.com/Mason-Levyy/myfitnesspal-mcp)).
3. **Add to diary** posts to `/food/add` with the chosen food and serving
   ([Mason-Levyy `myfitnesspal-mcp` README](https://github.com/Mason-Levyy/myfitnesspal-mcp)).

A reverse-engineered MCP server models the user flow as **draft-then-confirm**: first a
search returns numbered candidate foods, each listing every serving size with calories and
macros; the user picks an option and a serving, and only then is it logged
([Mason-Levyy `myfitnesspal-mcp` README](https://github.com/Mason-Levyy/myfitnesspal-mcp)).
The exact tap-by-tap UI sequence in the official app (e.g. tap "+" → search field → tap
food → choose meal → set serving → checkmark) is **UNVERIFIED**.

Logging is scoped to a meal section: writes take a `meal` argument of
`breakfast`/`lunch`/`dinner`/`snacks`, or the literal name of any meal currently on the
diary ([Mason-Levyy `myfitnesspal-mcp` README](https://github.com/Mason-Levyy/myfitnesspal-mcp)).

## 3. Portion model

- Each diary entry stores a **food reference plus an amount and unit**. The Java client's
  food object exposes `name`, `brand`, `unit`, `amount`, and energy, and can fetch any
  nutrient for the food ([marcosav `myfitnesspal-api` README](https://raw.githubusercontent.com/marcosav/myfitnesspal-api/master/README.md)).
- Entries express quantity as "N × unit": the Ruby library's example entry is
  `"Rice - Brown, long-grain, cooked"` with `"quantity": 2.5` and a `weight_index`
  selecting one `FoodPortion` ([devonzuegel `myfitnesspal-ruby` README](https://raw.githubusercontent.com/devonzuegel/myfitnesspal-ruby/master/README.md)).
- The python library parses the quantity and unit **out of the entry name** with the
  regex `(?P<short_name>.+), (?P<quantity>\d[\d\.]*) (?P<unit>[\w\(\)]+)`, e.g. a name
  like `"Apple, 1 medium"` splits into short name `Apple`, quantity `1`, unit `medium` —
  confirming household-measure units as first-class units
  ([python-myfitnesspal `entry.py`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/entry.py)).
- Foods carry a list of **serving sizes**, each with an `id`, a `nutrition_multiplier`,
  a `value`, a `unit`, and an `index`; the default/first serving is `index == 0`
  ([python-myfitnesspal `fooditemserving.py`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/fooditemserving.py),
  [python-myfitnesspal `fooditem.py`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/fooditem.py)).
  So a food can offer several units (e.g. grams and a household measure), and picking a
  serving selects which unit the quantity is counted in.
- Calories for an entry are computed from the chosen portion: the Ruby library documents
  `actual_calories = amount * gram_weight * quantity * calories / grams`, with the worked
  example showing three portions for rice (`195 g`, `100 g`, `28.35 g`) and computing
  `1 * 195 * 2.5 * 111 / 100 = 541.125` for a 2.5-quantity brown-rice entry
  ([devonzuegel `myfitnesspal-ruby` README](https://raw.githubusercontent.com/devonzuegel/myfitnesspal-ruby/master/README.md)).
- How a user *picks or edits* a portion on screen (e.g. a serving dropdown, an editable
  quantity field, "1 medium apple" style presets) is consistent with the above data model
  but the exact UI wording is **UNVERIFIED**.

## 4. Daily view (diary / Home)

- The app's daily summary surfaces calories **and** macros: "See today's progress at a
  glance" and "Macro tracker lets you see carbs, fat, & protein breakdown—no need for a
  separate app!" ([Google Play listing](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)).
- The diary is **grouped by meal**. Meals are named and the defaults are Breakfast,
  Lunch, Dinner, Snacks; the meal list is user-configurable ("or whatever your third meal
  name is") and up to two extra meals can be added in Diary Settings
  ([marcosav `myfitnesspal-api` README](https://raw.githubusercontent.com/marcosav/myfitnesspal-api/master/README.md),
  [Mason-Levyy `myfitnesspal-mcp` README](https://github.com/Mason-Levyy/myfitnesspal-mcp)).
- The day view also carries a **total** row and, directly beneath it, a **goal** row, and
  a "complete day" state — the diary page has a `tr.total` followed by a goals row and a
  `#complete_day` block ([python-myfitnesspal `client.py` `_get_goals` / `_get_completion`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py)).
  This is the mechanism behind the total-vs-target / remaining display.
- Daily aggregated **totals** are computed by summing each entry's nutrition across all
  meals ([python-myfitnesspal `day.py` `_compute_totals`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/day.py)).
- The day view also tracks **water** and a **notes** box, and (separately) exercise
  ([python-myfitnesspal `client.py` `get_date`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py)).
- Exact wording of the remaining-calories counter (e.g. "Remaining") and the macro ring
  layout is **UNVERIFIED** — Help Center unreachable.

## 5. Correction loop (edit / delete / recalculate)

- **Delete:** entries are removed individually via a delete button in the diary row; the
  diary tables contain a trailing "delete" column ("This is the 'delete' button")
  ([python-myfitnesspal `client.py` `_get_meals` / `_get_goals`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py)).
  The reverse-engineered write path posts removals to `/food/remove`
  ([Mason-Levyy `myfitnesspal-mcp` README](https://github.com/Mason-Levyy/myfitnesspal-mcp)).
- **Edit / replace:** a reverse-engineered client exposes a "modify" operation that
  *replaces* an entry, including changing its quantity — described as "Replace an entry
  (or change its quantity)"
  ([Mason-Levyy `myfitnesspal-mcp` README](https://github.com/Mason-Levyy/myfitnesspal-mcp)).
- **Recalculation:** because daily totals are a sum over the day's entries computed on
  read ([python-myfitnesspal `day.py` `_compute_totals`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/day.py)),
  adding, deleting, or editing an entry changes the day's total, remaining, and macro
  breakdown. Whether the app offers a true "Undo" affordance after deletion is
  **UNVERIFIED**.
- Water has an explicit reversible correction pattern: every water call returns
  `previous_ml` so "a mistake can be reverted by passing it back" with `replace=True`
  ([Mason-Levyy `myfitnesspal-mcp` README](https://github.com/Mason-Levyy/myfitnesspal-mcp)).

## 6. Photo / AI capture (Meal Scan)

- **Availability / price tier:** meal scan is a **Premium** feature. The store listing
  lists "barcode scan, meal scan & voice logging" under **Premium** (not under the free
  tier) ([Google Play listing](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)).
  Barcode scanning is likewise premium — a reviewer notes "I cannot recommend this
  without the ability to barcode scan! ... part of the premium package that you have to
  pay for now" ([Google Play review, Jill Whitelaw, Jan 7 2025](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)).
- **Exact number of steps and whether the user reviews AI-identified items/portions
  before saving are UNVERIFIED** — no reachable source documents the meal-scan step
  sequence, and the official Help Center article was 403-blocked. The general
  draft-then-confirm logging pattern (choose/review the item and serving before it is
  saved) is confirmed only for the search flow, not specifically for meal scan
  ([Mason-Levyy `myfitnesspal-mcp` README](https://github.com/Mason-Levyy/myfitnesspal-mcp)).
- **Accuracy caveats are UNVERIFIED** by reachable sources. No sourced statement about
  photo-recognition accuracy, error rates, or portion-estimation error was obtainable.
- Related: the app markets "AI-powered nutrition tracker" and an "AI Coach" that gives
  "nutrition insights tailored to your goals, habits, and logging history", but these
  describe insights, not the meal-photo flow itself
  ([Google Play listing](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)).

## 7. Nutrient data model observed

- **Structure is: diary entry = food (database item) × quantity**, placed in a meal on a
  date. Each `FoodEntry` nests a `Food` (with its `nutrients`, `portions`, and `grams`)
  and carries `weight_index` (which portion) and `quantity`
  ([devonzuegel `myfitnesspal-ruby` README](https://raw.githubusercontent.com/devonzuegel/myfitnesspal-ruby/master/README.md)).
- **Per-food nutrient record → per-entry computed totals.** A food item has a base
  nutrient record per reference amount (e.g. rice: `calories: 111` per `grams: 100`), and
  each serving/portion has a `nutrition_multiplier`; the entry's nutrients are the food's
  nutrients scaled by the selected portion and quantity
  ([devonzuegel `myfitnesspal-ruby` README](https://raw.githubusercontent.com/devonzuegel/myfitnesspal-ruby/master/README.md),
  [python-myfitnesspal `fooditemserving.py`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/fooditemserving.py)).
- **The diary reads out per-entry nutrient values, not just a reference to the food.**
  When the diary HTML is parsed, each entry row yields its own nutrient dict
  (`Entry(name, nutrition)`), and day totals are the sum of those per-entry dicts
  ([python-myfitnesspal `client.py` `_get_meals`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py),
  [python-myfitnesspal `day.py` `_compute_totals`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/day.py)).
  So the serving path the user sees is an **entry-level nutrient snapshot as displayed**.
  Whether the DB physically stores a frozen snapshot per entry, or stores a food_id +
  quantity and recomputes on read (i.e. a **live reference** to the food record, so
  editing the food later would change past entries) is **UNVERIFIED** by reachable
  sources — the observable diary shows computed per-entry values either way.
- **Nutrient fields available:** `calcium, carbohydrates, cholesterol, fat, fiber, iron,
  monounsaturated_fat, polyunsaturated_fat, potassium, protein, saturated_fat, sodium,
  sugar, trans_fat, vitamin_a, vitamin_c`
  ([python-myfitnesspal `types.py` `FoodItemNutritionDict`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/types.py)).
  Energy is stored as `energy` with a unit of calories or kilojoules
  ([python-myfitnesspal `client.py` `_get_food_item_details`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py)).
- **User-created-food path exists and is a submitted DB food, not a private entry.**
  The library has `set_new_food(...)` which submits a new food (brand, description,
  calories, macros, micros, `serving_size`, `servingspercontainer`) to MFP's database via
  `food/submit`, `food/duplicate`, and `food/new`, with an optional `sharepublic` flag;
  there is a duplicate-detection step (`food/duplicate`) before saving
  ([python-myfitnesspal `client.py` `set_new_food`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py)).
  So a user-created food becomes a searchable food record that is then logged like any
  other food. The app also advertises "Add Your Own Foods" and saving recipes/meals for
  quick re-logging ([Google Play listing](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)).
- Foods in the database are marked **verified** or not, and carry a **confirmations**
  count; search results use a "verified" icon
  ([python-myfitnesspal `fooditem.py`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/fooditem.py)).
- **Recipes** are a first-class food-like object: recipes have an id, yield, ingredient
  list, and a nutrition block (calories, carbs, fiber, sugar, sodium, protein, fat,
  saturated/mono/poly/trans fat)
  ([python-myfitnesspal `types.py` `Recipe`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/types.py)).
- **Important implementation note:** food **search and content matching run over the
  legacy web HTML endpoints and the `api.myfitnesspal.com/v2` JSON API**, not a public
  API; MyFitnessPal [does have an API] but it is "private-access only"
  ([python-myfitnesspal `readme.markdown`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/readme.markdown)).
  The unofficial MCP server states plainly: "MyFitnessPal has no public API; this
  reverse-engineers the web app's own endpoints" and it now sits "behind Cloudflare +
  NextAuth" ([Mason-Levyy `myfitnesspal-mcp` README](https://github.com/Mason-Levyy/myfitnesspal-mcp)).

## 8. History, trends, streaks

- **History / multi-day diary:** the diary is addressable per date
  (`/food/diary/<username>?date=YYYY-MM-DD`) and multiple days can be fetched in a range
  ([python-myfitnesspal `client.py` `_get_url_for_date`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py),
  [marcosav `myfitnesspal-api` README](https://raw.githubusercontent.com/marcosav/myfitnesspal-api/master/README.md)).
- **Trends / reports:** there is a reports endpoint
  (`/api/services/reports/results/<Category>/<ReportName>/<days>.json`) and a client
  method `get_report(report_name="Net Calories", report_category="Nutrition", ...)`
  returning a date→total mapping; the code warns "Report API may not be able to look back
  this far" beyond ~80 days
  ([python-myfitnesspal `client.py` `get_report` / `_get_url_for_report`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py)).
  The app also advertises tracking "at a glance" and "analyse the details of your diet &
  macros" ([Google Play listing](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)).
- **Measurements / weight history:** weight and other measurements are stored by date and
  fetched in ranges (`get_measurements(measurement="Weight", ...)`), and can be set via
  `/measurements/new` ([python-myfitnesspal `client.py` `get_measurements` / `set_measurements`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py)).
- **Streaks:** the account "system data" object contains `login_streak`, i.e. a login
  streak counter is tracked ([python-myfitnesspal `types.py` `SystemDataDict`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/types.py)).
  Whether the app surfaces a **logging/diary streak** (vs just a login streak) is
  **UNVERIFIED**.
- **Export / bulk history:** the community MCP server offers `fitness_get_trends` (one
  metric over a date range: weight, calories_in, protein, carbs, fat) and `fitness_bulk_export`
  (whole date range in one call), and gap-fills up to 30 days at 1 request/day
  ([Mason-Levyy `myfitnesspal-mcp` README](https://github.com/Mason-Levyy/myfitnesspal-mcp)).
  These are third-party, not official app features.
- Note: MyFitnessPal's own terms/limitations mean native **CSV import is impossible** per
  one community tool ("Importing data into MyFitnessPal is impossible"); export is the
  supported direction ([elisa-aleman `myfitnesspal-import`](https://github.com/topics/myfitnesspal)).

## 9. Documented friction points (where users report giving up)

All quotes below are from dated Google Play reviews
([Google Play listing](https://play.google.com/store/apps/details?id=com.myfitnesspal.android)):

- **Barcode scanning moved behind Premium → users quit.** "I cannot recommend this
  without the ability to barcode scan! Ridiculous this is part of the premium package that
  you have to pay for now! ... I don't have time to search and log food now. Gutted to be
  saying bye to this app!" (78 found helpful, Jan 7 2025). This is the clearest
  "giving up because logging got slower" report.
- **App loses your place mid-log.** "about half the time, before I finish logging it, the
  app randomly takes me back to the main screen (with 'Today' at the top) and I have to
  start again, which is frustrating and adds friction to the action that should be the
  easiest" (91 helpful, Apr 28 2026).
- **Diary order is wrong → hard to verify entries.** "The Diary doesn't show the items in
  the accurate order anymore, which makes it hard to check if I entered them correctly"
  (Apr 28 2026).
- **UI redesign hides the daily view.** "New UI changes are AWFUL ... Can't view the
  entire day anymore, everything is hidden in sub menus. Nutrient info for the day is
  three menus deep ... Can't swipe back to previous days either, have to go through the
  calendar" — user left for another app (43 helpful, Apr 27 2026).
- **Recent-foods / re-logging is broken.** "I can never use my previously logged food
  when logging something new in my diary unless I manually change a setting every time I
  log" (72 helpful, Aug 28 2025).
- **Recipe saving failed for over a year.** "After entering all of my items, with a
  combination of scanning, searching the database or adding a new item ... every single
  time the app gives an error" (63 helpful, Apr 14 2026); later updated "recipes now work
  finally."
- **Sync between app and website fails.** "the past few weeks hasn't synced between the
  app and the website ... why not just fix a repeatedly raised issue?" (41 helpful, Feb 24
  2026).
- **Aggressive Premium upsell.** A user complains the app "constantly pushes for me to
  get premium despite all the issues" (Feb 24 2026); the developer reply acknowledges "the
  screen that encourages you to upgrade to Premium."
- **Reinstall can lose partial history.** "I reinstalled the app ... it erased almost all
  my history. weird thing is that it didn't lose everything - just a few bits and pieces
  from every meal" (72 helpful, Aug 28 2025).
- **Custom nutrient gaps frustrate paying users.** "can't track magnesium ... They don't
  even have the option to add magnesium when you create a food ... I have premium. I
  expect to be able to custom add." (96 helpful, Sep 3 2024). This matches the model in
  section 7: the fixed `FoodItemNutritionDict` field list has no magnesium
  ([python-myfitnesspal `types.py`](https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/types.py)).

---

## Sources

Reachable sources only (all other attempted hosts returned HTTP 403 in this environment).

1. Google Play — MyFitnessPal: Calorie Counter (official store listing, app description,
   data-safety, and dated user reviews; US and UK locales):
   https://play.google.com/store/apps/details?id=com.myfitnesspal.android
2. GitHub — Mason-Levyy/`myfitnesspal-mcp` README (reverse-engineered web endpoints,
   draft-then-confirm logging, meal/edit/remove flows):
   https://github.com/Mason-Levyy/myfitnesspal-mcp
3. GitHub — marcosav/`myfitnesspal-api` README (Java client: day/meal/food model,
   meal names, units):
   https://raw.githubusercontent.com/marcosav/myfitnesspal-api/master/README.md
4. GitHub — devonzuegel/`myfitnesspal-ruby` README (FoodEntry/Food/FoodPortion shape,
   calorie formula):
   https://raw.githubusercontent.com/devonzuegel/myfitnesspal-ruby/master/README.md
5. GitHub — coddingtonbear/`python-myfitnesspal`:
   - `client.py` (goals, diary parse, search, measurements, reports, set_new_food):
     https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/client.py
   - `types.py` (UserProfile, GoalPreferences, nutrient field list, Recipe):
     https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/types.py
   - `day.py` (day totals): https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/day.py
   - `entry.py` (quantity/unit parsing): https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/entry.py
   - `fooditem.py` / `fooditemserving.py` (serving sizes): https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/fooditem.py ,
     https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/myfitnesspal/fooditemserving.py
   - `readme.markdown` (private API only): https://raw.githubusercontent.com/coddingtonbear/python-myfitnesspal/master/readme.markdown
6. GitHub topic listing (community tools, import-impossibility note):
   https://github.com/topics/myfitnesspal

**Blocked / unavailable in this environment (attempted, HTTP 403):** official MyFitnessPal
Help Center and Zendesk help-center API; myfitnesspal.com; Wikipedia; Apple App Store;
Reddit; Healthline, CNET, wikiHow; the Wayback Machine; PyPI project pages; ReadTheDocs.
`websearch` itself returned HTTP 403. Consequently the official UI-label/step-sequence
claims that could not be reached are marked UNVERIFIED above.
