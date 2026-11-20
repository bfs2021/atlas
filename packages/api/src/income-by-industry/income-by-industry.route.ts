import { Router } from "express";
import { getCity } from "../cities/cities.service.js";
import { getIndustrySalaryData } from "./income-by-industry.service.js";
import { CURRENT_ACS_YEAR } from "../constants.js";
import { NotFoundError } from "../common/errors.js";
import { cityParams, industryKey, route } from "../common/validation.js";

const router: Router = Router();

const industryParams = cityParams.extend({ industry: industryKey });

// GET /income-by-industry/:state/:city/:industry
router.get(
  "/:state/:city/:industry",
  route({ params: industryParams }, async ({ params }, _req, res) => {
    const resolvedCity = await getCity(params.state, params.city, CURRENT_ACS_YEAR);
    const data = await getIndustrySalaryData(resolvedCity, params.industry);
    if (!data) throw new NotFoundError("Salary data not available for this area/industry");
    res.json(data);
  }),
);

export default router;
