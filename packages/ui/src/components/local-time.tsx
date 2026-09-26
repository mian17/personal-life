'use client';

import { useEffect, useState } from 'react';
import type { ComponentPropsWithRef } from 'react';

export interface LocalTimeProps extends Omit<ComponentPropsWithRef<'time'>, 'dateTime' | 'children'> {
  dateTime: string;
}

export function LocalTime({ dateTime, className, ...rest }: LocalTimeProps) {
  const [text, setText] = useState('');

  useEffect(() => {
    setText(new Date(dateTime).toLocaleDateString(undefined, { dateStyle: 'medium' }));
  }, [dateTime]);

  return (
    <time dateTime={dateTime} className={className} {...rest}>
      {text}
    </time>
  );
}
