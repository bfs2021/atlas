import { Router } from "express";
import { getCity } from "./cities.service.js";
import { CURRENT_ACS_YEAR } from "../constants.js";
import { cityParams, route } from "../common/validation.js";

const router: Router = Router();

router.get(
  "/:state/:city",
  route({ params: cityParams }, async ({ params }, _req, res) => {
    res.json(await getCity(params.state, params.city, CURRENT_ACS_YEAR));
  }),
);

export default router;
