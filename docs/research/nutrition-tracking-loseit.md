# Lose It! — Food-Logging & Daily-Calorie-Tracking Workflow (Public-Source Research)

Research date: 2026-10-02.

**Source-access note.** Most official Lose It! surfaces (`loseit.com`, `support.loseit.com`,
`help.loseit.com`, `loseit.live`, `blog.loseit.com`) and third-party aggregators
(Wikipedia, Reddit, app-review sites) returned HTTP 403 to the research tool in this
environment and could not be read. The only public source that could be retrieved and
quoted was the **Google Play Store listing** for the Android app, which includes the
store description and user reviews: `https://play.google.com/store/apps/details?id=com.fitnow.loseit`.
Where a detail is not evidenced by that source it is explicitly marked **UNVERIFIED**.
No feature, number, or UI label below is invented; UI wording is quoted where the source
used it.

---

## 1. Goal setup & daily target

- The app positions goal setup as: "Set your weight loss goal, get a personalized calorie
  budget" ([Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- "**Complete your profile, and we'll calculate a personalized daily calorie budget and
  weight loss schedule**" — i.e. the target is derived from profile inputs
  ([Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- The weight-loss plan is described as built "based on your **unique body composition,
  activity level and habits**", which identifies the input categories the user supplies
  ([Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- Target can later be adjusted around "**Meal Planning & Targets** — meal targets help you
  calculate suggested nutritional content including macro, carb, protein and overall
  calorie intake" (a Premium feature) ([Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- A user confirms the setup is a long questionnaire: a reviewer describes "the initial
  (what felt like) **50 question survey**", and that it restarts if interrupted
  (e.g. switching to dark mode or a password-manager app)
  ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- Over time the app provides "a **personalized weight loss guide** that helps you stay on
  track", and "start seeing results in just **three days of consistent tracking**"
  ([Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **UNVERIFIED:** the exact profile fields (age, sex, height, current/target weight, weekly
  pace, activity level), the underlying BMR/TDEE formula, and any automatic re-computation
  of the target as logged weight changes. Not documented in the reachable source.
- **UNVERIFIED:** the exact number of setup questions ("about 50" is one user's estimate,
  not a documented figure).

## 2. Logging loop for one meal — every entry point

The reachable source documents the following logging entry points:

- **Calorie/food tracking via the calorie counter** — free "to make it easy to track meals
  and exercise and chart the data" ([Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **AI Voice** (Premium): "Say '**I had 2 eggs, toast with butter and jam**' to log your
  meal" ([Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **Photo Meal Logging / Snap a photo** (Premium): "**Log meals by taking a picture**";
  "tap the **camera icon** to track food and count calories in seconds"
  ([Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **Barcode Scanner** (Premium): "**Scan food barcodes** or search our database of items,
  menu items and recipes" ([Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **Search** of the food database ("a global food database of **56+ million items and
  recipes**") ([Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **Recipe creation**: a reviewer who cooks and enters recipes confirms "The Lose It! app
  allows that" (recipe entry exists), though it is buggy (see §9)
  ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- The app also advertises "**recent**" convenience through "My foods" — a reviewer
  references the **"My foods"** list ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).

**Step-by-step sequence for logging one item:** the reachable source does **not** publish a
numbered how-to. **UNVERIFIED (guessed):** the plausible flow is open the day / meal →
tap the add (+) control → choose method (search, barcode, photo, voice, recent) → select
food → set portion → add. The specific taps and screen names are not documented in the
reachable source.

- Prior app versions had a "**little + symbol in the bottom middle**" that "opened up the
  menu to log things", which the reviewer reports no longer exists
  ([Play Store review, 2026-02-25](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- One reviewer describes the food database as having "a nicely fleshed out" database and
  "layout is good and practical" ([Play Store review, 2024-11-14](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).

## 3. Portion model

- Quantities are described in context of voice logging: the app "will get them right
  (**including amount**)" ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)), confirming an explicit quantity/amount field per entry.
- Recipe portions are expressed in household/volume measures: a reviewer refers to wanting
  servings "**in cups**", and the app converting between "**quarts**" and "**cups**"
  ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)) — evidence the portion unit can be a household/volume measure.
- **UNVERIFIED:** whether the picker offers servings vs grams vs household measures
  (e.g. "1 medium apple") as distinct choices, whether the user can edit the portion after
  selection, and the exact default unit. Not documented in the reachable source.

## 4. Daily view

- The app's stated design aggregates food, weight, activity, "**nutrition intake, macros,
  net calories, and intermittent fasting schedule—all in one place**"
  ([Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- A "**dashboard**" screen is named by a reviewer ("it's crashing when I go onto the
  dashboard") ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- Macros are displayed daily: a reviewer says "they do **show you macros and the amount of
  sugar and fat** you're consuming every day"
  ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- Budget/remaining behavior is evidenced by a user's arithmetic complaint: "i had **22
  available calories** left and when i put in a food that was **22 calories** it says I'm
  **1 calorie over my budget**"
  ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)) — i.e. the view shows available/remaining calories vs target.
- Meal grouping by meal type is not directly quoted in the reachable source.
  **UNVERIFIED:** the exact meal-group labels (breakfast / lunch / dinner / snacks), their
  ordering, and where "remaining" vs "over" is displayed. One reviewer mentions "**mark
  finished logging for the day**" as a feature that existed and became hard to find,
  implying a day-completion control existed
  ([Play Store review, 2026-05-05](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).

## 5. Correction loop (edit / delete / undo)

- The reachable source does **not** contain an official description of editing or deleting
  an entry, nor of an undo action.
- Indirect evidence that entries persist and are viewed/edited per day: a reviewer notes
  "if I **scroll back through recent days in the logging screen** itself, my recorded meals
  are still there" ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)) — confirming a logging screen with past days.
- **UNVERIFIED:** whether deleting an entry recalculates totals live, whether an undo/snackbar
  exists, and the exact edit affordance. Not documented in the reachable source.

## 6. Photo / AI capture specifically

- **Tier:** Photo Meal Logging is listed under "**PREMIUM PLAN FEATURES**"
  ([Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit));
  AI Voice is also Premium ("**AI Voice** – Say 'I had 2 eggs, toast with butter and jam'
  to log your meal") ([Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit)). Barcode Scanner is likewise Premium
  ([Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit), corroborated by a user: "barcode scanning was **behind the paywall**" ([Play Store review, 2024-11-14](https://play.google.com/store/apps/details?id=com.fitnow.loseit))).
- **Steps:** "Just speak into your phone or **tap the camera icon** to track food and count
  calories in seconds. **Snap a photo, log a meal**"
  ([Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit)). The number of intermediate screens is not documented.
- **Review-before-save:** **UNVERIFIED (guessed).** The reachable source does not state
  whether the user reviews the AI-identified items and portions before saving. No
  screenshot captions are available.
- **Accuracy caveats (user-reported):**
  - "Same with a photo of the food. **It guesses what the food is, but is wildly off!**"
    and barcode: "**90% of the time it pulls up the wrong food.**"
    ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
  - Voice is praised for getting items "**including amount**" right
    ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)), but another user reports "**macros aren't right on some of the 'verified' items**" ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
  - **UNVERIFIED:** any officially documented accuracy rate or disclaimer for Snap It.

## 7. Nutrient data model observed

Evidence points to a **food-database model with per-entry quantity, where the entry is
multiplied out**, rather than a per-entry nutrient snapshot authored by the user:

- Entries are `food × quantity`: voice logging reportedly captures the food "including
  amount" ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)); totals are computed from the logged food.
- Foods are database items ("a global food database of 56+ million items and recipes")
  ([Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit)), and search/barcode "search our database of items, menu items and recipes" ([Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit)) — each entry references a DB food record.
- **User-created-food path exists:** a reviewer was told the barcode fix is "**manually
  adding the food to their database**" ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)), and users "scan my items into the app" ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)) — i.e. users can add foods.
- **Verified vs user data:** "**'verified' items**" are referenced as a distinct class
  ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)), implying a curation flag on food records.
- **UNVERIFIED:** whether a diary entry stores a **snapshot** of the food's nutrients at log
  time or a **live reference** to the food record (so later edits to the food would change
  past entries). The reachable source does not state this. The observed "verified items"
  and DB-backed search are consistent with a shared food record, but the snapshot-vs-live
  question is not documented.

## 8. History, trends, streaks

- Past days are viewable: "scroll back through recent days in the **logging screen**"
  ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- A "**meals graph**" exists: "When I look at the app **meals graph**, it is only very
  slowly adding on the meals for the past week"
  ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- A "**weekly LoseIt summary email**" is sent: "My weekly LoseIt summary email today showed
  I had not eaten the past six days, which is incorrect"
  ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- Data export exists as an "**email export feature**": "Can you fix your freaking email
  export feature? … there is **no way to export data outside of this feature**"
  ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- Progress/community: "celebrate your progress with a personalized weight loss guide", and
  Community Support is a free feature ([Play Store listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **UNVERIFIED:** explicit streak counters, trend graphs beyond the "meals graph", and
  any week/month roll-up UI. Not documented in the reachable source.

## 9. Documented friction points (why users report giving up)

All quotes are from public Play Store reviews
([listing](https://play.google.com/store/apps/details?id=com.fitnow.loseit)):

- **Ads, increasingly intrusive** — "every meal you input makes a scam ad pop up like a
  mobile game. I cant recommend this app anymore and unfortunately will be moving to a
  different one" ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)); "the ads are even more aggressive now to where if you even close the app to
  escape an ad, 5 seconds after re-opening the app, another ad will pop up"
  ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)). Lose It! replies ads can be removed via "a one-time purchase in
  **Profile > Manage > Eliminate Ads**" ([Play Store developer reply, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **Barcode scanner paywalled and unreliable** — "barcode scanning was behind the
  paywall, which is unusual for this sort of app"; "it's a great app that's dragged down
  badly by its choices in regard to monetization" ([Play Store review, 2024-11-14](https://play.google.com/store/apps/details?id=com.fitnow.loseit)); "I paid for a
  year to be able to use bar codes. They don't work. **90% of the time it pulls up the wrong
  food.**" ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **Photo AI inaccuracy** — same review: "Same with a photo of the food. It guesses what the
  food is, but is **wildly off!**" ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **Recurring upgrade popups** — "after 5 months I have stopped using it for one reason.
  There is a **popup that appears pretty much every time I start the app** asking me to buy
  it … So buy it, I hear you say." ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)); "constantly bugs me to upgrade
  to a paid subscription - with a pop up which I **need to manually dismiss**"
  ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **Recipe/portion entry is broken** — "enter recipe for red beans and rice…it makes a
  recipe total volume of 6 quarts…I want the serving portion to be in cups…the app will
  arbitrarily change the quarts to cups matching recipe volume to the serving size but the
  recipe makes 6 quarts not 6 cups. **It can't be entered correctly.**"
  ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **Logging/search instability** — "I've been trying to **search for dishes to add to my
  daily log and no matter what, it shows loading**." ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)); a reviewer also reports
  the day's meals not appearing in the app's meals graph
  ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **Recent UI redesign removed a logging shortcut** — "there used to be a little + symbol in
  the bottom middle when first opening the app that no longer exists…now I have to scroll
  til I find the weight spot" ([Play Store review, 2026-02-25](https://play.google.com/store/apps/details?id=com.fitnow.loseit)); another reviewer: the update "is NOT nearly
  as easy to use, especially when trying to **mark finished logging for the day**. You
  gotta hunt for that now." ([Play Store review, 2026-05-05](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **Billing/account friction** — a user reports being "charged MULTIPLE times" for the same
  subscription ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)); another with a "**Lifetime**" purchase reports the account
  was locked and features moved back behind Premium ("bait and switch")
  ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **Data export broken** — "It has not worked for months…there is no way to export data
  outside of this feature" ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **Aggressive GLP-1 promotion** — "I also selected NO GLP-1 info…but GLP-1 help is at the
  top of every screen" ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **Offline failure** — "adding foods didn't work because my phone had an issue with their
  server… also means it **doesn't work offline** I guess"
  ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).
- **Glitchy calorie math** — "i had 22 available calories left and when i put in a food that
  was 22 calories it says I'm 1 calorie over my budget which is not true"
  ([Play Store review, n.d.](https://play.google.com/store/apps/details?id=com.fitnow.loseit)).

---

## Sources

1. Google Play Store listing — *Calorie Counter by Lose It!* (FitNow, Inc.),
   `https://play.google.com/store/apps/details?id=com.fitnow.loseit`
   (store description, feature/tier list, and user reviews; accessed 2026-10-02).
2. Google Play Store listing, alternate locales used to surface additional reviews:
   `&hl=en&gl=US|GB|CA|AU|IN|DE|FR|SG|NZ|IE|PH`.
3. Official Lose It! help centers (`support.loseit.com`, `help.loseit.com`,
   `loseit.zendesk.com`, `loseit.live/help`) and `loseit.com` / `blog.loseit.com` —
   **unreachable (HTTP 403)** from this environment; noted here so gaps can be filled later.

**Coverage gaps (marked UNVERIFIED above):** exact goal-setup fields and formula; numbered
tap-by-tap logging sequence and screen names; portion-unit picker and post-selection
editing; meal-group labels and daily layout; edit/delete/undo mechanics; photo capture
review-before-save and step count; per-entry nutrient snapshot vs live reference; streak
UI. These require the official help center or hands-on inspection, neither available here.
