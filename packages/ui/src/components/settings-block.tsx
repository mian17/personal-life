import type { ReactNode } from 'react';
import { Card } from './card';
import { Section } from './section';
import { Stack } from './stack';

export interface SettingsBlockProps {
  /** Group heading; omitted renders no heading row. */
  title?: string;
  /** The `SettingsRow`s (or any content) in render order. */
  children: ReactNode;
  /** Class passthrough. */
  className?: string;
}

export function SettingsBlock({ title, children, className }: Readonly<SettingsBlockProps>) {
  return (
    <Section label={title} gap="sm" className={className}>
      <Card>
        <Stack gap="sm">{children}</Stack>
      </Card>
    </Section>
  );
}
