'use client';

import { useEffect, useRef, useState } from 'react';
import { cx } from '../lib/cx';
import { Input } from './input';

export const SEARCH_DEBOUNCE_MS = 300;

export interface SearchFieldProps {
  label: string;
  placeholder: string;
  value?: string;
  onQueryChange: (q: string) => void;
  className?: string;
}

export function SearchField({
  label,
  placeholder,
  value,
  onQueryChange,
  className,
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

  return (
    <div className={cx('ui-search-box', className)}>
      <Input
        type="search"
        placeholder={placeholder}
        aria-label={label}
        value={inner}
        onChange={(event) => setInner(event.target.value)}
      />
    </div>
  );
}
