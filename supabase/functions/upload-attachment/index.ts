import { requireUser } from "../_shared/auth.ts";
import { createUploadAttachmentGateway } from "./gateway.ts";
import { createHandler } from "./handler.ts";

Deno.serve(
  createHandler({
    authenticate: requireUser,
    gateway: createUploadAttachmentGateway(),
  }),
);
