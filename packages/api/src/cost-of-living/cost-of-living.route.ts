import { Router } from "express";
import { getCity } from "../cities/cities.service.js";
import { getCityColIndex } from "./cost-of-living.service.js";
import { CURRENT_ACS_YEAR } from "../constants.js";
import { NotFoundError } from "../common/errors.js";
import { cityParams, route } from "../common/validation.js";

const router: Router = Router();

router.get(
  "/:state/:city",
  route({ params: cityParams }, async ({ params }, _req, res) => {
    const resolvedCity = await getCity(params.state, params.city, CURRENT_ACS_YEAR);
    const col = getCityColIndex(resolvedCity);
    if (!col) throw new NotFoundError("Cost of living data not available for this area");
    res.json(col);
  }),
);

export default router;
