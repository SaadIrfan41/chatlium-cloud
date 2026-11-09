import type { Metadata, Viewport } from 'next';
import { Instrument_Sans } from 'next/font/google';
import { cn } from '@/lib/utils';
import { currentTheme } from '@/server/theme';
import './globals.css';

/** One family; headlines use its narrower widths (wdth axis), body text the normal width. */
const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Chatlium', template: '%s | Chatlium' },
  description: 'Answers for your website visitors, drawn from your own documents.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f3f6f8' },
    { media: '(prefers-color-scheme: dark)', color: '#0e151b' },
  ],
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const theme = await currentTheme();
  return (
    <html
      lang="en"
      className={cn(instrumentSans.variable, 'font-sans antialiased', theme !== 'system' && theme)}
    >
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
