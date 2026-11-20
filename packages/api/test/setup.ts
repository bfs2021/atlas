import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { server } from "./mocks/server.js";
import { resetMemCache } from "../src/common/cache.js";

// Force every optional integration onto its offline/degraded path so tests never depend on a
// developer's local .env: no Redis (in-memory cache only), no Resend, no Supabase.
for (const key of [
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "RESEND_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CENSUS_API_KEY",
  "BLS_API_KEY",
  "TURNSTILE_SECRET_KEY",
]) {
  delete process.env[key];
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

// Anything a test didn't mock errors out, except loopback: supertest drives the app over a
// real localhost socket, and that request has to reach the app untouched.
// Note: in MSW 3, `defaults.error()` inside a custom callback only *prints* the error — the
// callback has to throw for the request to actually fail instead of passing through.
beforeAll(() =>
  server.listen({
    async onUnhandledFrame({ frame, defaults }) {
      if (frame.protocol === "http") {
        const { hostname } = new URL((frame.data as { request: Request }).request.url);
        if (LOOPBACK_HOSTS.has(hostname)) return;
      }
      await defaults.error();
      throw new Error("Unmocked network request in test (see message above)");
    },
  }),
);
beforeEach(() => resetMemCache());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
