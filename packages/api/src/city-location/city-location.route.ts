import { Router } from "express";
import { z } from "zod";
import { getCityLocation, getMajorCitiesInState } from "./city-location.service.js";
import { cityParams, citySlug, route, stateCode } from "../common/validation.js";

const router: Router = Router();

// Must come before the generic "/:state/:city" route below, or "major-cities" would be
// swallowed as a (nonexistent) city slug.
router.get(
  "/:state/major-cities/:excludeSlug",
  route(
    {
      params: z.object({ state: stateCode, excludeSlug: citySlug }),
      query: z.object({ limit: z.coerce.number().int().min(1).max(30).default(8) }),
    },
    async ({ params, query }, _req, res) => {
      res.json(await getMajorCitiesInState(params.state, params.excludeSlug, query.limit));
    },
  ),
);

router.get(
  "/:state/:city",
  route({ params: cityParams }, async ({ params }, _req, res) => {
    res.json(await getCityLocation(params.state, params.city));
  }),
);

export default router;
