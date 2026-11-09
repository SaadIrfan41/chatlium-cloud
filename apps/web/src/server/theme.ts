import 'server-only';
import { cookies } from 'next/headers';

export const THEME_COOKIE = 'chatlium_theme';
export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

function isTheme(value: string | undefined): value is Theme {
  return THEMES.some((theme) => theme === value);
}

/** The saved appearance preference. `system` follows the operating system's light or dark setting. */
export async function currentTheme(): Promise<Theme> {
  const saved = (await cookies()).get(THEME_COOKIE)?.value;
  return isTheme(saved) ? saved : 'system';
}
