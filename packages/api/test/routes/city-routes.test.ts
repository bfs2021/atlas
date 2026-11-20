import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { NotFoundError, UpstreamError } from "../../src/common/errors.js";

// Route contract tests: services are mocked, so these pin what the HTTP layer does with
// input and errors (validation, normalization, status codes). Service internals are tested
// separately; see city-resolution.test.ts for the real getCity path.
vi.mock("../../src/cities/cities.service.js");
vi.mock("../../src/housing/housing.service.js");
vi.mock("../../src/income/income.service.js");
vi.mock("../../src/income-by-industry/income-by-industry.service.js");
vi.mock("../../src/affordability/affordability.service.js");
vi.mock("../../src/city-profile/city-profile.service.js");
vi.mock("../../src/financial/financial.service.js");
vi.mock("../../src/quality-of-life/quality-of-life.service.js");
vi.mock("../../src/climate/climate.service.js");
vi.mock("../../src/lifestyle/lifestyle.service.js");
vi.mock("../../src/air-quality/air-quality.service.js");
vi.mock("../../src/political-lean/political-lean.service.js");
vi.mock("../../src/education/education.service.js");
vi.mock("../../src/cost-of-living/cost-of-living.service.js");
vi.mock("../../src/city-photo/city-photo.service.js");
vi.mock("../../src/city-location/city-location.service.js");
vi.mock("../../src/states/states.service.js");
vi.mock("../../src/share/share.service.js");

const { getCity } = await import("../../src/cities/cities.service.js");
const housing = await import("../../src/housing/housing.service.js");
const income = await import("../../src/income/income.service.js");
const industry = await import("../../src/income-by-industry/income-by-industry.service.js");
const affordability = await import("../../src/affordability/affordability.service.js");
const profile = await import("../../src/city-profile/city-profile.service.js");
const financial = await import("../../src/financial/financial.service.js");
const qol = await import("../../src/quality-of-life/quality-of-life.service.js");
const climate = await import("../../src/climate/climate.service.js");
const lifestyle = await import("../../src/lifestyle/lifestyle.service.js");
const airQuality = await import("../../src/air-quality/air-quality.service.js");
const politicalLean = await import("../../src/political-lean/political-lean.service.js");
const education = await import("../../src/education/education.service.js");
const costOfLiving = await import("../../src/cost-of-living/cost-of-living.service.js");
const photo = await import("../../src/city-photo/city-photo.service.js");
const location = await import("../../src/city-location/city-location.service.js");
const states = await import("../../src/states/states.service.js");
const share = await import("../../src/share/share.service.js");

const CITY = { name: "Oakland", state: "CA", slug: "oakland" } as never;
const PAYLOAD = { some: "data" };

type Endpoint = {
  name: string;
  // Builds the URL for a given (raw, unvalidated) state and city.
  url: (state: string, city: string) => string;
  // The service the route delegates to, after getCity when resolvesCity is true.
  service: ReturnType<typeof vi.fn>;
  resolvesCity: boolean;
  // How the route shapes the service result into the response body.
  expectedBody?: unknown;
  // The service returns a plain value rather than a promise (in-memory lookups).
  sync?: boolean;
};

const m = (fn: unknown) => vi.mocked(fn as (...args: unknown[]) => unknown);

