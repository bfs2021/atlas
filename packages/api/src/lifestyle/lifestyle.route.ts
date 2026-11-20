import { Router } from "express";
import { getCity } from "../cities/cities.service.js";
import { getCityLifestyle } from "./lifestyle.service.js";
import { CURRENT_ACS_YEAR } from "../constants.js";
import { cityParams, route } from "../common/validation.js";

const router: Router = Router();

// GET /lifestyle/:state/:city
router.get(
  "/:state/:city",
  route({ params: cityParams }, async ({ params }, _req, res) => {
    const resolvedCity = await getCity(params.state, params.city, CURRENT_ACS_YEAR);
    res.json(await getCityLifestyle(resolvedCity));
  }),
);

export default router;
