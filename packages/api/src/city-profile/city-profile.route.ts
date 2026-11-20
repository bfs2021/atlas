import { Router } from "express";
import { getCity } from "../cities/cities.service.js";
import { CURRENT_ACS_YEAR } from "../constants.js";
import { getCityProfileDetails, getCityProfileSummary } from "./city-profile.service.js";
import { cityParams, route } from "../common/validation.js";

const router: Router = Router();

router.get(
  "/:state/:city",
  route({ params: cityParams }, async ({ params }, _req, res) => {
    const resolvedCity = await getCity(params.state, params.city, CURRENT_ACS_YEAR);
    res.json(await getCityProfileSummary(resolvedCity, CURRENT_ACS_YEAR));
  }),
);

router.get(
  "/:state/:city/details",
  route({ params: cityParams }, async ({ params }, _req, res) => {
    const resolvedCity = await getCity(params.state, params.city, CURRENT_ACS_YEAR);
    res.json(await getCityProfileDetails(resolvedCity, CURRENT_ACS_YEAR));
  }),
);

export default router;
