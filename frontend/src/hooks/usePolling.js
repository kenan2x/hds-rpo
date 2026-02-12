import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * usePolling - Auto-refresh hook for periodic data fetching.
 *
 * Calls fetchFn immediately on mount, then repeats on the given interval.
 * Pauses when enabled is false. Cleans up on unmount.
 *
 * @param {() => Promise<any>} fetchFn - Async function that returns data
 * @param {number} intervalMs - Polling interval in milliseconds (default: 300000 = 5 min)
 * @param {boolean} enabled - Whether polling is active (default: true)
 * @returns {{ data: any, loading: boolean, error: Error|null, lastUpdated: Date|null, refresh: () => void }}
 */
export function usePolling(fetchFn, intervalMs = 300000, enabled = true) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const intervalRef = useRef(null);
  const fetchFnRef = useRef(fetchFn);
  const mountedRef = useRef(true);

  // Keep fetchFn ref current without triggering re-effects
  useEffect(() => {
    fetchFnRef.current = fetchFn;
  }, [fetchFn]);

  const execute = useCallback(async () => {
    if (!mountedRef.current) return;

    setLoading(true);
    setError(null);

    try {
      const result = await fetchFnRef.current();
      if (mountedRef.current) {
        setData(result);
        setLastUpdated(new Date());
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err);
        // Do not clear existing data on error - show stale data
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // Initial fetch + interval setup
  useEffect(() => {
    mountedRef.current = true;

    if (!enabled) {
      // Clear any existing interval when disabled
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Fetch immediately
    execute();

    // Set up polling interval
    intervalRef.current = setInterval(execute, intervalMs);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [execute, intervalMs, enabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  // Manual refresh function
  const refresh = useCallback(() => {
    execute();
  }, [execute]);

  return { data, loading, error, lastUpdated, refresh };
}

export default usePolling;
