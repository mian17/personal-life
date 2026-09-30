import * as fs from 'fs';
import * as path from 'path';
import { metadata as notesMetadata } from '@/app/notes/layout';
import { metadata as todosMetadata } from '@/app/todos/layout';

const publicDir = path.join(__dirname, '..', 'public');
const readManifest = (file: string) =>
  JSON.parse(fs.readFileSync(path.join(publicDir, file), 'utf8'));

describe('per-route PWA manifests', () => {
  it('keeps the root manifest as the default app', () => {
    const root = readManifest('manifest.json');
    expect(root.start_url).toBe('/');
    expect(root.icons.length).toBeGreaterThanOrEqual(1);
  });

  it('gives /notes its own identity', () => {
    const notes = readManifest('manifest-notes.json');
    expect(notes.id).toBe('/notes');
    expect(notes.start_url).toBe('/notes');
    expect(notes.scope).toBe('/notes');
    expect(notes.short_name).toBe('Notes');
    expect(notes.icons.length).toBeGreaterThanOrEqual(1);
  });

  it('gives /todos its own identity', () => {
    const todos = readManifest('manifest-todos.json');
    expect(todos.id).toBe('/todos');
    expect(todos.start_url).toBe('/todos');
    expect(todos.scope).toBe('/todos');
    expect(todos.short_name).toBe('Todos');
    expect(todos.icons.length).toBeGreaterThanOrEqual(1);
  });

  it('links each manifest from its route segment layout', () => {
    expect(notesMetadata.manifest).toBe('/manifest-notes.json');
    expect(todosMetadata.manifest).toBe('/manifest-todos.json');
  });
});
