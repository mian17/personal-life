'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export function SearchBox({ q = '', tag }: { q?: string; tag?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(q);
  const lastQuery = useRef(q);

  useEffect(() => {
    if (q !== lastQuery.current) {
      lastQuery.current = q;
      setValue(q);
    }
  }, [q]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (value === lastQuery.current) {
        return;
      }
      lastQuery.current = value;
      const params = new URLSearchParams();
      if (tag) {
        params.set('tag', tag);
      }
      if (value) {
        params.set('q', value);
      }
      const qs = params.toString();
      router.replace(qs ? `/?${qs}` : '/', { scroll: false });
    }, 300);

    return () => clearTimeout(timer);
  }, [value, tag, router]);

  return (
    <div className="search-box">
      <input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search notes"
        aria-label="Search notes"
      />
    </div>
  );
}
