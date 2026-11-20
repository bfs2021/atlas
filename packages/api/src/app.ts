import express, { type Express } from "express";
import cors from "cors";
import { buildCorsOptions } from "./common/cors.js";
import citiesRouter from "./cities/cities.route.js";
import housingRouter from "./housing/housing.route.js";
import incomeRouter from "./income/income.route.js"
import incomeByIndustryRouter from "./income-by-industry/income-by-industry.route.js"
import affordabilityRouter from "./affordability/affordability.route.js"
import statesRouter from "./states/states.route.js"
import shareRouter from "./share/share.route.js";
import cityProfileRouter from "./city-profile/city-profile.route.js";
import financialRouter from "./financial/financial.route.js";
import qualityOfLifeRouter from "./quality-of-life/quality-of-life.route.js";
import climateRouter from "./climate/climate.route.js";
import lifestyleRouter from "./lifestyle/lifestyle.route.js";
import adminRouter from "./admin/admin.route.js";
import airQualityRouter from "./air-quality/air-quality.route.js";
import politicalLeanRouter from "./political-lean/political-lean.route.js";
import educationRouter from "./education/education.route.js";
import costOfLivingRouter from "./cost-of-living/cost-of-living.route.js";
import cityPhotoRouter from "./city-photo/city-photo.route.js";
import cityLocationRouter from "./city-location/city-location.route.js";
import contactRouter from "./contact/contact.route.js";

// Builds the Express app (middleware + routers) without listening or warming the startup
// caches, so tests can mount it with supertest. Server startup lives in index.ts.
export function createApp(): Express {
  const app = express();

  app.set("trust proxy", true);
  app.use(express.json());
  app.use(cors(buildCorsOptions()));

  app.get('/health', (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use('/cities', citiesRouter);
  app.use('/housing', housingRouter);
  app.use('/income', incomeRouter);
  app.use('/income-by-industry', incomeByIndustryRouter);
  app.use('/affordability', affordabilityRouter);
  app.use('/states', statesRouter);
  app.use('/share', shareRouter);
  app.use('/city-profile', cityProfileRouter);
  app.use('/financial', financialRouter);
  app.use('/quality-of-life', qualityOfLifeRouter);
  app.use('/climate', climateRouter);
  app.use('/lifestyle', lifestyleRouter);
  app.use('/admin', adminRouter);
  app.use('/air-quality', airQualityRouter);
  app.use('/political-lean', politicalLeanRouter);
  app.use('/education', educationRouter);
  app.use('/cost-of-living', costOfLivingRouter);
  app.use('/city-photo', cityPhotoRouter);
  app.use('/city-location', cityLocationRouter);
  app.use('/contact', contactRouter);

  return app;
}
