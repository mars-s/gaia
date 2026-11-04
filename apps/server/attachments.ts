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
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  Attachment,
  AttachmentId,
  ImageUpload,
  imageLimits,
} from "../../packages/protocol/attachments.ts";
import { generationDirectory } from "./data-path.ts";

export class AttachmentError extends Error {}

function imageBytes(upload: ImageUpload) {
  const bytes = Buffer.from(upload.data, "base64");
  if (
    !bytes.length ||
    bytes.length > imageLimits.bytes ||
    bytes.toString("base64") !== upload.data
  )
    throw new AttachmentError(
      "Image data is invalid or too large. Use images up to 3 MB.",
    );
  const png =
    bytes.length >= 45 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR" &&
    bytes.readUInt32BE(16) > 0 &&
    bytes.readUInt32BE(20) > 0 &&
    bytes
      .subarray(-12)
      .equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]));
  const jpeg =
    bytes.length >= 12 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255 &&
    bytes.at(-2) === 255 &&
    bytes.at(-1) === 217;
  const webp =
    bytes.length >= 30 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP" &&
    bytes.readUInt32LE(4) === bytes.length - 8 &&
    ["VP8 ", "VP8L", "VP8X"].includes(bytes.toString("ascii", 12, 16));
  if (
    !(upload.mimeType === "image/png"
      ? png
      : upload.mimeType === "image/jpeg"
        ? jpeg
        : webp)
  )
    throw new AttachmentError(
      "Image contents do not match PNG, JPEG or WebP. Choose a supported image.",
    );
  return bytes;
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
        stat.size > Math.ceil(imageLimits.bytes / 3) * 4 + 2048
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
    put(input: ImageUpload): Attachment {
      const upload = ImageUpload.parse(input);
      const bytes = imageBytes(upload);
      const attachment: Attachment = {
        id: upload.id,
        name: displayName(upload.name),
        mimeType: upload.mimeType,
        size: bytes.length,
      };
      ensureDirectory();
      const path = join(directory, `${upload.id}.json`);
      if (lstatExists(path)) {
        const existing = read(upload.id);
        if (
          existing.data !== upload.data ||
          existing.attachment.name !== attachment.name ||
          existing.attachment.mimeType !== attachment.mimeType
        )
          throw new AttachmentError(
            "That image ID already belongs to another upload.",
          );
        return existing.attachment;
      }
      const temporary = join(directory, `.${randomUUID()}.tmp`);
      const fd = openSync(temporary, "wx", 0o600);
      try {
        writeFileSync(fd, JSON.stringify({ attachment, data: upload.data }));
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
