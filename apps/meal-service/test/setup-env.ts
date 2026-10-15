/**
 * Jest setup shared by every meal-service suite, loaded before the test
 * framework (jest `setupFiles`).
 *
 * Suites boot `AppModule` (via `app.factory`), whose bootstrap fails closed
 * without the content-encryption master key — correct production behavior. The
 * suites get a deterministic, obviously-fake test key here so boot succeeds in
 * tests exactly as it does in real environments with a configured key.
 *
 * This is a TEST key (public by design, like a test certificate); real keys are
 * generated per environment with `openssl rand -base64 32` and never committed.
 */
process.env.MEAL_MASTER_KEY ??= Buffer.alloc(32, 0x2c).toString('base64');