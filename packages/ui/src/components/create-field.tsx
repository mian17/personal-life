'use client';

import { useState } from 'react';
import type { KeyboardEvent } from 'react';

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
 *
 * The row layout is the caller's own BEM element, so both owners keep the spacing
 * their surface already had; this component contributes no visual CSS.
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

  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    create();
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
        onKeyDown={submitOnEnter}
      />
      <IconButton label={createLabel} disabled={disabled || !canCreate} onClick={create}>
        <Plus size={16} aria-hidden />
      </IconButton>
    </div>
  );
}
