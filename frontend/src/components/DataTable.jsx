/**
 * DataTable - the one table used by every list screen.
 *
 * Columns are declared as objects so a list page is mostly configuration:
 *
 *   const columns = [
 *     { key: "unit_id", header: "Unit", width: "w-24" },
 *     { key: "unit_status", header: "Status",
 *       render: (row) => <StatusBadge value={row.unit_status} /> },
 *   ];
 *
 * Supports row click-through, an actions column, and a horizontal scroll on
 * narrow viewports rather than crushing the columns.
 */

import { DASH } from "../utils/format.js";
import { AsyncPanel, TableSkeleton } from "./States.jsx";

function cellValue(row, column) {
  if (typeof column.render === "function") return column.render(row);
  const raw = column.accessor
    ? column.accessor(row)
    : row?.[column.key];
  if (raw === null || raw === undefined || raw === "") return DASH;
  return raw;
}

export default function DataTable({
  columns,
  rows,
  rowKey = (row, index) => row?.id ?? index,
  loading = false,
  error = null,
  onRetry,
  onRowClick,
  emptyTitle = "No records found",
  emptyMessage = "Try widening your filters, or add the first record.",
  emptyIcon,
  emptyAction,
  footer,
  className = "",
}) {
  const isEmpty = !loading && !error && (!rows || rows.length === 0);

  return (
    <div className={className}>
      <AsyncPanel
        loading={loading}
        error={error}
        isEmpty={isEmpty}
        onRetry={onRetry}
        loadingFallback={<TableSkeleton columns={columns.length} />}
        emptyTitle={emptyTitle}
        emptyMessage={emptyMessage}
        emptyIcon={emptyIcon}
        emptyAction={emptyAction}
      >
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={`ll-th ${column.headerClassName || ""} ${
                      column.align === "right" ? "text-right" : ""
                    }`}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {(rows || []).map((row, index) => {
                const clickable = typeof onRowClick === "function";
                return (
                  <tr
                    key={rowKey(row, index)}
                    onClick={clickable ? () => onRowClick(row) : undefined}
                    onKeyDown={
                      clickable
                        ? (event) => {
                            if (event.key === "Enter") onRowClick(row);
                          }
                        : undefined
                    }
                    tabIndex={clickable ? 0 : undefined}
                    className={
                      clickable
                        ? "cursor-pointer transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                        : "transition-colors hover:bg-slate-50/60"
                    }
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={`ll-td ${column.className || ""} ${
                          column.align === "right" ? "text-right" : ""
                        }`}
                        // Stop an action button inside a row from also
                        // triggering the row's navigation.
                        onClick={
                          column.stopPropagation
                            ? (event) => event.stopPropagation()
                            : undefined
                        }
                      >
                        {cellValue(row, column)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </AsyncPanel>
      {footer}
    </div>
  );
}
