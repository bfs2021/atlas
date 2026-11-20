import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { STATE_FIPS } from "../states/states.types.js";
import { INDUSTRY_LABELS } from "../income-by-industry/soc-mapping.js";
import { CURRENT_ACS_YEAR } from "../constants.js";

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

// Two-letter state code, case-insensitive, normalized to uppercase. Must be a state the API
// has FIPS data for.
export const stateCode = z
  .string()
  .trim()
  .toUpperCase()
  .refine((code) => Object.hasOwn(STATE_FIPS, code), { message: "Unsupported state" });

// City slugs are produced by slugify() in place-resolver.ts: lowercase a-z/0-9 words joined by
// single hyphens. Normalized to lowercase so "Oakland" still resolves like "oakland".
export const citySlug = z
  .string()
  .trim()
  .toLowerCase()
  .max(100, "City slug is too long")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid city slug");

export const cityParams = z.object({ state: stateCode, city: citySlug });

export const industryKey = z
  .string()
  .refine((key) => Object.hasOwn(INDUSTRY_LABELS, key), { message: "Unknown industry" });

// ACS 5-year estimates start in 2009.
const yearMessage = `Year must be a whole number from 2009 to ${CURRENT_ACS_YEAR}`;
export const acsYear = z.coerce
  .number({ error: yearMessage })
  .int(yearMessage)
  .min(2009, yearMessage)
  .max(CURRENT_ACS_YEAR, yearMessage);

// Admin metrics/cache prefixes, e.g. "open-meteo", "income-details", or a narrower cache-key
// prefix like "city:2024:CA:".
export const keyPrefix = z
  .string()
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/, "Invalid prefix");

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

// ---------------------------------------------------------------------------
// route(): validation + async error forwarding for Express 4 handlers
// ---------------------------------------------------------------------------

type Schemas = {
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
};

type Output<S> = S extends z.ZodType ? z.output<S> : Record<string, never>;

export type RouteInput<S extends Schemas> = {
  params: Output<S["params"]>;
  query: Output<S["query"]>;
  body: Output<S["body"]>;
};

export type ValidationIssue = {
  location: "params" | "query" | "body";
  path: string;
  message: string;
};

// Wraps a route handler so that:
//  1. params/query/body are validated before any service (or upstream API) is touched;
//     failures return 400 { error, issues } and the handler never runs.
//  2. the handler receives the parsed, normalized values (e.g. uppercased state).
//  3. thrown errors and rejected promises go to the shared error handler. Express 4 doesn't
//     catch async errors itself: an uncaught rejection leaves the request hanging and, under
//     Node's default unhandled-rejection behavior, takes the whole process down.
export function route<S extends Schemas>(
  schemas: S,
  handler: (input: RouteInput<S>, req: Request, res: Response) => unknown,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const input: Record<string, unknown> = { params: {}, query: {}, body: {} };
    const issues: ValidationIssue[] = [];

    for (const location of ["params", "query", "body"] as const) {
      const schema = schemas[location];
      if (!schema) continue;
      const result = schema.safeParse(req[location] ?? {});
      if (result.success) {
        input[location] = result.data;
      } else {
        for (const issue of result.error.issues) {
          issues.push({ location, path: issue.path.join("."), message: issue.message });
        }
      }
    }

    if (issues.length > 0) {
      res.status(400).json({ error: issues[0]!.message, issues });
      return;
    }

    try {
      await handler(input as RouteInput<S>, req, res);
    } catch (err) {
      next(err);
    }
  };
}
