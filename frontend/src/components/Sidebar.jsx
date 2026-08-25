/**
 * Sidebar - the dark navy navigation rail (blueprint section 28).
 *
 * Its contents come entirely from navigationForUser(), so each role sees only
 * the destinations it can actually use. On small screens it slides in over a
 * scrim; on large screens it is a fixed column.
 */

import { NavLink } from "react-router-dom";
import { navigationForUser } from "../constants/navigation.js";
import { iconFor } from "./icons.js";
import { Droplets, X } from "./icons.js";
import { useAuth } from "../context/AuthContext.jsx";

function BrandMark() {
  return (
    <div className="flex items-center gap-2.5 px-4 py-4">
      <span className="rounded-lg bg-blood-600 p-1.5 text-white">
        <Droplets className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="leading-tight">
        <p className="text-base font-semibold text-white">LifeLink</p>
        <p className="text-[11px] text-navy-100/70">Blood &amp; organ coordination</p>
      </div>
    </div>
  );
}

export default function Sidebar({ mobileOpen, onClose }) {
  const { user } = useAuth();
  const groups = navigationForUser(user);

  const content = (
    <div className="flex h-full flex-col">
      <BrandMark />
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-6 pt-2">
        {groups.map((group, groupIndex) => (
          <div key={group.label || `group-${groupIndex}`}>
            {group.label ? (
              <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-navy-100/50">
                {group.label}
              </p>
            ) : null}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = iconFor(item.icon);
                return (
                  <li key={item.to + item.label}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={onClose}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                          isActive
                            ? "bg-blood-600 text-white"
                            : "text-navy-100/80 hover:bg-navy-700/70 hover:text-white"
                        }`
                      }
                    >
                      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                      <span className="truncate">{item.label}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <p className="border-t border-navy-700/60 px-4 py-3 text-[11px] leading-relaxed text-navy-100/40">
        Academic DBMS project. Fictional data only — not for clinical use.
      </p>
    </div>
  );

  return (
    <>
      {/* Desktop: fixed rail */}
      <aside className="hidden w-64 shrink-0 bg-navy-900 lg:block">{content}</aside>

      {/* Mobile: slide-over */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-30 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/50"
            onClick={onClose}
            aria-hidden="true"
          />
          <aside className="absolute left-0 top-0 h-full w-64 bg-navy-900 shadow-xl">
            <button
              type="button"
              onClick={onClose}
              className="absolute right-2 top-3 rounded p-1.5 text-navy-100/70 hover:bg-navy-700 hover:text-white"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
            {content}
          </aside>
        </div>
      ) : null}
    </>
  );
}