const endpoints: Endpoint[] = [
  { name: "cities", url: (s, c) => `/cities/${s}/${c}`, service: m(getCity), resolvesCity: false },
  {
    name: "housing",
    url: (s, c) => `/housing/${s}/${c}`,
    service: m(housing.getCityHousing),
    resolvesCity: true,
    expectedBody: { city: { name: "Oakland", state: "CA" }, housing: PAYLOAD },
  },
  {
    name: "housing details",
    url: (s, c) => `/housing/${s}/${c}/details`,
    service: m(housing.getDetailedCityHousing),
    resolvesCity: true,
    expectedBody: { city: { name: "Oakland", state: "CA" }, housing: PAYLOAD },
  },
  { name: "income", url: (s, c) => `/income/${s}/${c}`, service: m(income.getCityIncome), resolvesCity: true },
  { name: "income details", url: (s, c) => `/income/${s}/${c}/details`, service: m(income.getDetailedCityIncome), resolvesCity: true },
  {
    name: "income by industry",
    url: (s, c) => `/income-by-industry/${s}/${c}/tech_media_pro`,
    service: m(industry.getIndustrySalaryData),
    resolvesCity: true,
  },
  { name: "affordability", url: (s, c) => `/affordability/${s}/${c}`, service: m(affordability.getCityAffordability), resolvesCity: true },
  {
    name: "affordability details",
    url: (s, c) => `/affordability/${s}/${c}/details`,
    service: m(affordability.getDetailedCityAffordability),
    resolvesCity: true,
  },
  { name: "city profile", url: (s, c) => `/city-profile/${s}/${c}`, service: m(profile.getCityProfileSummary), resolvesCity: true },
  {
    name: "city profile details",
    url: (s, c) => `/city-profile/${s}/${c}/details`,
    service: m(profile.getCityProfileDetails),
    resolvesCity: true,
  },
  { name: "financial", url: (s, c) => `/financial/${s}/${c}`, service: m(financial.getFinancialSummary), resolvesCity: true },
  { name: "financial details", url: (s, c) => `/financial/${s}/${c}/details`, service: m(financial.getFinancialDetails), resolvesCity: true },
  { name: "quality of life", url: (s, c) => `/quality-of-life/${s}/${c}`, service: m(qol.getQualityOfLifeSummary), resolvesCity: true },
  {
    name: "quality of life details",
    url: (s, c) => `/quality-of-life/${s}/${c}/details`,
    service: m(qol.getQualityOfLifeDetails),
    resolvesCity: true,
  },
  { name: "climate", url: (s, c) => `/climate/${s}/${c}`, service: m(climate.getCityClimate), resolvesCity: true },
  { name: "lifestyle", url: (s, c) => `/lifestyle/${s}/${c}`, service: m(lifestyle.getCityLifestyle), resolvesCity: true },
  { name: "air quality", url: (s, c) => `/air-quality/${s}/${c}`, service: m(airQuality.getCityAirQuality), resolvesCity: true, sync: true },
  { name: "political lean", url: (s, c) => `/political-lean/${s}/${c}`, service: m(politicalLean.getCityPoliticalLean), resolvesCity: true, sync: true },
  { name: "education", url: (s, c) => `/education/${s}/${c}`, service: m(education.getCityEducation), resolvesCity: true },
  { name: "cost of living", url: (s, c) => `/cost-of-living/${s}/${c}`, service: m(costOfLiving.getCityColIndex), resolvesCity: true, sync: true },
  {
    name: "city photo",
    url: (s, c) => `/city-photo/${s}/${c}`,
    service: m(photo.getCityPhoto),
    resolvesCity: false,
    expectedBody: { url: PAYLOAD },
  },
  { name: "city location", url: (s, c) => `/city-location/${s}/${c}`, service: m(location.getCityLocation), resolvesCity: false },
  {
    name: "major cities",
    url: (s, c) => `/city-location/${s}/major-cities/${c}`,
    service: m(location.getMajorCitiesInState),
    resolvesCity: false,
  },
];

const INVALID_STATES = ["ZZ", "california", "1", "C", "%3Cscript%3E"];
const INVALID_SLUGS = [
  "..%2F..%2Fetc%2Fpasswd",
  "a".repeat(101),
  "caf%C3%A9",
  "oak_land",
  "-oakland",
  "oak--land",
  "oakland%3Cscript%3E",
  "%20",
];

// Every upstream-facing service export in the mocked modules.
const allServices = () =>
  [getCity, ...endpoints.map((e) => e.service)].filter((fn, i, all) => all.indexOf(fn) === i);

const app = createApp();

beforeEach(() => {
  vi.resetAllMocks();
  m(getCity).mockResolvedValue(CITY);
  for (const { service, sync } of endpoints) {
    if (service === m(getCity)) continue;
    if (sync) service.mockReturnValue(PAYLOAD);
    else service.mockResolvedValue(PAYLOAD);
  }
});

