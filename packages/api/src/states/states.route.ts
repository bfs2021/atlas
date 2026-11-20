import { Router } from "express";
import { z } from "zod";
import { getStates, getCitiesForState } from "./states.service.js";
import { route, stateCode } from "../common/validation.js";

const router: Router = Router();

router.get(
  "/",
  route({}, (_input, _req, res) => {
    res.json(getStates());
  }),
);

router.get(
  "/:state/cities",
  route({ params: z.object({ state: stateCode }) }, async ({ params }, _req, res) => {
    res.json(await getCitiesForState(params.state));
  }),
);

export default router;
