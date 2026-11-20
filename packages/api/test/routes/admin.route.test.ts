import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";

const app = createApp();

describe("admin routes", () => {
  // NOTE: these routes have no authentication. These tests pin the current behavior; adding
  // auth is a separate follow-up (see epic #134), and these tests should change with it.
  it("reports call counts (0 without Redis)", async () => {
    const res = await request(app).get("/admin/metrics/calls/open-meteo?date=2026-01-02");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ prefix: "open-meteo", date: "2026-01-02", count: 0 });
  });

  it("defaults the date to today", async () => {
    const res = await request(app).get("/admin/metrics/calls/open-meteo");
    expect(res.body.date).toBe(new Date().toISOString().slice(0, 10));
  });

  it.each(["yesterday", "2026-1-2", "2026-01-02T00:00"])("rejects date=%s with 400", async (date) => {
    const res = await request(app).get(`/admin/metrics/calls/open-meteo?date=${date}`);
    expect(res.status).toBe(400);
    expect(res.body.issues[0]).toMatchObject({ location: "query", path: "date" });
  });

  it("rejects a prefix with disallowed characters", async () => {
    const res = await request(app).get("/admin/metrics/calls/open%20meteo");
    expect(res.status).toBe(400);
  });

  it("clears the whole cache", async () => {
    const res = await request(app).delete("/admin/cache");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ cleared: true, prefix: "(all)", redisCleared: null });
  });

  it("clears by prefix, including narrower key prefixes", async () => {
    const res = await request(app).delete("/admin/cache/city:2024:CA:");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ cleared: true, prefix: "city:2024:CA:" });
  });

  it("rejects a cache prefix with disallowed characters", async () => {
    const res = await request(app).delete("/admin/cache/*");
    expect(res.status).toBe(400);
  });

  it("lists known cache prefixes", async () => {
    const res = await request(app).get("/admin/cache/prefixes");
    expect(res.status).toBe(200);
    expect(res.body.prefixes).toContain("city");
  });
});
