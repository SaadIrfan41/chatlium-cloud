'use client';

import { LogOutIcon, MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useRef, useTransition } from 'react';
import { setTheme } from '@/app/actions';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Theme = 'system' | 'light' | 'dark';

function isTheme(value: unknown): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark';
}

export interface AccountMenuProps {
  readonly email: string;
  /** The session's CSRF token, posted with sign-out (amendments §2). */
  readonly csrf: string;
  readonly theme: Theme;
}

export function AccountMenu({ email, csrf, theme }: AccountMenuProps) {
  const signOutForm = useRef<HTMLFormElement>(null);
  const [, startTransition] = useTransition();
  const initial = email.charAt(0).toUpperCase();

  return (
    <>
      {/* A real form, so sign-out is a POST carrying the CSRF token. */}
      <form ref={signOutForm} action="/api/auth/logout" method="post" hidden>
        <input type="hidden" name="csrf" value={csrf} />
      </form>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-lg"
              className="rounded-full"
              aria-label="Account menu"
            >
              <Avatar>
                <AvatarFallback>{initial}</AvatarFallback>
              </Avatar>
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Signed in as</span>
              <span className="truncate text-sm text-foreground">{email}</span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Appearance
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(value: unknown) => {
                if (isTheme(value)) {
                  startTransition(() => setTheme(value));
                }
              }}
            >
              <DropdownMenuRadioItem value="system">
                <MonitorIcon />
                Match my device
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="light">
                <SunIcon />
                Light
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <MoonIcon />
                Dark
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => signOutForm.current?.requestSubmit()}>
              <LogOutIcon />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
