import { setupServer } from "msw/node";

// Shared MSW server. Starts with no handlers: each test (or per-upstream handler module
// added in later PRs) registers what it needs with `server.use(...)`. Because the server
// errors on unhandled requests (see setup.ts), any fetch a test didn't explicitly mock fails
// loudly instead of reaching the real Census/BLS/etc. APIs.
export const server = setupServer();
