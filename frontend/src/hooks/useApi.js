/**
 * Data-fetching hooks.
 *
 * Deliberately small and dependency-free (no react-query) so the whole data
 * path stays readable for a viva demonstration. Each hook returns the same
 * shape: { data, error, loading, reload }.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Run an async fetcher and track its state.
 *
 * @param fetcher (signal) => Promise<any>
 * @param deps    dependency list; the fetcher re-runs when these change
 * @param options.enabled  skip the call entirely when false
 * @param options.initialData  value to show before the first response
 */
export function useApi(fetcher, deps = [], options = {}) {
  const { enabled = true, initialData = null } = options;

  const [data, setData] = useState(initialData);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const [nonce, setNonce] = useState(0);

  // Keep the latest fetcher without making it a dependency, so callers can
  // pass an inline arrow function without causing an infinite loop.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    let cancelled = false;

    setLoading(true);
    setError(null);

    Promise.resolve()
      .then(() => fetcherRef.current(controller.signal))
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((cause) => {
        if (cancelled || cause?.name === "AbortError") return;
        setError(cause);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, nonce, ...deps]);

  return { data, error, loading, reload, setData };
}

/**
 * Paged list state: owns page, page size and filters, and refetches when any
 * of them change. Handles both list envelopes the backend returns - the plain
 * `{items,page,page_size,total}` and the donor/user variant that also sends
 * `total_pages`.
 */
export function usePagedList(fetcher, options = {}) {
  const { initialFilters = {}, pageSize: initialPageSize = 20, enabled = true } =
    options;

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [filters, setFilters] = useState(initialFilters);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // Stable primitive key so object identity churn doesn't retrigger fetches.
  const filterKey = JSON.stringify(filters);

  const { data, error, loading, reload } = useApi(
    (signal) =>
      fetcherRef.current({ page, page_size: pageSize, ...filters }, signal),
    [page, pageSize, filterKey],
    { enabled },
  );

  const items = useMemo(() => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return Array.isArray(data.items) ? data.items : [];
  }, [data]);

  const total = data && typeof data.total === "number" ? data.total : items.length;
  const totalPages =
    data && typeof data.total_pages === "number"
      ? data.total_pages
      : Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  /** Replace one filter and jump back to page 1 - otherwise you can land on
   *  an empty page that no longer exists in the narrower result set. */
  const setFilter = useCallback((key, value) => {
    setFilters((current) => {
      const next = { ...current };
      if (value === "" || value === null || value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
    setPage(1);
  }, []);

  const replaceFilters = useCallback((next) => {
    setFilters(next);
    setPage(1);
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(initialFilters);
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initialFilters)]);

  return {
    items,
    total,
    totalPages,
    page,
    pageSize,
    filters,
    error,
    loading,
    setPage,
    setPageSize: (size) => {
      setPageSize(size);
      setPage(1);
    },
    setFilter,
    replaceFilters,
    resetFilters,
    reload,
    isEmpty: !loading && !error && items.length === 0,
  };
}

/**
 * Track a mutation (POST/PATCH) so buttons can disable and show progress.
 * Returns { run, pending, error, reset }.
 */
export function useMutation(mutator) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const mutatorRef = useRef(mutator);
  mutatorRef.current = mutator;

  const run = useCallback(async (...args) => {
    setPending(true);
    setError(null);
    try {
      return await mutatorRef.current(...args);
    } catch (cause) {
      setError(cause);
      throw cause;
    } finally {
      setPending(false);
    }
  }, []);

  const reset = useCallback(() => setError(null), []);

  return { run, pending, error, reset };
}

/** Debounce a value - used for search boxes so we don't fetch per keystroke. */
export function useDebouncedValue(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
