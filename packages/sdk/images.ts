import { ApiError } from "../protocol/index.ts";
import { Attachment, type ImageUpload } from "../protocol/attachments.ts";

export async function uploadImage(input: ImageUpload, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(120000);
  let response: Response;
  try {
    response = await fetch("/api/v1/attachments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (cause) {
    if (
      timeout.aborted ||
      (cause instanceof Error && cause.name === "TimeoutError")
    )
      throw new Error(
        "Image upload took too long. Your draft is here. Try again when Gaia is ready.",
        { cause },
      );
    if (signal?.aborted)
      throw new Error("Image upload cancelled. Your draft is here.", { cause });
    throw new Error(
      "Image could not be uploaded. Check your connection and try again. Your draft is here.",
      { cause },
    );
  }
  const value: unknown = await response.json();
  if (!response.ok) throw new Error(ApiError.parse(value).error);
  return Attachment.parse(value);
}
