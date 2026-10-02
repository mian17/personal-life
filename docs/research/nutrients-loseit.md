# Lose It! — Nutrient Fields Tracked (Per Food & Per Day) (Public-Source Research)

Research date: 2026-10-02.

**Summary:** Lose It! publicly advertises calorie/macro tracking (calories, protein, carbs, fat, fiber, sugar) as free-tier and "vitamins, minerals, and other health goals" plus a long list of non-food metrics (blood pressure, glucose, cholesterol, sleep, etc.) as Premium; the exact per-nutrient field list and units are **not published** on any reachable source, so most micronutrient specifics below are UNVERIFIED.

## Source-access note (read first)

Most official Lose It! surfaces and third-party aggregators returned HTTP 403 to the
research tool in this environment and could not be read. Confirmed unreachable (403):
`loseit.com`, `www.loseit.com`, `support.loseit.com` (both HTML and its Zendesk
`/api/v2/help_center/.../articles.json` endpoint), `help.loseit.com`,
`loseit.zendesk.com`, `community.loseit.com`, `www.bing.com/search`, `duckduckgo.com`
(both HTML and lite), `html.duckduckgo.com`, `web.archive.org`, `archive.ph`,
`itunes.apple.com` (both the lookup API and the customer-reviews RSS), `apps.apple.com`,
`www.appbrain.com`, `apkcombo.com`, `www.androidauthority.com`, `en.wikipedia.org`,
`www.reddit.com`, `r.jina.ai`, and `webcache.googleusercontent.com`.

The only reachable, quotable public source family in this environment was the **Google
Play Store listing** for the Android app — the store description (which differs slightly
per locale) and the visible user reviews:
`https://play.google.com/store/apps/details?id=com.fitnow.loseit`
(read in US, GB, CA, AU, IN and DE locales). Every claim below is attributed to that
listing family unless marked otherwise. Anything the store description does not state is
marked **UNVERIFIED** — no nutrient, field name, unit, or gating rule is invented.

Because the store description is marketing copy, it gives the *headline* nutrient
categories (calories, macros, "vitamins, minerals") but **not** an itemized per-food field
list, units, or the exact free/Premium split. Those specifics require the official help
center or the app itself, neither reachable here.

---

## 1. Core macros tracked per food / per day

The reachable sources name these nutrient fields explicitly:

