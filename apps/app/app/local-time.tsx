'use client';

import { useEffect, useState } from 'react';

export function LocalTime({ iso }: { iso: string }) {
  const [text, setText] = useState('');
  useEffect(() => {
    setText(new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }));
  }, [iso]);
  return <time dateTime={iso}>{text}</time>;
}