describe.each(endpoints)("$name", ({ url, service, resolvesCity, expectedBody, sync }) => {
  const fail = (err: Error) =>
    sync ? service.mockImplementation(() => { throw err; }) : service.mockRejectedValue(err);

  it("returns 200 with the service result, passing normalized params", async () => {
    // Lowercase state and mixed-case slug are accepted and normalized before the service sees them.
    const res = await request(app).get(url("ca", "Oakland"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expectedBody ?? (service === m(getCity) ? CITY : PAYLOAD));
    const call = resolvesCity ? m(getCity).mock.calls[0] : service.mock.calls[0];
    expect(call?.slice(0, 2)).toEqual(["CA", "oakland"]);
  });

  it.each(INVALID_STATES)("rejects state %j with 400 before any service call", async (state) => {
    const res = await request(app).get(url(state, "oakland"));

    expect(res.status).toBe(400);
    expect(res.body.issues).toContainEqual(expect.objectContaining({ location: "params", path: "state" }));
    for (const fn of allServices()) expect(fn).not.toHaveBeenCalled();
  });

  it.each(INVALID_SLUGS)("rejects city slug %j with 400 before any service call", async (slug) => {
    const res = await request(app).get(url("CA", slug));

    expect(res.status).toBe(400);
    expect(res.body.issues?.[0]?.location).toBe("params");
    for (const fn of allServices()) expect(fn).not.toHaveBeenCalled();
  });

  it("maps NotFoundError to 404 with its message", async () => {
    fail(new NotFoundError("City not found"));

    const res = await request(app).get(url("CA", "nowhere"));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "City not found" });
  });

  if (resolvesCity) {
    it("returns 404 when the city doesn't resolve, without calling the data service", async () => {
      m(getCity).mockRejectedValue(new NotFoundError("City not found"));

      const res = await request(app).get(url("CA", "nowhere"));

      expect(res.status).toBe(404);
      expect(service).not.toHaveBeenCalled();
    });
  }

  it("maps UpstreamError to 502 without leaking upstream details", async () => {
    fail(new UpstreamError("Failed to fetch Census data: 503 <html>secret</html>"));

    const res = await request(app).get(url("CA", "oakland"));

    expect(res.status).toBe(502);
    expect(Object.keys(res.body)).toEqual(["error"]);
    expect(res.body.error).not.toMatch(/census|secret|503/i);
  });

  it("maps unexpected errors to 500 with a generic message", async () => {
    fail(new TypeError("Cannot read properties of undefined (reading 'x')"));

    const res = await request(app).get(url("CA", "oakland"));

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  });
});

