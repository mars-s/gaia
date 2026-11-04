import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  readFileSync,
  writeFileSync,
  fsyncSync,
  renameSync,
  rmSync,
  mkdirSync,
  lstatSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import type { ImageLimits } from "@earendil-works/pi-durable/tools";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  Attachment,
  AttachmentId,
  ImageUpload,
  imageLimits,
} from "../../packages/protocol/attachments.ts";
import { generationDirectory } from "./data-path.ts";

import { AttachmentError, imageBytes, prepareImage } from "./prepare-image.ts";
export { AttachmentError } from "./prepare-image.ts";

function uploadDigest(upload: ImageUpload) {
  return createHash("sha256")
    .update(upload.mimeType)
    .update("\0")
    .update(displayName(upload.name))
    .update("\0")
    .update(imageBytes(upload))
    .digest("hex");
}

function displayName(name: string) {
  return (
    name
      .normalize("NFKC")
      .replace(/[\\/\p{Cc}\p{Cf}]/gu, "_")
      .trim()
      .slice(0, 120) || "Image"
  );
}

const StoredImage = z.strictObject({
  attachment: Attachment,
  data: ImageUpload.shape.data,
  requestDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});

export function openAttachments(db: DatabaseSync) {
  const directory = join(generationDirectory(db), "attachments");
  function ensureDirectory() {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (
      !lstatSync(directory).isDirectory() ||
      lstatSync(directory).isSymbolicLink()
    )
      throw new AttachmentError("Image storage is unavailable.");
    chmodSync(directory, 0o700);
  }
  function read(id: string) {
    const parsed = AttachmentId.safeParse(id);
    if (!parsed.success) throw new AttachmentError("Invalid image reference.");
    ensureDirectory();
    let fd: number;
    try {
      fd = openSync(
        join(directory, `${parsed.data}.json`),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
    } catch {
      throw new AttachmentError(
        "Image is unavailable. Attach it again before sending.",
      );
    }
    try {
      const stat = fstatSync(fd);
      if (
        !stat.isFile() ||
        stat.size > Math.ceil(imageLimits.preparedBytes / 3) * 4 + 2048
      )
        throw new AttachmentError("Stored image is invalid.");
      const stored = StoredImage.parse(JSON.parse(readFileSync(fd, "utf8")));
      if (stored.attachment.id !== parsed.data)
        throw new AttachmentError("Stored image is invalid.");
      const bytes = imageBytes({ ...stored.attachment, data: stored.data });
      if (stored.attachment.size !== bytes.length)
        throw new AttachmentError("Stored image is invalid.");
      return { ...stored, bytes };
    } finally {
      closeSync(fd);
    }
  }
  return {
    read,
    async put(
      input: ImageUpload,
      signal?: AbortSignal,
      limits?: ImageLimits,
    ): Promise<Attachment> {
      const original = ImageUpload.parse(input);
      const digest = uploadDigest(original);
      ensureDirectory();
      const path = join(directory, `${original.id}.json`);
      const existingAttachment = () => {
        if (!lstatExists(path)) return undefined;
        const existing = read(original.id);
        const fingerprint =
          existing.requestDigest ??
          uploadDigest({ ...existing.attachment, data: existing.data });
        if (fingerprint !== digest)
          throw new AttachmentError(
            "That image ID already belongs to another upload.",
          );
        return existing.attachment;
      };
      const existing = existingAttachment();
      if (existing) return existing;
      const upload = await prepareImage(original, signal, limits);
      const bytes = imageBytes(upload);
      const attachment = Attachment.parse({
        id: upload.id,
        name: displayName(upload.name),
        mimeType: upload.mimeType,
        size: bytes.length,
      });
      const raced = existingAttachment();
      if (raced) return raced;
      const temporary = join(directory, `.${randomUUID()}.tmp`);
      const fd = openSync(temporary, "wx", 0o600);
      try {
        writeFileSync(
          fd,
          JSON.stringify({
            attachment,
            data: upload.data,
            requestDigest: digest,
          }),
        );
        fsyncSync(fd);
        renameSync(temporary, path);
      } finally {
        closeSync(fd);
        rmSync(temporary, { force: true });
      }
      return attachment;
    },
  };
}

function lstatExists(path: string) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}
