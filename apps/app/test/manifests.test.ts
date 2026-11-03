import * as fs from 'fs';
import * as path from 'path';
import { metadata as notesMetadata } from '@/app/notes/layout';
import { metadata as todosMetadata } from '@/app/todos/layout';
import { metadata as feedbackMetadata } from '@/app/feedback/layout';
import { metadata as mealsMetadata } from '@/app/(meals)/meals/layout';
import { metadata as pomodoroMetadata } from '@/app/pomodoro/layout';

const publicDir = path.join(__dirname, '..', 'public');
const readManifest = (file: string) =>
  JSON.parse(fs.readFileSync(path.join(publicDir, file), 'utf8'));

describe('per-route PWA manifests', () => {
  it('gives /notes its own identity', () => {
    const notes = readManifest('manifest-notes.json');
    expect(notes.id).toBe('/notes');
    expect(notes.start_url).toBe('/notes');
    expect(notes.scope).toBe('/notes');
    expect(notes.short_name).toBe('Notes');
    expect(notes.icons[0].src).toBe('/icon-notes.png');
  });

  it('gives /todos its own identity', () => {
    const todos = readManifest('manifest-todos.json');
    expect(todos.id).toBe('/todos');
    expect(todos.start_url).toBe('/todos');
    expect(todos.scope).toBe('/todos');
    expect(todos.short_name).toBe('Todos');
    expect(todos.icons[0].src).toBe('/icon-todos.png');
  });

  it('gives /feedback its own identity', () => {
    const feedback = readManifest('manifest-feedback.json');
    expect(feedback.id).toBe('/feedback');
    expect(feedback.start_url).toBe('/feedback');
    expect(feedback.scope).toBe('/feedback');
    expect(feedback.short_name).toBe('Feedback');
    expect(feedback.icons[0].src).toBe('/icon-feedback.png');
  });

  it('gives /meals its own identity', () => {
    const meals = readManifest('manifest-meals.json');
    expect(meals.id).toBe('/meals');
    expect(meals.start_url).toBe('/meals');
    expect(meals.scope).toBe('/meals');
    expect(meals.short_name).toBe('Meals');
    expect(meals.icons[0].src).toBe('/icon-meals.png');
  });

  it('gives /pomodoro its own identity', () => {
    const pomodoro = readManifest('manifest-pomodoro.json');
    expect(pomodoro.id).toBe('/pomodoro');
    expect(pomodoro.start_url).toBe('/pomodoro');
    expect(pomodoro.scope).toBe('/pomodoro');
    expect(pomodoro.short_name).toBe('Pomodoro');
    expect(pomodoro.icons[0].src).toBe('/icon-pomodoro.png');
  });

  /**
   * A manifest carries one ground for both schemes, so each keeps the dark value. Pinning it
   * here is what stops the two constants drifting apart after they leave the token file.
   */
  it('paints every route on the revised §2 ground', () => {
    const manifests = [
      'manifest-notes.json',
      'manifest-todos.json',
      'manifest-meals.json',
      'manifest-feedback.json',
      'manifest-pomodoro.json',
    ];
    const grounds = manifests.map((file) => {
      const manifest = readManifest(file);
      return [manifest.theme_color, manifest.background_color];
    });

    expect(grounds).toEqual(manifests.map(() => ['#16171a', '#16171a']));
  });

  it('ships every icon the per-route manifests declare', () => {
    const manifests = [
      'manifest-notes.json',
      'manifest-todos.json',
      'manifest-meals.json',
      'manifest-feedback.json',
      'manifest-pomodoro.json',
    ];
    const missingIcons = manifests.flatMap((manifest) =>
      readManifest(manifest)
        .icons.map((icon: { src: string }) => icon.src.replace(/^\//, ''))
        .filter((file: string) => !fs.existsSync(path.join(publicDir, file))),
    );
    expect(missingIcons).toEqual([]);
  });

  it('ships a byte-distinct icon per route', () => {
    const files = [
      'icon-notes.png',
      'icon-todos.png',
      'icon-meals.png',
      'icon-feedback.png',
      'icon-pomodoro.png',
    ];
    const bodies = files.map((file) => fs.readFileSync(path.join(publicDir, file)).toString('base64'));
    expect(new Set(bodies).size).toBe(files.length);
  });

  it('links each manifest from its route segment layout', () => {
    expect(notesMetadata.manifest).toBe('/manifest-notes.json');
    expect(todosMetadata.manifest).toBe('/manifest-todos.json');
    expect(feedbackMetadata.manifest).toBe('/manifest-feedback.json');
    expect(mealsMetadata.manifest).toBe('/manifest-meals.json');
    expect(pomodoroMetadata.manifest).toBe('/manifest-pomodoro.json');
  });
});
