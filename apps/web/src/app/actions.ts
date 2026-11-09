'use server';

import { cookies } from 'next/headers';
import { THEME_COOKIE, THEMES, type Theme } from '@/server/theme';

/** Saves the appearance preference for a year. Not sensitive, so not sealed. */
export async function setTheme(theme: Theme): Promise<void> {
  if (!THEMES.includes(theme)) {
    return;
  }
  (await cookies()).set(THEME_COOKIE, theme, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
}
