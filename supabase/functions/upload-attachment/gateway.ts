import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type AttachmentRow,
  type UploadAttachmentGateway,
  UploadAttachmentRefusal,
} from "./handler.ts";

const ATTACHMENTS_BUCKET = "attachments";

export function createUploadAttachmentGateway(
  admin: SupabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  ),
): UploadAttachmentGateway {
  return {
    async upload({ userId, boardId, taskId, file, filename, mimeType }) {
      const id = crypto.randomUUID();
      const { data: reserved, error: reserveError } = await admin
        .rpc("reserve_attachment_upload", {
          p_account_id: userId,
          p_attachment_id: id,
          p_board_id: boardId,
          p_task_id: taskId,
          p_filename: filename,
          p_mime_type: mimeType,
          p_size_bytes: file.size,
        })
        .single<AttachmentRow>();

      if (reserveError) throw reservationError(reserveError.message);
      if (!reserved) throw new Error("attachment reservation returned no row");

      const { error: uploadError } = await admin.storage
        .from(ATTACHMENTS_BUCKET)
        .upload(reserved.storage_path, file, {
          contentType: mimeType,
          upsert: false,
        });

      if (uploadError) {
        // A timeout can report failure after Storage committed. The cancellation command checks
        // for the object and keeps the row when bytes actually landed; otherwise it releases the
        // in-flight reservation so a transient failure cannot consume quota forever.
        const { error: cancelError } = await admin.rpc(
          "cancel_attachment_upload",
          {
            p_account_id: userId,
            p_attachment_id: id,
          },
        );
        if (cancelError) {
          console.error(
            "upload-attachment: reservation cleanup failed",
            cancelError,
          );
        }
        throw new Error(`storage upload failed: ${uploadError.message}`);
      }

      return reserved;
    },
  };
}

function reservationError(message: string): Error {
  if (message === "attachment_byte_quota_exceeded") {
    return new UploadAttachmentRefusal(
      "This Board has reached its 100 MiB attachment limit.",
    );
  }
  if (message === "attachment_object_quota_exceeded") {
    return new UploadAttachmentRefusal(
      "This Board has reached its 1,000 attachment limit.",
    );
  }
  if (message === "attachment_upload_forbidden") {
    return new UploadAttachmentRefusal(
      "You do not have permission to add attachments to this Board.",
    );
  }
  return new Error(`attachment reservation failed: ${message}`);
}
