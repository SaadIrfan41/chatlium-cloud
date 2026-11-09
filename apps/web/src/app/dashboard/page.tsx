import { listUserWorkspaces } from '@chatlium/db';
import { LayoutGridIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccountMenu } from '@/components/app/account-menu';
import { Wordmark } from '@/components/app/wordmark';
import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { getSession } from '@/server/auth/session';
import { db } from '@/server/db';
import { currentTheme } from '@/server/theme';

export const metadata: Metadata = { title: 'Home' };

const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', operator: 'Operator' } as const;

export default async function DashboardPage() {
  const session = await getSession();
  if (session === undefined) {
    redirect('/');
  }
  const [theme, workspaces] = await Promise.all([
    currentTheme(),
    listUserWorkspaces(db(), session.userId),
  ]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-8">
          <Wordmark />
          <AccountMenu email={session.email} csrf={session.csrf} theme={theme} />
        </div>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-10 sm:px-8">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Your workspaces</h1>
        {workspaces.length === 0 ? (
          <Empty className="flex-1 border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LayoutGridIcon />
              </EmptyMedia>
              <EmptyTitle>You’re not in a workspace yet</EmptyTitle>
              <EmptyDescription>
                Ask a workspace owner to add you. Its documents, conversations and hand-offs then
                appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((workspace) => (
              <li key={workspace.id}>
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <h2>{workspace.name}</h2>
                    </CardTitle>
                    <CardAction>
                      <Badge variant="secondary">{ROLE_LABELS[workspace.role]}</Badge>
                    </CardAction>
                  </CardHeader>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
