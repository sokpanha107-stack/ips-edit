'use client';
import { useId } from 'react';

/** Atom Edit brand mark (the lamp icon). Shared by the splash, header and Atom Assistant. */
export function LogoMark({ className, size = 132 }: { className?: string; size?: number }) {
  const gid = `atom-logo-${useId().replace(/:/g, '')}`;
  const shape = 'M13.5 .5H28.5A13 13 0 0 1 41.5 13.5V28.5A13 13 0 0 1 28.5 41.5H4.5A4 4 0 0 1 .5 37.5V13.5A13 13 0 0 1 13.5 .5Z';
  return <svg className={className} viewBox="0 0 45 45" width={size} height={size} role="img" aria-label="Atom Edit"><defs><linearGradient id={gid} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e2a047" /><stop offset="1" stopColor="#d97706" /></linearGradient></defs><path transform="translate(3 3)" fill="var(--ink)" d={shape} /><path fill={`url(#${gid})`} stroke="var(--ink)" strokeWidth="1" d={shape} /><g transform="translate(8.5 8.5) scale(1.0416667)" fill="none" stroke="var(--ink)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m14 5-3 3 2 7 8-8-7-2Z" /><path d="m14 5-3 3-3-3 3-3 3 3Z" /><path d="M9.5 6.5 4 12l3 6" /><path d="M3 22v-2c0-1.1.9-2 2-2h4a2 2 0 0 1 2 2v2H3Z" /></g><path fill="var(--ink)" d="M8.6 25.4 11.9 23.6V31.1Q11.9 31.6 12.7 31.6H13.5V32.8H7.6V31.6H8.4Q9.2 31.6 9.2 31.1V25.7Z" /></svg>;
}
