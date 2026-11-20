import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server.js";

const { sendMock, getRedisMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  getRedisMock: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

// Only getRedis is replaced (to drive the rate limiter); the rest of the cache is real.
vi.mock("../../src/common/cache.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/common/cache.js")>()),
  getRedis: getRedisMock,
}));

const VALID = { name: "Ada Lovelace", email: "ada@example.com", message: "Hello there" };

// contact.service memoizes its Resend client, so each test gets a freshly imported app after
// its env vars are set.
async function app() {
  vi.resetModules();
  const { createApp } = await import("../../src/app.js");
  return createApp();
}

function configure() {
  process.env.RESEND_API_KEY = "re_test";
  process.env.CONTACT_TO_EMAIL = "inbox@example.com";
  process.env.CONTACT_FROM_EMAIL = "noreply@example.com";
}

beforeEach(() => {
  configure();
  getRedisMock.mockReturnValue(null);
  sendMock.mockResolvedValue({ data: { id: "1" }, error: null });
});

afterEach(() => {
  for (const key of ["RESEND_API_KEY", "CONTACT_TO_EMAIL", "CONTACT_FROM_EMAIL", "TURNSTILE_SECRET_KEY"]) {
    delete process.env[key];
  }
});

describe("POST /contact", () => {
  it("sends a valid message", async () => {
    const res = await request(await app()).post("/contact").send(VALID);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: true });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "inbox@example.com",
        replyTo: "ada@example.com",
        text: expect.stringContaining("Hello there"),
      }),
    );
  });

  it("trims fields before sending", async () => {
    await request(await app())
      .post("/contact")
      .send({ name: "  Ada  ", email: " ada@example.com ", message: "  hi  " });

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: "ada@example.com", subject: "New contact form message from Ada" }),
    );
  });

  it.each([
    ["missing name", { ...VALID, name: undefined }, "Please enter a valid name."],
    ["blank name", { ...VALID, name: "   " }, "Please enter a valid name."],
    ["non-string name", { ...VALID, name: 42 }, "Please enter a valid name."],
    ["oversized name", { ...VALID, name: "a".repeat(101) }, "Please enter a valid name."],
    ["missing email", { ...VALID, email: undefined }, "Please enter a valid email address."],
    ["email without domain dot", { ...VALID, email: "a@b" }, "Please enter a valid email address."],
    ["email with two @", { ...VALID, email: "a@b@c.com" }, "Please enter a valid email address."],
    ["email with whitespace", { ...VALID, email: "a b@c.com" }, "Please enter a valid email address."],
    ["oversized email", { ...VALID, email: `${"a".repeat(250)}@b.com` }, "Please enter a valid email address."],
    ["empty message", { ...VALID, message: "" }, "Message must be between 1 and 5000 characters."],
    ["oversized message", { ...VALID, message: "a".repeat(5001) }, "Message must be between 1 and 5000 characters."],
    ["profane name", { ...VALID, name: "shithead" }, "Please enter a valid name and email address."],
    ["profane email", { ...VALID, email: "fuckyou@bitch.com" }, "Please enter a valid name and email address."],
  ])("rejects %s with 400 and the user-facing message", async (_label, body, message) => {
    const res = await request(await app()).post("/contact").send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: message });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("allows profanity in the message body (bug reports may quote it)", async () => {
    const res = await request(await app()).post("/contact").send({ ...VALID, message: "page says shit" });
    expect(res.status).toBe(200);
  });

  it("handles a pathological many-dots email quickly (ReDoS guard)", async () => {
    const start = performance.now();
    const res = await request(await app())
      .post("/contact")
      .send({ ...VALID, email: `a@${".a".repeat(5000)}` });
    expect(res.status).toBe(400);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("rejects a malformed JSON body with 400", async () => {
    const res = await request(await app())
      .post("/contact")
      .set("Content-Type", "application/json")
      .send('{"name": ');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid request body" });
  });

  it("returns 429 once the per-IP rate limit is exceeded", async () => {
    getRedisMock.mockReturnValue({ incr: vi.fn().mockResolvedValue(6), expire: vi.fn() });

    const res = await request(await app()).post("/contact").send(VALID);

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many messages/i);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("counts invalid submissions against the rate limit", async () => {
    const incr = vi.fn().mockResolvedValue(1);
    getRedisMock.mockReturnValue({ incr, expire: vi.fn() });

    await request(await app()).post("/contact").send({ name: "" });

    expect(incr).toHaveBeenCalledTimes(1);
  });

  describe("turnstile", () => {
    beforeEach(() => {
      process.env.TURNSTILE_SECRET_KEY = "secret";
    });

    it("requires a token once configured", async () => {
      const res = await request(await app()).post("/contact").send(VALID);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/verification challenge/i);
    });

    it("rejects a token Cloudflare doesn't accept", async () => {
      server.use(
        http.post("https://challenges.cloudflare.com/turnstile/v0/siteverify", () =>
          HttpResponse.json({ success: false }),
        ),
      );
      const res = await request(await app()).post("/contact").send({ ...VALID, turnstileToken: "bad" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/verification failed/i);
    });

    it("sends when Cloudflare accepts the token", async () => {
      server.use(
        http.post("https://challenges.cloudflare.com/turnstile/v0/siteverify", () =>
          HttpResponse.json({ success: true }),
        ),
      );
      const res = await request(await app()).post("/contact").send({ ...VALID, turnstileToken: "good" });
      expect(res.status).toBe(200);
    });
  });

  it("returns a generic 500 when Resend isn't configured", async () => {
    delete process.env.RESEND_API_KEY;

    const res = await request(await app()).post("/contact").send(VALID);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/something went wrong/i);
    expect(res.body.error).not.toMatch(/RESEND/);
  });

  it("returns a generic 500 when Resend reports an error", async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: "domain not verified" } });

    const res = await request(await app()).post("/contact").send(VALID);

    expect(res.status).toBe(500);
    expect(res.body.error).not.toMatch(/domain/);
  });
});
