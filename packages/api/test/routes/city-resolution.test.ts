import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { server } from "../mocks/server.js";
import { censusDown, censusPlaces } from "../mocks/census.js";

// End-to-end through the real getCity -> resolvePlace path, with Census faked by MSW. Proves
// the typed errors thrown deep in the services surface as the right status codes.
const app = createApp();

describe("city resolution through the real services", () => {
  it("returns 404 for a well-formed slug that isn't a real place", async () => {
    server.use(censusPlaces([["Oakland city, California", "436504", "06", "53000"]]));

    const res = await request(app).get("/cities/CA/not-a-real-city");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "City not found" });
  });

  it("returns 404 from a data endpoint too, before fetching its data", async () => {
    server.use(censusPlaces([["Oakland city, California", "436504", "06", "53000"]]));

    const res = await request(app).get("/housing/CA/not-a-real-city");

    expect(res.status).toBe(404);
  });

  it("returns 502 with a generic message when Census is down", async () => {
    server.use(censusDown(503));

    const res = await request(app).get("/cities/CA/oakland");

    expect(res.status).toBe(502);
    expect(res.body.error).not.toMatch(/census|places|503/i);
  });
});
