// Typed errors that map to HTTP status codes in common/error-handler.ts. Services throw these
// instead of plain Error so routes don't have to guess a status from a message string.

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    // false = the message may contain upstream details (URLs, response bodies) and is only
    // logged; the client gets a generic message for the status instead.
    readonly expose = true,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string) {
    super(400, message);
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string) {
    super(404, message);
  }
}

// An upstream data source (Census, BLS, BEA, ...) failed or returned something unusable.
export class UpstreamError extends HttpError {
  constructor(message: string) {
    super(502, message, false);
  }
}
