import { corsHeaders } from "../_shared/cors.ts";

export type AttachmentRow = {
  id: string;
  board_id: string;
  task_id: string;
  storage_path: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: string;
};

export type UploadAttachmentGateway = {
  upload(input: {
    userId: string;
    boardId: string;
    taskId: string;
    file: File;
    filename: string;
    mimeType: string;
  }): Promise<AttachmentRow>;
};

export class UploadAttachmentRefusal extends Error {}

type Dependencies = {
  authenticate(req: Request): Promise<{ id: string } | Response>;
  gateway: UploadAttachmentGateway;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

export function createHandler({ authenticate, gateway }: Dependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const user = await authenticate(req);
    if (user instanceof Response) return user;

    let body: FormData;
    try {
      body = await req.formData();
    } catch {
      return json({ ok: false, error: "Invalid upload request." });
    }

    const boardId = body.get("boardId");
    const taskId = body.get("taskId");
    const file = body.get("file");
    if (
      typeof boardId !== "string" ||
      typeof taskId !== "string" ||
      !isUuid(boardId) ||
      !isUuid(taskId) ||
      !(file instanceof File)
    ) {
      return json({ ok: false, error: "Invalid upload request." });
    }

    const filename = file.name.trim();
    if (file.size === 0) {
      return json({ ok: false, error: "That file is empty." });
    }
    if (file.size > 10 * 1024 * 1024) {
      return json({
        ok: false,
        error: "Attachments must be 10 MiB or smaller.",
      });
    }
    if (
      Array.from(filename).length === 0 || Array.from(filename).length > 255
    ) {
      return json({
        ok: false,
        error: "Attachment names must be 1–255 characters.",
      });
    }
    const mimeType = await detectedMimeType(file);
    if (!mimeType) {
      return json({
        ok: false,
        error: "That file is not a PNG, JPEG, GIF, WebP, or PDF.",
      });
    }

    try {
      const attachment = await gateway.upload({
        userId: user.id,
        boardId,
        taskId,
        file,
        filename,
        mimeType,
      });
      return json({ ok: true, attachment });
    } catch (cause) {
      if (cause instanceof UploadAttachmentRefusal) {
        return json({ ok: false, error: cause.message });
      }
      console.error("upload-attachment: command failed", cause);
      return json({ ok: false, error: "Upload failed. Please try again." });
    }
  };
}

async function detectedMimeType(file: File): Promise<string | null> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const starts = (...prefix: number[]) =>
    prefix.every((value, index) => bytes[index] === value);

  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return "image/png";
  }
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (
    starts(0x47, 0x49, 0x46, 0x38, 0x37, 0x61) ||
    starts(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)
  ) {
    return "image/gif";
  }
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf";
  return null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
