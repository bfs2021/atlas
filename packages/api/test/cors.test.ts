import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { parseOrigins } from "../src/common/cors.js";

const PROD = "https://atlas.example.com";
const PREVIEW = "https://atlas-*-my-team.vercel.app";

function appWith(origins: string | undefined) {
  if (origins === undefined) delete process.env.CORS_ORIGINS;
  else process.env.CORS_ORIGINS = origins;
  return createApp();
}

afterEach(() => {
  delete process.env.CORS_ORIGINS;
  vi.restoreAllMocks();
});

describe("CORS allowlist", () => {
  it("allows an exact configured origin", async () => {
    const res = await request(appWith(`${PROD},${PREVIEW}`)).get("/health").set("Origin", PROD);
    expect(res.headers["access-control-allow-origin"]).toBe(PROD);
  });

  it("allows project-scoped preview URLs matching a wildcard entry", async () => {
    const res = await request(appWith(`${PROD}, ${PREVIEW}`))
      .get("/health")
      .set("Origin", "https://atlas-git-feature-x-my-team.vercel.app");
    expect(res.headers["access-control-allow-origin"]).toBe("https://atlas-git-feature-x-my-team.vercel.app");
  });

  it("rejects other origins, including other Vercel projects and look-alike hosts", async () => {
    const app = appWith(`${PROD},${PREVIEW}`);
    for (const origin of [
      "https://evil.example.com",
      "https://other-project.vercel.app",
      "https://atlas-x-my-team.vercel.app.evil.com",
      "https://atlas-a.b-my-team.vercel.app",
      "http://atlas.example.com",
    ]) {
      const res = await request(app).get("/health").set("Origin", origin);
      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    }
  });

  it("answers preflight for allowed origins only", async () => {
    const app = appWith(PROD);
    const ok = await request(app).options("/contact").set("Origin", PROD).set("Access-Control-Request-Method", "POST");
    expect(ok.headers["access-control-allow-origin"]).toBe(PROD);
    const bad = await request(app).options("/contact").set("Origin", "https://evil.example.com").set("Access-Control-Request-Method", "POST");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("still serves requests with no Origin header", async () => {
    const res = await request(appWith(PROD)).get("/health");
    expect(res.status).toBe(200);
  });

  it("falls back to local dev origins (and warns) when CORS_ORIGINS is unset", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = appWith(undefined);
    const dev = await request(app).get("/health").set("Origin", "http://localhost:5173");
    expect(dev.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    const other = await request(app).get("/health").set("Origin", PROD);
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("ignores blanks and trailing slashes when parsing", () => {
    expect(parseOrigins(" https://a.com/ , ,https://b.com ")).toEqual(["https://a.com", "https://b.com"]);
  });
});
