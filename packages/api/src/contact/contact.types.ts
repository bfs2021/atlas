import { HttpError } from "../common/errors.js";

export type ContactRequest = {
  name: string;
  email: string;
  message: string;
  turnstileToken?: string;
};

export class ContactValidationError extends HttpError {
  constructor(message: string) {
    super(400, message);
  }
}

export class ContactRateLimitError extends HttpError {
  constructor(message: string) {
    super(429, message);
  }
}
