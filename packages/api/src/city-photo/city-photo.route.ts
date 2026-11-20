import { Router } from "express";
import { getCityPhoto } from "./city-photo.service.js";
import { cityParams, route } from "../common/validation.js";

const router: Router = Router();

router.get(
  "/:state/:city",
  route({ params: cityParams }, async ({ params }, _req, res) => {
    res.json({ url: await getCityPhoto(params.state, params.city) });
  }),
);

export default router;
