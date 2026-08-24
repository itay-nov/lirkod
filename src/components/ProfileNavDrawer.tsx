"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { showsInstructorTools, type UserRole } from "@/lib/domain/role";
import { he } from "@/lib/i18n/he";

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useDrawerFocusTrap({
  open,
  drawerRef,
  close,
}: {
  open: boolean;
  drawerRef: RefObject<HTMLDivElement | null>;
  close: () => void;
}) {
  useEffect(() => {
    if (!open) return;

    const drawer = drawerRef.current;
    const first = drawer?.querySelector<HTMLElement>(FOCUSABLE);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    first?.focus();

    function keepFocusInside(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }

      if (event.key !== "Tab" || drawer === null) return;

      const focusable = [...drawer.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const firstItem = focusable[0];
      const lastItem = focusable.at(-1);
      if (firstItem === undefined || lastItem === undefined) return;

      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    }

    document.addEventListener("keydown", keepFocusInside);
    return () => {
      document.removeEventListener("keydown", keepFocusInside);
      document.body.style.overflow = previousOverflow;
    };
  }, [close, drawerRef, open]);
}

/**
 * Quick navigation for the signed-in personal area.
 *
 * `role` is the server-derived result of `roleFor()`, not client state. It only
 * decides whether to draw the create link; the database remains the boundary
 * for every instructor write, just as it is for the form itself.
 */
export function ProfileNavDrawer({ role }: { role: UserRole }) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const closeAndRestoreFocus = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => openerRef.current?.focus());
  }, []);

  useDrawerFocusTrap({ open, drawerRef, close: closeAndRestoreFocus });

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        aria-label={he.profileMenu.open}
        aria-expanded={open}
        aria-controls="profile-navigation-drawer"
        onClick={() => setOpen(true)}
        className="absolute end-4 top-4 flex size-12 items-center justify-center rounded-full border-2 border-secondary bg-surface text-secondary shadow-sm focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <path d="M4 6h16" />
          <path d="M4 12h16" />
          <path d="M4 18h16" />
        </svg>
      </button>

      {open ? (
        <Drawer
          role={role}
          drawerRef={drawerRef}
          close={closeAndRestoreFocus}
          onNavigate={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function Drawer({
  role,
  drawerRef,
  close,
  onNavigate,
}: {
  role: UserRole;
  drawerRef: RefObject<HTMLDivElement | null>;
  close: () => void;
  onNavigate: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-ink/45"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={drawerRef}
        id="profile-navigation-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-navigation-title"
        className="absolute inset-block-0 end-0 flex w-[min(22rem,calc(100%-2rem))] flex-col overflow-y-auto border-s-4 border-highlight bg-surface p-4 shadow-2xl"
      >
        <div className="flex min-h-12 items-center justify-between gap-3">
          <h2 id="profile-navigation-title" className="font-display text-2xl font-black">
            {he.profileMenu.title}
          </h2>
          <button
            type="button"
            aria-label={he.profileMenu.close}
            onClick={close}
            className="flex size-12 shrink-0 items-center justify-center rounded-full border-2 border-secondary text-2xl font-bold text-secondary focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <DrawerNavigation role={role} onNavigate={onNavigate} />
      </div>
    </div>
  );
}

function DrawerNavigation({
  role,
  onNavigate,
}: {
  role: UserRole;
  onNavigate: () => void;
}) {
  return (
    <nav aria-label={he.profileMenu.navigationLabel} className="pt-6">
      <ul className="flex flex-col gap-3">
        <li>
          <DrawerLink href="/" onNavigate={onNavigate}>
            {he.profileMenu.home}
          </DrawerLink>
        </li>
        <li>
          <DrawerLink href="/profile" onNavigate={onNavigate}>
            {he.profileMenu.myDances}
          </DrawerLink>
        </li>
        {showsInstructorTools(role) ? (
          <li>
            <DrawerLink href="/profile#create-dance" onNavigate={onNavigate}>
              {he.profileMenu.createDance}
            </DrawerLink>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}

function DrawerLink({
  href,
  onNavigate,
  children,
}: {
  href: string;
  onNavigate: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="flex min-h-12 items-center rounded-2xl border-2 border-muted/50 bg-surface px-4 py-3 font-display text-xl font-bold text-ink focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary"
    >
      {children}
    </Link>
  );
}
