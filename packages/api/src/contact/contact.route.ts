import { Router } from "express";
import { sendContactMessage } from "./contact.service.js";
import { HttpError } from "../common/errors.js";
import { route } from "../common/validation.js";

const router: Router = Router();

// The body is validated inside sendContactMessage (contactBodySchema), not by route(), because
// the per-IP rate limit deliberately runs first: invalid submissions still count against it.
router.post(
  "/",
  route({}, async (_input, req, res) => {
    try {
      await sendContactMessage(req.body, req.ip ?? "unknown");
      res.json({ sent: true });
    } catch (error) {
      // 400 (validation) and 429 (rate limit) go to the shared handler with their message.
      if (error instanceof HttpError) throw error;
      console.error("[contact] failed to send message:", error);
      res.status(500).json({ error: "Something went wrong sending your message. Please try again later." });
    }
  }),
);

export default router;
