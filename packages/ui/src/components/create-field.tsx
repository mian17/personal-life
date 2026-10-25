'use client';

import { useState } from 'react';

import { Plus } from 'lucide-react';

import { IconButton } from './icon-button';
import { Input } from './input';

export interface CreateFieldProps {
  /** BEM element owning the field, e.g. `ui-tag-manager__create`. */
  className: string;
  /** Accessible name, also the placeholder. */
  placeholder: string;
  /** Create button label. */
  createLabel: string;
  disabled?: boolean;
  onCreate: (name: string) => void;
}

/**
 * The create field shared by the tag picker and the manager surface: a text input
 * that submits its trimmed value on Enter, beside an add button. It owns the draft
 * so both callers get identical submit semantics — Enter never submits the
 * surrounding form, and a blank draft cannot be created.
 */
export function CreateField({
  className,
  placeholder,
  createLabel,
  disabled = false,
  onCreate,
}: Readonly<CreateFieldProps>) {
  const [draft, setDraft] = useState('');
  const canCreate = draft.trim() !== '';

  const create = () => {
    const name = draft.trim();
    if (name === '') return;
    onCreate(name);
    setDraft('');
  };

  return (
    <div className={className}>
      <Input
        type="text"
        aria-label={placeholder}
        placeholder={placeholder}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            create();
          }
        }}
      />
      <IconButton label={createLabel} disabled={disabled || !canCreate} onClick={create}>
        <Plus size={16} aria-hidden />
      </IconButton>
    </div>
  );
}
