import { Router } from "express";
import { getCity } from "../cities/cities.service.js";
import { getCityPoliticalLean } from "./political-lean.service.js";
import { CURRENT_ACS_YEAR } from "../constants.js";
import { NotFoundError } from "../common/errors.js";
import { cityParams, route } from "../common/validation.js";

const router: Router = Router();

router.get(
  "/:state/:city",
  route({ params: cityParams }, async ({ params }, _req, res) => {
    const resolvedCity = await getCity(params.state, params.city, CURRENT_ACS_YEAR);
    const lean = getCityPoliticalLean(resolvedCity);
    if (!lean) throw new NotFoundError("Political lean data not available for this county");
    res.json(lean);
  }),
);

export default router;