- **Calories** — "track the food you eat, exercise, nutrients, macros, protein, carbs,
  fiber and progress all in one place"; "Easily log and track your food, weight, activity,
  nutrition intake, macros, net calories, and intermittent fasting schedule—all in one
  place"; "track nutrients to build healthier eating habits"
  ([Play Store listing, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **Protein, carbs, fat, fiber, sugar** — the Premium "Advanced Tracking" bullet: "Track
  macronutrients like **protein, carbs, fat, fiber, sugar**; as well as nutrition, vitamins,
  minerals, and other health goals and metrics…"
  ([Play Store listing, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- The UK listing phrases the same umbrella as "track more than just calories including
  **macro, protein, water, carb, sugar**, body measurements, sleep cycles, intermittent
  fasting and more" ([Play Store listing, GB](https://play.google.com/store/apps/details?id=com.fitnow.loseit&hl=en_GB&gl=GB)).
- The store description also references "net calories" as a tracked value
  ([Play Store listing, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **Macros are shown daily:** a user states the app will "show you macros and the amount of
  sugar and fat you're consuming every day"
  ([Play Store review, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).

**Subdivisions claimed but not itemized.** The store description names fiber and sugar at
the top level, but does **not** mention saturated fat, trans fat, cholesterol, or potassium
anywhere in the reachable sources as tracked fields.

- **UNVERIFIED:** whether saturated fat, trans fat, and cholesterol are tracked as distinct
  fields. The only place cholesterol appears in the reachable sources is as a *Premium
  health metric* — "other health goals and metrics, including blood pressure, glucose,
  **cholesterol**, body measurements, sleep cycles and more"
  ([Play Store listing, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit)) —
  which is ambiguous between a blood-cholesterol log and a dietary-cholesterol nutrient.
- **UNVERIFIED:** whether sugar is split into added sugar / sugar alcohol; whether
  fiber has soluble/insoluble variants. Not documented in the reachable sources.
- **UNVERIFIED:** the exact UI field labels Lose It! renders for these values. The store
  copy uses lowercase marketing words ("protein, carbs, fat, fiber, sugar"), not the app's
  display strings.

## 2. Vitamins tracked

- The store description states Premium "Advanced Tracking" covers "nutrition, **vitamins**,
  minerals, and other health goals and metrics" — but gives **no list of individual
  vitamins and no units** in any reachable locale (US/GB/CA/AU/IN/DE)
  ([Play Store listing, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **UNVERIFIED:** the exact vitamin list (e.g. vitamin A, C, D, B6, B12, folate, etc.).
- **UNVERIFIED:** the units used (IU, µg, mg, %DV).
- **UNVERIFIED:** whether individual vitamins are tracked per food, per day, or both.

The only reachable signal about gating is that vitamins fall under the Premium-only
"Advanced Tracking" bullet ([Play Store listing, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).

## 3. Minerals tracked

- The store description states Premium "Advanced Tracking" covers "nutrition, vitamins,
  **minerals**, and other health goals and metrics" — with **no itemized mineral list and
  no units** ([Play Store listing, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **Sodium** and **potassium** are **not named** anywhere in the reachable sources as
  tracked nutrient fields. **UNVERIFIED.**
- **Calcium, iron, magnesium**, and other specific minerals are **not named**. **UNVERIFIED.**
- **UNVERIFIED:** the units used (mg, µg, %DV).
- **UNVERIFIED:** how minerals are displayed per food vs per day.

Note: **potassium** appears in this research only as a *modeled* mineral (the task
brief), not in any reachable source; it is therefore not asserted here.

## 4. Other tracked fields beyond food nutrients (day view)

The store description names these additional tracked items:

- **Water** — "track more than just calories including macro, protein, **water**, carb…"
  ([Play Store listing, GB](https://play.google.com/store/apps/details?id=com.fitnow.loseit&hl=en_GB&gl=GB)).
- **Weight** — "log and track your food, **weight**, activity…"
  ([Play Store listing, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **Exercise / activity** — "track meals and **exercise** and chart the data"; "log and
  track your food, weight, **activity**"
  ([Play Store listing, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **Intermittent fasting** — "set your fasting plan and track your fasts where you track
  your food" ([Play Store listing, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **Net calories** — "track… nutrition intake, macros, **net calories**, and intermittent
  fasting schedule" ([Play Store listing, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **GLP-1 tracker** — "Log your **medication**, view estimated **GLP-1 levels**…"
  ([Play Store listing, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- Premium "other health goals and metrics": "**blood pressure, glucose, cholesterol, body
  measurements, sleep cycles** and more"
  ([Play Store listing, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **Steps** — evidenced indirectly by a user reporting a Health Connect sync problem: "I
  cannot set up the Health Connect to use **steps** from my phone either"
  ([Play Store review, IN](https://play.google.com/store/apps/details?id=com.fitnow.loseit&hl=en&gl=IN));
  and "Fitness App Syncs" is a named Premium feature
  ([Play Store listing, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **Notes** — **UNVERIFIED.** No reachable source mentions a free-text note field.
- **Day-completion control** — a reviewer references trying to "mark finished logging for
  the day", implying a day-state control exists (not a nutrient field)
  ([Play Store review, US, 2026-05-05](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).

## 5. Per-food fields vs per-day fields

The reachable sources establish the **logging model** (food × quantity) but **not** which
fields live on the food record vs the day:

- Each entry references a database food ("a global food database of 56+ million items and
  recipes"; search "our database of items, menu items and recipes") and carries a quantity
  ([Play Store listing, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- Foods are a distinct class from entries: there is a "**verified**" flag on food records
  referenced by users ("macros aren't right on some of the 'verified' items")
  ([Play Store review, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit)),
  and users can add their own foods ("manually adding the food to their database")
  ([Play Store review, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **Daily goals / targets:** the app computes a "**personalized daily calorie budget**"
  from profile data ([Play Store listing, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit)),
  and Premium "**Meal Planning & Targets** — meal targets help you calculate suggested
  nutritional content including macro, carb, protein and overall calorie intake"
  ([Play Store listing, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
  "**Flexible Calorie Budgets** — schedule higher calorie days and lower calorie days"
  implies per-day budget overrides
  ([Play Store listing, GB](https://play.google.com/store/apps/details?id=com.fitnow.loseit&hl=en_GB&gl=GB)).
- **UNVERIFIED:** which nutrient fields exist on the food record vs are computed/summed
  only at day level. The store copy does not describe the data model.
- **UNVERIFIED:** how a user sets or overrides a daily goal for a *specific* nutrient
  (e.g. a protein or fiber goal). "Flexible Calorie Budgets" evidences calorie-budget
  overrides only; per-nutrient goal editing is not documented in reachable sources.
- **UNVERIFIED:** whether a diary entry stores a nutrient snapshot at log time or a live
  reference to the food record (same open question as the companion research doc).

## 6. Free vs Premium gating

- **Free (Basic) features listed:** "Calorie Tracking", "Weight Loss Plan", "Community
  Support" ([Play Store listing, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **Premium features listed:** Photo Meal Logging, AI Voice, Barcode Scanner, **Advanced
  Tracking**, Intermittent Fasting, Meal Planning & Targets, Weight Loss Diet Plans,
  Fitness App Syncs
  ([Play Store listing, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **The gating evidence for nutrients:** the phrase "macronutrients like protein, carbs,
  fat, fiber, sugar; as well as nutrition, **vitamins, minerals**, and other health goals
  and metrics…" sits entirely inside the **Premium** "Advanced Tracking" bullet
  ([Play Store listing, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
  This is the strongest reachable signal that **vitamins and minerals are Premium-gated**;
  it also implies fiber/sugar tracking is Premium (they are listed in the same bullet),
  though the free-tier calorie/macro framing ("track… nutrients, macros, protein, carbs,
  fiber") is ambiguous
  ([Play Store listing, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- Free-tier users see at least calories: "The free version of this app is incredible!! …
  The ability to scan barcodes to identify specific foods…"
  ([Play Store review, AU](https://play.google.com/store/apps/details?id=com.fitnow.loseit&hl=en&gl=AU)).
  Barcode scanning is Premium per the store and corroborated by a user ("barcode scanning
  was behind the paywall")
  ([Play Store review, US, 2024-11-14](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **UNVERIFIED:** whether each individual vitamin/mineral is locked individually or the
  whole "Advanced Tracking" panel is all-or-nothing; and exactly which macro subdivisions
  (e.g. saturated fat) are Premium vs free. The store copy does not enumerate the gate at
  field granularity.

## 7. Data completeness reality (crowdsourced / partial micronutrient data)

- The database is described as large but the reachable sources do **not** state a
  micronutrient-completeness rate: "a global food database of 56+ million items and
  recipes, tracking what you eat is simple and accurate"
  ([Play Store listing, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit));
  the UK listing cites "47+ million searchable food and meal items"
  ([Play Store listing, GB](https://play.google.com/store/apps/details?id=com.fitnow.loseit&hl=en_GB&gl=GB)).
- It is **crowdsourced/mixed**: users can add foods ("manually adding the food to their
  database"; "users scan my items into the app")
  ([Play Store review, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit)),
  and there is a "**verified**" vs unverified food distinction
  ([Play Store review, US](https://play.google.com/store/apps/details?id=com.fitnow.loseit)) —
  i.e. not all records are authoritative.
- **User-reported incompleteness:** "Why is it so hard to find anything in grams?! …
  only like **10% of food items even give it as an option**… majorities of the remaining
  numbers are just flat out wrong."
  ([Play Store review, US, 2026-08-11](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
  This is about per-portion units, not micronutrients, but it is direct user evidence that
  food-record completeness/integrity varies widely.
- **UNVERIFIED:** what fraction of food records actually carry full micronutrient data.
  No reachable source publishes a completeness statistic, and the official help center
  (which might discuss "verified" foods and data sourcing) was 403.

## 8. Field naming / units table

Only fields **named in a reachable source** are listed with a source link. Rows whose
existence is not evidenced in a reachable source are marked UNVERIFIED and carry no unit
or source link. "Per-food?" / "Per-day goal?" reflect what the reachable sources state
("*" = not stated → UNVERIFIED).

| Nutrient / field | Unit | Per-food? | Per-day goal? | Source |
|---|---|---|---|---|
| Calories (incl. "net calories") | UNVERIFIED (kcal implied, not stated) | UNVERIFIED | Yes — "personalized daily calorie budget" | [Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit) |
| Protein | UNVERIFIED (g implied, not stated) | UNVERIFIED | Yes — Premium "meal targets… protein" | [Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit) |
| Carbohydrates ("carbs") | UNVERIFIED | UNVERIFIED | Yes — Premium "meal targets… carb" | [Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit) |
| Fat | UNVERIFIED | UNVERIFIED | UNVERIFIED | [Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit) |
| Fiber | UNVERIFIED | UNVERIFIED | UNVERIFIED | [Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit) |
| Sugar | UNVERIFIED | UNVERIFIED | UNVERIFIED | [Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit) |
| Water | UNVERIFIED | UNVERIFIED | UNVERIFIED | [Play Store listing, GB](https://play.google.com/store/apps/details?id=com.fitnow.loseit&hl=en_GB&gl=GB) |
| Vitamins (collective; list not published) | UNVERIFIED | UNVERIFIED | UNVERIFIED | [Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit) |
| Minerals (collective; list not published) | UNVERIFIED | UNVERIFIED | UNVERIFIED | [Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit) |
| Cholesterol | UNVERIFIED | UNVERIFIED | UNVERIFIED | [Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit) — Premium "health metrics" wording; dietary-vs-blood ambiguous |
| Blood pressure | UNVERIFIED | No (not a food nutrient) | UNVERIFIED | [Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit) |
| Glucose | UNVERIFIED | No (not a food nutrient) | UNVERIFIED | [Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit) |
| Body measurements | UNVERIFIED | No | UNVERIFIED | [Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit) |
| Sleep cycles | UNVERIFIED | No | UNVERIFIED | [Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit) |
| Steps | UNVERIFIED | No | UNVERIFIED | [Play Store review, IN](https://play.google.com/store/apps/details?id=com.fitnow.loseit&hl=en&gl=IN) (Health Connect mention) |
| GLP-1 medication / estimated levels | UNVERIFIED | No | UNVERIFIED | [Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit) |
| Saturated fat | UNVERIFIED | UNVERIFIED | UNVERIFIED | **UNVERIFIED** — not named in any reachable source |
| Trans fat | UNVERIFIED | UNVERIFIED | UNVERIFIED | **UNVERIFIED** — not named in any reachable source |
| Sodium | UNVERIFIED | UNVERIFIED | UNVERIFIED | **UNVERIFIED** — not named in any reachable source |
| Potassium | UNVERIFIED | UNVERIFIED | UNVERIFIED | **UNVERIFIED** — not named in any reachable source |
| Calcium | UNVERIFIED | UNVERIFIED | UNVERIFIED | **UNVERIFIED** — not named in any reachable source |
| Iron | UNVERIFIED | UNVERIFIED | UNVERIFIED | **UNVERIFIED** — not named in any reachable source |

No exact field-name strings (e.g. an API key or UI label) for any nutrient were recoverable
from the reachable sources. **UNVERIFIED (guessed):** the app almost certainly has an
internal schema of named nutrient fields, but nothing in the reachable public sources
exposes those identifiers.

---

## Sources

1. Google Play Store listing — *Calorie Counter by Lose It!* (FitNow, Inc.),
   `https://play.google.com/store/apps/details?id=com.fitnow.loseit`
   (store description and user reviews; accessed 2026-10-02; US locale).
2. Google Play Store listing, UK locale —
   `https://play.google.com/store/apps/details?id=com.fitnow.loseit&hl=en_GB&gl=GB`
   (alternate description wording: "water, carb…", 47+ million items; accessed 2026-10-02).
3. Google Play Store listing, Canada locale —
   `https://play.google.com/store/apps/details?id=com.fitnow.loseit&hl=en&gl=CA` (accessed 2026-10-02).
4. Google Play Store listing, Australia locale —
   `https://play.google.com/store/apps/details?id=com.fitnow.loseit&hl=en&gl=AU`
   (user review on gram units and data quality; accessed 2026-10-02).
5. Google Play Store listing, India locale —
   `https://play.google.com/store/apps/details?id=com.fitnow.loseit&hl=en&gl=IN`
   (Health Connect/steps review; accessed 2026-10-02).
6. Google Play Store listing, Germany locale —
   `https://play.google.com/store/apps/details?id=com.fitnow.loseit&hl=en&gl=DE` (accessed 2026-10-02).
7. Official Lose It! Surfaces — `loseit.com`, `www.loseit.com`, `support.loseit.com`
   (incl. Zendesk API), `help.loseit.com`, `loseit.zendesk.com`, `community.loseit.com` —
   **unreachable (HTTP 403)** from this environment; noted so gaps can be filled later.
8. Third-party / aggregators attempted and **unreachable (HTTP 403)**: `itunes.apple.com`,
   `apps.apple.com`, `web.archive.org`, `archive.ph`, `webcache.googleusercontent.com`,
   `www.bing.com`, `duckduckgo.com`, `html.duckduckgo.com`, `r.jina.ai`,
   `en.wikipedia.org`, `www.reddit.com`, `www.appbrain.com`, `apkcombo.com`,
   `www.androidauthority.com`.

**Coverage gaps (all marked UNVERIFIED above):** the itemized vitamin and mineral lists and
their units; whether saturated fat, trans fat, cholesterol (dietary), sodium, potassium,
calcium, and iron exist as tracked fields; per-food vs per-day field ownership; per-nutrient
daily-goal editing; the exact free/Premium gate at field granularity; and any
micronutrient-completeness statistic for the food database. These require the official
help center or hands-on inspection, neither available in this environment.