describe("route-specific behavior", () => {
  it("returns 404 when political lean data is missing for the county", async () => {
    m(politicalLean.getCityPoliticalLean).mockReturnValue(null);
    const res = await request(app).get("/political-lean/CA/oakland");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/political lean/i);
  });

  it("returns 404 when cost of living data is missing for the area", async () => {
    m(costOfLiving.getCityColIndex).mockReturnValue(null);
    const res = await request(app).get("/cost-of-living/CA/oakland");
    expect(res.status).toBe(404);
  });

  it("returns 404 when salary data is missing for the area/industry", async () => {
    m(industry.getIndustrySalaryData).mockResolvedValue(null);
    const res = await request(app).get("/income-by-industry/CA/oakland/tech_media_pro");
    expect(res.status).toBe(404);
  });

  it("rejects an unknown industry with 400", async () => {
    const res = await request(app).get("/income-by-industry/CA/oakland/astronaut");
    expect(res.status).toBe(400);
    expect(res.body.issues[0]).toMatchObject({ location: "params", path: "industry" });
    expect(getCity).not.toHaveBeenCalled();
  });

  it("rejects prototype keys as an industry", async () => {
    const res = await request(app).get("/income-by-industry/CA/oakland/constructor");
    expect(res.status).toBe(400);
  });

  describe("affordability ?year", () => {
    it("defaults to the current ACS year", async () => {
      await request(app).get("/affordability/CA/oakland");
      expect(getCity).toHaveBeenCalledWith("CA", "oakland", expect.any(Number));
      const year = m(getCity).mock.calls[0]![2];
      expect(m(affordability.getCityAffordability)).toHaveBeenCalledWith(CITY, year);
    });

    it("accepts a valid ACS year", async () => {
      const res = await request(app).get("/affordability/CA/oakland?year=2019");
      expect(res.status).toBe(200);
      expect(getCity).toHaveBeenCalledWith("CA", "oakland", 2019);
    });

    it.each(["abc", "1999", "3000", "2019.5"])("rejects year=%s with 400", async (year) => {
      const res = await request(app).get(`/affordability/CA/oakland?year=${year}`);
      expect(res.status).toBe(400);
      expect(res.body.issues[0]).toMatchObject({ location: "query", path: "year" });
      expect(res.body.error).toMatch(/^Year must be a whole number from 2009 to \d{4}$/);
    });
  });

  describe("major cities ?limit", () => {
    it("defaults to 8", async () => {
      await request(app).get("/city-location/CA/major-cities/oakland");
      expect(location.getMajorCitiesInState).toHaveBeenCalledWith("CA", "oakland", 8);
    });

    it("passes a valid limit through", async () => {
      await request(app).get("/city-location/CA/major-cities/oakland?limit=20");
      expect(location.getMajorCitiesInState).toHaveBeenCalledWith("CA", "oakland", 20);
    });

    it.each(["0", "31", "abc", "-5"])("rejects limit=%s with 400", async (limit) => {
      const res = await request(app).get(`/city-location/CA/major-cities/oakland?limit=${limit}`);
      expect(res.status).toBe(400);
    });
  });

  describe("states", () => {
    it("lists states", async () => {
      m(states.getStates).mockReturnValue([{ code: "CA", name: "California" }]);
      const res = await request(app).get("/states");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ code: "CA", name: "California" }]);
    });

    it("lists cities for a normalized state", async () => {
      m(states.getCitiesForState).mockResolvedValue([{ name: "Oakland", slug: "oakland" }]);
      const res = await request(app).get("/states/ca/cities");
      expect(res.status).toBe(200);
      expect(states.getCitiesForState).toHaveBeenCalledWith("CA");
    });

    it("rejects an unsupported state with 400", async () => {
      const res = await request(app).get("/states/ZZ/cities");
      expect(res.status).toBe(400);
      expect(states.getCitiesForState).not.toHaveBeenCalled();
    });
  });

  describe("share", () => {
    beforeEach(() => {
      m(share.getShareComparison).mockResolvedValue(PAYLOAD);
      m(share.renderShareHtml).mockReturnValue("<html>share</html>");
      m(share.renderShareImage).mockReturnValue("<svg/>");
    });

    it("renders the share page as HTML", async () => {
      const res = await request(app).get("/share/compare/ca/Oakland/tx/austin");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toBe("<html>share</html>");
      expect(share.getShareComparison).toHaveBeenCalledWith("CA", "oakland", "TX", "austin");
    });

    it("renders the share image as SVG", async () => {
      const res = await request(app).get("/share/compare/CA/oakland/TX/austin/image.svg");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/image\/svg\+xml/);
    });

    it.each([
      ["/share/compare/ZZ/oakland/TX/austin", "stateA"],
      ["/share/compare/CA/oakland/TX/%3Cscript%3E", "cityB"],
    ])("rejects %s with 400 (%s)", async (url, path) => {
      const res = await request(app).get(url);
      expect(res.status).toBe(400);
      expect(res.body.issues[0]).toMatchObject({ path });
      expect(share.getShareComparison).not.toHaveBeenCalled();
    });

    it("returns 404 when a city doesn't resolve", async () => {
      m(share.getShareComparison).mockRejectedValue(new NotFoundError("City not found"));
      const res = await request(app).get("/share/compare/CA/nowhere/TX/austin");
      expect(res.status).toBe(404);
    });
  });
});
