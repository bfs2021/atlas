import { describe, expect, it } from "vitest";
import request from "supertest";
import { http, HttpResponse } from "msw";
import { createApp } from "../src/app.js";
import { fetchWithRetry } from "../src/common/http-retry.js";
import { server } from "./mocks/server.js";

describe("app", () => {
  it("GET /health returns ok", async () => {
    const res = await request(createApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /states lists supported states without any upstream call", async () => {
    const res = await request(createApp()).get("/states");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("returns 404 for unknown routes", async () => {
    const res = await request(createApp()).get("/definitely-not-a-route");
    expect(res.status).toBe(404);
  });
});

describe("network guard", () => {
  it("serves fetches that a test mocks with MSW", async () => {
    server.use(http.get("https://example.test/ok", () => HttpResponse.json({ hello: "world" })));
    const res = await fetchWithRetry("https://example.test/ok", "test", 1);
    expect(await res?.json()).toEqual({ hello: "world" });
  });

  it("blocks fetches that no test mocked, so nothing reaches the real network", async () => {
    // MSW answers an unmocked request with a synthetic 500 (and prints the offending URL)
    // instead of letting it through to the real Census API.
    const res = await fetch("https://api.census.gov/data/2023/acs/acs5");
    expect(res.status).toBe(500);
    expect(res.statusText).toBe("Unhandled Exception");
    expect(res.headers.get("server")).toBeNull();
  });
});
