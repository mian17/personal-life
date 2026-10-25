export function splitBody(body: string): { title: string; snippet: string } {
  const normalized = body.replaceAll('\r\n', '\n').trim();
  const newline = normalized.indexOf('\n');
  if (newline === -1) {
    return { title: normalized, snippet: '' };
  }
  return {
    title: normalized.slice(0, newline).trim(),
    snippet: normalized.slice(newline + 1).trim(),
  };
}
