import { Router } from "express";
import { z } from "zod";
import { getCity } from "../cities/cities.service.js";
import { getCityAffordability, getDetailedCityAffordability } from "./affordability.service.js";
import { CURRENT_ACS_YEAR } from "../constants.js";
import { acsYear, cityParams, route } from "../common/validation.js";

const router: Router = Router();

const affordabilityQuery = z.object({ year: acsYear.default(CURRENT_ACS_YEAR) });

router.get(
  "/:state/:city",
  route({ params: cityParams, query: affordabilityQuery }, async ({ params, query }, _req, res) => {
    const cityData = await getCity(params.state, params.city, query.year);
    res.json(await getCityAffordability(cityData, query.year));
  }),
);

router.get(
  "/:state/:city/details",
  route({ params: cityParams, query: affordabilityQuery }, async ({ params, query }, _req, res) => {
    const cityData = await getCity(params.state, params.city, query.year);
    res.json(await getDetailedCityAffordability(cityData, query.year));
  }),
);

export default router;
