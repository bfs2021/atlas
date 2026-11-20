import { Router } from "express";
import { getCity } from "../cities/cities.service.js";
import { getCityAirQuality } from "./air-quality.service.js";
import { CURRENT_ACS_YEAR } from "../constants.js";
import { cityParams, route } from "../common/validation.js";

const router: Router = Router();

// GET /air-quality/:state/:city
router.get(
  "/:state/:city",
  route({ params: cityParams }, async ({ params }, _req, res) => {
    const resolvedCity = await getCity(params.state, params.city, CURRENT_ACS_YEAR);
    res.json(getCityAirQuality(resolvedCity));
  }),
);

export default router;
