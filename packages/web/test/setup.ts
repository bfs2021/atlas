import { vi } from "vitest";

// atlasScore.ts imports helpers from composables/usePreferences.ts, which imports the Supabase
// client and useAuth at module load. Those create a real client from VITE_SUPABASE_* env vars and
// kick off a session fetch as a side effect, so stub them out: the lib tests only exercise pure
// scoring/formatting code and must never touch Supabase.
vi.mock("../src/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: () => {
      throw new Error("Supabase is not available in unit tests");
    },
  },
}));
