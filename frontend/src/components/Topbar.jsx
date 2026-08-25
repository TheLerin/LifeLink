/**
 * Topbar - the light header above the content area.
 *
 * Shows who is signed in and under which role, because almost every
 * demonstration step in the blueprint depends on knowing the active role. The
 * facility name is shown too, since blood/organ bank staff are scoped to one
 * facility by the backend.
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { ROLE_LABELS } from "../constants/lifelink.js";
import { ChevronDown, LogOut, Menu, ShieldCheck, UserRound } from "./icons.js";
import { formatDateTime, initials } from "../utils/format.js";

export default function Topbar({ onOpenMenu }) {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Close the account menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return undefined;
    function onPointerDown(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }
    function onKeyDown(event) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  if (!user) return null;

  const facility = user.blood_bank_name || user.organ_bank_name || null;

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:px-6">
      <button
        type="button"
        onClick={onOpenMenu}
        className="rounded-md p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-slate-500">
          Signed in as{" "}
          <span className="font-semibold text-slate-800">
            {user.full_name || user.username}
          </span>
          {facility ? <span className="text-slate-400"> · {facility}</span> : null}
        </p>
      </div>

      <span className="hidden items-center gap-1.5 rounded-full bg-navy-50 px-2.5 py-1 text-xs font-semibold text-navy-800 ring-1 ring-inset ring-navy-100 sm:inline-flex">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
        {ROLE_LABELS[user.role] || user.role}
      </span>

      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          className="flex items-center gap-2 rounded-md p-1 pr-2 hover:bg-slate-100"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-800 text-xs font-semibold text-white">
            {initials(user.full_name || user.username)}
          </span>
          <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden="true" />
        </button>

        {menuOpen ? (
          <div
            role="menu"
            className="absolute right-0 mt-2 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
          >
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-semibold text-slate-800">
                {user.full_name || user.username}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {user.username} · {ROLE_LABELS[user.role] || user.role}
              </p>
              {user.last_login_at ? (
                <p className="mt-1.5 text-xs text-slate-400">
                  Last sign-in {formatDateTime(user.last_login_at)}
                </p>
              ) : null}
            </div>

            <Link
              to="/account"
              onClick={() => setMenuOpen(false)}
              role="menuitem"
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              <UserRound className="h-4 w-4 text-slate-400" aria-hidden="true" />
              Account details
            </Link>

            <button
              type="button"
              onClick={logout}
              role="menuitem"
              className="flex w-full items-center gap-2.5 border-t border-slate-100 px-4 py-2.5 text-sm text-red-700 hover:bg-red-50"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
