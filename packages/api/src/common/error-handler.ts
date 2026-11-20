import type { ErrorRequestHandler } from "express";
import { HttpError } from "./errors.js";

const GENERIC_MESSAGES: Record<number, string> = {
  502: "An upstream data source is unavailable. Please try again later.",
};

// Single place that turns a thrown error into a response. Routes built with route() (see
// validation.ts) forward every error here, so status codes are consistent across the API and
// internal details (stack traces, upstream response bodies) never reach the client.
// The request URL is caller-controlled, so it's passed as an argument to a constant format
// string, never as the format string itself (a "%o" in the URL would otherwise consume the
// next argument and garble or forge the log line).
function logError(method: string, url: string, err: unknown): void {
  console.error("[%s %s]", method, url, err);
}

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof HttpError) {
    if (err.status >= 500) logError(req.method, req.originalUrl, err);
    res.status(err.status).json({
      error: err.expose ? err.message : (GENERIC_MESSAGES[err.status] ?? "Internal server error"),
    });
    return;
  }

  // Errors raised by Express middleware itself, e.g. express.json() on a malformed body
  // (status 400, type "entity.parse.failed") or an oversized one (413).
  const status = (err as { status?: unknown })?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    res.status(status).json({ error: "Invalid request body" });
    return;
  }

  logError(req.method, req.originalUrl, err);
  res.status(500).json({ error: "Internal server error" });
};
