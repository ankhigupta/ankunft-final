"use client";

import { useEffect } from "react";
import { STORAGE_KEY } from "@/lib/saved-state";

/**
 * Shown instead of a crashed page. Saved data is the most likely thing to leave the app in a state it cannot
 * draw, so the person can clear it from here without opening the browser's developer tools.
 */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  function clearSavedAndRetry() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage blocked: retrying is still worth a go */
    }
    retry();
  }

  return (
    <main className="page" role="alert">
      <section className="callout callout-warn">
        <h2 className="section-title">Something went wrong</h2>
        <p>
          Ankunft could not show this page. Your dates and progress are kept in this browser only, and nothing was
          sent anywhere. You can try again, or clear what is saved here and start fresh.
        </p>
        <div className="confirm-actions">
          <button type="button" className="btn" onClick={() => retry()}>
            Try again
          </button>
          <button type="button" className="btn btn-quiet" onClick={clearSavedAndRetry}>
            Clear saved data and start again
          </button>
        </div>
      </section>
    </main>
  );
}
