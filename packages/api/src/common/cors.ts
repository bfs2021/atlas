import type { CorsOptions } from "cors";

// Origins allowed when CORS_ORIGINS is unset (local development only).
export const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://atlas.local",
];

function escapeRegex(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

// An entry is an exact origin ("https://app.example.com") or a pattern where `*` matches a
// run of hostname characters within a single DNS label (never a dot, slash or colon), e.g.
// "https://atlas-*-my-team.vercel.app" for project-scoped Vercel preview deployments.
// A bare "*.vercel.app" is deliberately not special-cased: it would allow every Vercel
// project on the internet, so use a project-scoped pattern instead.
export function parseOrigins(raw: string | undefined): Array<string | RegExp> {
  const entries = (raw ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return entries.map((entry) =>
    entry.includes("*")
      ? new RegExp(`^${entry.split("*").map(escapeRegex).join("[a-z0-9-]*")}$`, "i")
      : entry,
  );
}

export function buildCorsOptions(raw: string | undefined = process.env.CORS_ORIGINS): CorsOptions {
  const configured = parseOrigins(raw);
  if (configured.length === 0) {
    console.warn("CORS_ORIGINS is not set; allowing local development origins only.");
  }
  const allowed = configured.length > 0 ? configured : DEV_ORIGINS;
  return {
    // Requests with no Origin header (curl, server-to-server, health checks) aren't
    // browser cross-origin requests; cors passes them through regardless.
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      const ok = allowed.some((a) => (typeof a === "string" ? a === origin : a.test(origin)));
      // Disallowed origins get no CORS headers (the browser blocks the response) rather than an error.
      callback(null, ok);
    },
  };
}
