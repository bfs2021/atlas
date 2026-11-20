import { Router } from "express";
import { z } from "zod";
import { getShareComparison, renderShareHtml, renderShareImage } from "./share.service.js";
import { citySlug, route, stateCode } from "../common/validation.js";

const router: Router = Router();

const compareParams = z.object({
  stateA: stateCode,
  cityA: citySlug,
  stateB: stateCode,
  cityB: citySlug,
});

router.get(
  "/compare/:stateA/:cityA/:stateB/:cityB",
  route({ params: compareParams }, async ({ params }, req, res) => {
    const comparison = await getShareComparison(params.stateA, params.cityA, params.stateB, params.cityB);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(renderShareHtml(req, comparison));
  }),
);

router.get(
  "/compare/:stateA/:cityA/:stateB/:cityB/image.svg",
  route({ params: compareParams }, async ({ params }, _req, res) => {
    const comparison = await getShareComparison(params.stateA, params.cityA, params.stateB, params.cityB);
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(renderShareImage(comparison));
  }),
);

export default router;
