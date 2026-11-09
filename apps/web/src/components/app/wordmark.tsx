import { cn } from '@/lib/utils';

/**
 * The Chatlium mark: a speech bubble whose tail splits in two, for the two ways a conversation
 * goes: answered by the AI (teal), or handed to a person (amber).
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-foreground', className)}>
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden="true" focusable="false">
        <rect x="3" y="4" width="26" height="18" rx="7" className="fill-primary" />
        <path d="M10 22 L9 29 L16 22 Z" className="fill-primary" />
        <path d="M19 22 L24 28 L23 22 Z" className="fill-handoff-foreground" />
        <circle cx="11" cy="13" r="1.8" className="fill-primary-foreground" />
        <circle cx="16" cy="13" r="1.8" className="fill-primary-foreground" />
        <circle cx="21" cy="13" r="1.8" className="fill-primary-foreground" />
      </svg>
      <span className="text-lg font-semibold tracking-tight [font-stretch:87.5%]">Chatlium</span>
    </span>
  );
}
