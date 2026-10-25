function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Self-contained, no external assets — rendered straight from the controller. */
export function loginPage(error?: string, action = '/login'): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in</title></head>
<body>
<main>
<h1>Sign in</h1>
${error ? `<p role="alert">${escapeHtml(error)}</p>` : ''}
<form method="post" action="${escapeHtml(action)}">
<label>Username <input name="username" type="text" autocomplete="username" required></label>
<label>Password <input name="password" type="password" autocomplete="current-password" required></label>
<button type="submit">Sign in</button>
</form>
</main>
</body>
</html>`;
}

export function homePage(username: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Signed in</title></head>
<body>
<main>
<h1>Signed in as ${escapeHtml(username)}</h1>
<form method="post" action="/logout"><button type="submit">Sign out</button></form>
</main>
</body>
</html>`;
}

/**
 * Side-effect-free logout landing. A GET renders this page, which auto-submits a
 * same-origin POST to `/logout`. The POST (never the GET) performs revocation, so
 * a cross-site navigation still arrives with the IdP session cookie attached —
 * the browser treats the POST as same-origin because it originates here.
 */
export function logoutPage(): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Signing out</title></head>
<body>
<main>
<h1>Signing out…</h1>
<form id="logout-form" method="post" action="/logout">
<button type="submit">Sign out</button>
</form>
</main>
<script>document.getElementById('logout-form').submit();</script>
</body>
</html>`;
}
