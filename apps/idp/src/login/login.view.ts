function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
