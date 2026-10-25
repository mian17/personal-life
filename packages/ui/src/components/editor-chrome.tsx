// React 19 types dropped the global `JSX` namespace; it is exported by `react`.
import type { JSX, ReactNode } from 'react';
import { EditorScreen } from './editor-screen';
import { EditorToolbar } from './editor-toolbar';
import { EditorStack } from './editor-stack';
import { TagPicker, type TagOption } from './tag-picker';
import type { StackGap } from './stack';

export interface EditorChromeTagPicker {
  /** Available tags (id + display name) — `TagPicker`'s data shape. */
  tags: readonly TagOption[];
  /** Currently attached ids. */
  selectedIds: readonly number[];
  /** Attach/detach callback; the app owns the state. */
  onToggle: (id: number) => void;
  /** Picker label, e.g. "Attached tags" / "Tags". */
  label?: string;
}

export interface EditorChromeProps {
  /** Back control: a BUTTON, never an href (frozen — calling it flushes/leaves). */
  back: { label: string; onBack: () => void };
  /** Centred `<h1>` title for create/edit screens; wins over `status` in the toolbar. */
  title?: ReactNode;
  /** Status read-out rendered when there is no `title` (e.g. `<StatusText>Saved</StatusText>`). */
  status?: ReactNode;
  /** Toolbar right-side actions (e.g. the Save/Add `IconButton`). */
  actions?: ReactNode;
  /** Banner between toolbar and body (e.g. the app's conflict `AlertBanner`). */
  banner?: ReactNode;
  /** Tag picker wiring; omitted when the screen has no tags. */
  tagPicker?: EditorChromeTagPicker;
  /** `EditorStack` gap; default "lg". */
  gap?: StackGap;
  /** The editor fields, stacked by the block inside `EditorStack`. */
  children: ReactNode;
}

/**
 * The fixed frame of an editor screen: toolbar (back + title/status + actions),
 * optional banner, then the fields stacked in `EditorStack` with the optional
 * tag picker. Presentational only — autosave, flush, conflict state and routing
 * stay in the app.
 */
export function EditorChrome({
  back,
  title,
  status,
  actions,
  banner,
  tagPicker,
  gap = 'lg',
  children,
}: Readonly<EditorChromeProps>): JSX.Element {
  return (
    <EditorScreen>
      <EditorToolbar back={back} title={title} status={status} actions={actions} />
      {banner}
      <EditorStack gap={gap}>
        {children}
        {tagPicker && (
          <TagPicker
            tags={[...tagPicker.tags]}
            selectedIds={[...tagPicker.selectedIds]}
            onToggle={tagPicker.onToggle}
            label={tagPicker.label}
          />
        )}
      </EditorStack>
    </EditorScreen>
  );
}
