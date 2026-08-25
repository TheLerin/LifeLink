/**
 * FilterBar - declarative filter row above a table.
 *
 * Filters are described as objects and rendered generically:
 *
 *   [{ key: "unit_status", label: "Status", type: "select",
 *      options: BLOOD_UNIT_STATUSES },
 *    { key: "blood_group", label: "Blood group", type: "select",
 *      options: BLOOD_GROUPS }]
 *
 * Only filters the backend actually accepts should be listed - an unknown query
 * parameter is ignored server-side, which silently misleads the user.
 */

import { useEffect, useState } from "react";
import { Filter, RefreshCw, Search, X } from "./icons.js";
import { formatEnum } from "../utils/format.js";
import { useDebouncedValue } from "../hooks/useApi.js";

/** Search input that only fires once typing settles. */
function DebouncedSearch({ label, placeholder, value, onChange }) {
  const [draft, setDraft] = useState(value ?? "");
  const debounced = useDebouncedValue(draft, 350);

  useEffect(() => {
    if ((value ?? "") !== debounced) onChange(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  // Keep in step when filters are reset from outside.
  useEffect(() => {
    if ((value ?? "") === "") setDraft("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <label className="block">
      <span className="ll-label">{label}</span>
      <span className="relative block">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
        <input
          type="search"
          value={draft}
          placeholder={placeholder || "Search…"}
          onChange={(event) => setDraft(event.target.value)}
          className="ll-input pl-8"
        />
      </span>
    </label>
  );
}

export default function FilterBar({
  filters = [],
  values = {},
  onChange,
  onReset,
  onRefresh,
  children,
  className = "",
}) {
  const activeCount = filters.filter(
    (filter) => values[filter.key] !== undefined && values[filter.key] !== "",
  ).length;

  return (
    <div
      className={`border-b border-slate-200 bg-slate-50/70 px-4 py-3 ${className}`}
    >
      <div className="flex flex-wrap items-end gap-3">
        {filters.map((filter) => {
          const value = values[filter.key] ?? "";

          if (filter.type === "search") {
            return (
              <div key={filter.key} className={filter.width || "w-64"}>
                <DebouncedSearch
                  label={filter.label}
                  placeholder={filter.placeholder}
                  value={value}
                  onChange={(next) => onChange(filter.key, next)}
                />
              </div>
            );
          }

          if (filter.type === "select") {
            return (
              <label key={filter.key} className={`block ${filter.width || "w-44"}`}>
                <span className="ll-label">{filter.label}</span>
                <select
                  value={value}
                  onChange={(event) => onChange(filter.key, event.target.value)}
                  className="ll-input"
                >
                  <option value="">{filter.anyLabel || "Any"}</option>
                  {(filter.options || []).map((option) => {
                    const optionValue =
                      typeof option === "object" ? option.value : option;
                    const optionLabel =
                      typeof option === "object"
                        ? option.label
                        : formatEnum(option);
                    return (
                      <option key={optionValue} value={optionValue}>
                        {optionLabel}
                      </option>
                    );
                  })}
                </select>
              </label>
            );
          }

          if (filter.type === "date") {
            return (
              <label key={filter.key} className={`block ${filter.width || "w-44"}`}>
                <span className="ll-label">{filter.label}</span>
                <input
                  type="date"
                  value={value}
                  onChange={(event) => onChange(filter.key, event.target.value)}
                  className="ll-input"
                />
              </label>
            );
          }

          return (
            <label key={filter.key} className={`block ${filter.width || "w-40"}`}>
              <span className="ll-label">{filter.label}</span>
              <input
                type={filter.type === "number" ? "number" : "text"}
                value={value}
                min={filter.min}
                max={filter.max}
                placeholder={filter.placeholder}
                onChange={(event) => onChange(filter.key, event.target.value)}
                className="ll-input"
              />
            </label>
          );
        })}

        {children}

        <div className="ml-auto flex items-center gap-2">
          {activeCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
              <Filter className="h-3.5 w-3.5" aria-hidden="true" />
              {activeCount} active
            </span>
          ) : null}
          {activeCount > 0 && onReset ? (
            <button
              type="button"
              onClick={onReset}
              className="ll-btn-secondary px-2.5 py-1.5 text-xs"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Clear
            </button>
          ) : null}
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              className="ll-btn-secondary px-2.5 py-1.5 text-xs"
              title="Reload from the database"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Refresh
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
