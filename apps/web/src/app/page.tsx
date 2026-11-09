import { AlertCircleIcon } from 'lucide-react';
import { redirect } from 'next/navigation';
import { ConversationPreview } from '@/components/app/conversation-preview';
import { Wordmark } from '@/components/app/wordmark';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { getSession } from '@/server/auth/session';

const SIGN_IN_PROBLEMS = {
  expired: {
    title: 'Your sign-in timed out',
    detail: 'Sign-in links last 10 minutes. Start again to get a new one.',
  },
  cancelled: {
    title: 'Sign-in was cancelled',
    detail: 'Nothing was changed. Sign in again whenever you’re ready.',
  },
  failed: {
    title: 'We couldn’t sign you in',
    detail: 'Try again. If it keeps happening, ask your workspace admin to check your account.',
  },
} as const;

function isProblem(value: unknown): value is keyof typeof SIGN_IN_PROBLEMS {
  return typeof value === 'string' && Object.hasOwn(SIGN_IN_PROBLEMS, value);
}

export default async function SignInPage({ searchParams }: PageProps<'/'>) {
  if ((await getSession()) !== undefined) {
    redirect('/dashboard');
  }
  const { signin } = await searchParams;
  const problem = isProblem(signin) ? SIGN_IN_PROBLEMS[signin] : undefined;

  return (
    <main
      id="main"
      className="mx-auto grid min-h-dvh w-full max-w-6xl items-center gap-12 px-4 py-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16"
    >
      <section aria-labelledby="sign-in-heading" className="flex max-w-xl flex-col gap-8">
        <Wordmark />
        <div className="flex flex-col gap-5">
          <h1
            id="sign-in-heading"
            className="text-4xl leading-[1.05] font-semibold tracking-tight text-balance [font-stretch:75%] sm:text-5xl lg:text-6xl"
          >
            Answers from your documents. A person when they aren’t enough.
          </h1>
          <p className="max-w-prose text-lg leading-relaxed text-pretty text-muted-foreground">
            Chatlium answers your website visitors from the documents you upload, and hands the
            conversation to your team when no document covers the question.
          </p>
        </div>

        {problem === undefined ? null : (
          <Alert variant="destructive" role="alert">
            <AlertCircleIcon />
            <AlertTitle>{problem.title}</AlertTitle>
            <AlertDescription>{problem.detail}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-3">
          <a
            href="/api/auth/login"
            className={buttonVariants({ size: 'lg', className: 'w-fit px-5' })}
          >
            Sign in
          </a>
          <p className="text-sm text-muted-foreground">
            Use the account your workspace admin set up for you.
          </p>
        </div>
      </section>

      <ConversationPreview />
    </main>
  );
}
