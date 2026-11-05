'use client';

import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ComponentPropsWithRef } from 'react';
import { cx } from '../lib/cx';
import { Input } from './input';

export const SEARCH_DEBOUNCE_MS = 300;

export interface SearchFieldProps {
  label: string;
  placeholder: string;
  value?: string;
  onQueryChange: (q: string) => void;
  className?: string;
  /**
   * Props merged last onto the shell's field, for a caller that owns the text and the keys
   * (`Autosuggest`): `ref`, `onKeyDown`, `role`, `aria-*` and a `value`/`onChange` pair all
   * reach the real `<input>`. Omitted, the shell's own field and its debounced report are
   * the only value path.
   */
  inputProps?: ComponentPropsWithRef<'input'>;
}

/**
 * The revised `.search` (REVISED-DESIGN §8): the shell owns the height, the strong hairline
 * and the focus ring, the inner input owns nothing but its text, and the leading glyph and
 * placeholders sit a tier quieter than what the reader types.
 */
const shellStyles = cx(
  'flex items-center gap-[var(--s2)] h-[var(--tap)] px-[var(--s3)] mt-[var(--s4)]',
  'rounded-[var(--r-md)] border border-line-strong bg-surface text-ink-3',
  'focus-within:outline-solid focus-within:outline-[length:var(--focus-ring)] focus-within:outline-offset-[var(--focus-ring)] focus-within:outline-focus',
);

export function SearchField({
  label,
  placeholder,
  value,
  onQueryChange,
  className,
  inputProps,
}: Readonly<SearchFieldProps>) {
  const [inner, setInner] = useState(value ?? '');
  const lastValue = useRef(value ?? '');
  const lastEmitted = useRef(value ?? '');
  const onQueryChangeRef = useRef(onQueryChange);
  onQueryChangeRef.current = onQueryChange;

  useEffect(() => {
    if (value !== undefined && value !== lastValue.current) {
      lastValue.current = value;
      lastEmitted.current = value;
      setInner(value);
    }
  }, [value]);

  useEffect(() => {
    if (inner === lastEmitted.current) {
      return;
    }
    const timer = setTimeout(() => {
      lastEmitted.current = inner;
      onQueryChangeRef.current(inner);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [inner]);

  // The shell is where the ring belongs, so the input inside it runs `bare`; the clear
  // control stays the browser's own for `type="search"`, so no markup here re-draws it.
  return (
    <div className={cx('ui-search-box', shellStyles, className)}>
      <Search size={18} aria-hidden className="shrink-0" />
      <Input
        type="search"
        variant="bare"
        placeholder={placeholder}
        aria-label={label}
        value={inner}
        onChange={(event) => setInner(event.target.value)}
        {...inputProps}
      />
    </div>
  );
}
