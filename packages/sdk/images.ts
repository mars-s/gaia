import { ApiError } from "../protocol/index.ts";
import { Attachment, type ImageUpload } from "../protocol/attachments.ts";

export async function uploadImage(input: ImageUpload, signal?: AbortSignal) {
  const response = await fetch("/api/v1/attachments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
  });
  const value: unknown = await response.json();
  if (!response.ok) throw new Error(ApiError.parse(value).error);
  return Attachment.parse(value);
}
