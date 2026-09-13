'use client';

import { useEffect, useState } from 'react';

export function LocalTime({ iso }: { iso: string }) {
  const [text, setText] = useState('');
  useEffect(() => {
    setText(new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
  }, [iso]);
  return <time dateTime={iso}>{text}</time>;
}
