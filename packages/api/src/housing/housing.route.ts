import { Router } from "express";
import { getCity } from "../cities/cities.service.js";
import { getCityHousing, getDetailedCityHousing } from "./housing.service.js";
import { CURRENT_ACS_YEAR } from "../constants.js";
import { cityParams, route } from "../common/validation.js";

const router: Router = Router();

router.get(
  "/:state/:city",
  route({ params: cityParams }, async ({ params }, _req, res) => {
    const cityData = await getCity(params.state, params.city, 2023);
    const housing = await getCityHousing(cityData, CURRENT_ACS_YEAR);
    res.json({
      city: { name: cityData.name, state: cityData.state },
      housing,
    });
  }),
);

router.get(
  "/:state/:city/details",
  route({ params: cityParams }, async ({ params }, _req, res) => {
    const cityData = await getCity(params.state, params.city, 2023);
    const housing = await getDetailedCityHousing(cityData, CURRENT_ACS_YEAR);
    res.json({
      city: { name: cityData.name, state: cityData.state },
      housing,
    });
  }),
);

export default router;
