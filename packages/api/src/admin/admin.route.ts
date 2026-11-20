import { Router } from "express";
import { clearCache } from "../common/cache.js";
import { getCallCount } from "../common/metrics.js";
import { z } from "zod";
import { isoDate, keyPrefix, route } from "../common/validation.js";

const router: Router = Router();

// GET /admin/metrics/calls/:prefix — daily call count for an external API (e.g. "open-meteo", "fema-nri")
// optional ?date=YYYY-MM-DD, defaults to today (UTC)
router.get(
  "/metrics/calls/:prefix",
  route(
    { params: z.object({ prefix: keyPrefix }), query: z.object({ date: isoDate.optional() }) },
    async ({ params, query }, _req, res) => {
      const count = await getCallCount(params.prefix, query.date);
      res.json({ prefix: params.prefix, date: query.date ?? new Date().toISOString().slice(0, 10), count });
    },
  ),
);

// DELETE /admin/cache          — clear everything
// DELETE /admin/cache/:prefix  — clear by prefix (e.g. "climate", "city", "profile", "income")
router.delete(
  "/cache/:prefix?",
  route({ params: z.object({ prefix: keyPrefix.optional() }) }, async ({ params }, _req, res) => {
    const result = await clearCache(params.prefix);
    res.json({
      cleared: true,
      prefix: params.prefix ?? "(all)",
      ...result,
    });
  }),
);

// GET /admin/cache/prefixes — list available prefixes as a reminder
router.get("/cache/prefixes", (_req, res) => {
  res.json({
    prefixes: [
      "city",
      "resolved-places",
      "state-cities",
      "climate",
      "profile",
      "profile-details",
      "income",
      "income-details",
      "housing",
      "housing-details",
      "affordability",
      "affordability-details",
      "financial",
      "financial-details",
      "qol",
      "qol-details",
      "education",
      "location",
      "lifestyle",
      "photo",
      "income-by-industry",
      "income-by-industry-msa",
    ],
    usage: "DELETE /admin/cache/:prefix  or  DELETE /admin/cache  (clears all)",
  });
});

export default router;
