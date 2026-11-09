import { LayoutGridIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccountMenu } from '@/components/app/account-menu';
import { Wordmark } from '@/components/app/wordmark';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { getSession } from '@/server/auth/session';
import { currentTheme } from '@/server/theme';

export const metadata: Metadata = { title: 'Home' };

export default async function DashboardPage() {
  const session = await getSession();
  if (session === undefined) {
    redirect('/');
  }
  const theme = await currentTheme();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-8">
          <Wordmark />
          <AccountMenu email={session.email} csrf={session.csrf} theme={theme} />
        </div>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-10 sm:px-8">
        <h1 className="sr-only">Home</h1>
        <Empty className="flex-1 border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayoutGridIcon />
            </EmptyMedia>
            <EmptyTitle>You’re signed in. Workspaces come next.</EmptyTitle>
            <EmptyDescription>
              Once you belong to a workspace, its documents, conversations and hand-offs appear
              here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </main>
    </div>
  );
}
