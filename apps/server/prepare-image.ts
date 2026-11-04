import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
import {
  DEFAULT_IMAGE_LIMITS,
  type ImageLimits,
} from "@earendil-works/pi-durable/tools";
import {
  ImageUpload,
  imageLimits,
} from "../../packages/protocol/attachments.ts";

export class AttachmentError extends Error {}
let processor: ReturnType<typeof createNodePhotonImages> | undefined;

function jpegSize(bytes: Buffer) {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 255) break;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 217 || marker === 218) break;
    if (marker === 216 || (marker >= 208 && marker <= 215)) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (
      marker >= 192 &&
      marker <= 207 &&
      ![196, 200, 204].includes(marker) &&
      length >= 7
    )
      return {
        width: bytes.readUInt16BE(offset + 5),
        height: bytes.readUInt16BE(offset + 3),
      };
    offset += length;
  }
  throw new AttachmentError(
    "JPEG dimensions could not be read. Choose another image.",
  );
}

export function imageBytes(upload: ImageUpload) {
  const bytes = Buffer.from(upload.data, "base64");
  if (
    !bytes.length ||
    bytes.length > imageLimits.bytes ||
    bytes.toString("base64") !== upload.data
  )
    throw new AttachmentError(
      "Image data is invalid or too large. Choose an image up to 10 MB.",
    );
  let size: { width: number; height: number };
  if (
    upload.mimeType === "image/png" &&
    bytes.length >= 45 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR" &&
    bytes
      .subarray(-12)
      .equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]))
  ) {
    size = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } else if (
    upload.mimeType === "image/jpeg" &&
    bytes.length >= 12 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255 &&
    bytes.at(-2) === 255 &&
    bytes.at(-1) === 217
  ) {
    size = jpegSize(bytes);
  } else if (
    upload.mimeType === "image/webp" &&
    bytes.length >= 30 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP" &&
    bytes.readUInt32LE(4) === bytes.length - 8
  ) {
    const format = bytes.toString("ascii", 12, 16);
    if (format === "VP8X")
      size = {
        width: bytes.readUIntLE(24, 3) + 1,
        height: bytes.readUIntLE(27, 3) + 1,
      };
    else if (
      format === "VP8 " &&
      bytes.subarray(23, 26).equals(Buffer.from([157, 1, 42]))
    )
      size = {
        width: bytes.readUInt16LE(26) & 16383,
        height: bytes.readUInt16LE(28) & 16383,
      };
    else if (format === "VP8L" && bytes[20] === 47)
      size = {
        width: 1 + (bytes[21] | ((bytes[22] & 63) << 8)),
        height:
          1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 15) << 10)),
      };
    else
      throw new AttachmentError(
        "WebP dimensions could not be read. Choose another image.",
      );
  } else {
    throw new AttachmentError(
      "Image contents do not match PNG, JPEG or WebP. Choose a supported image.",
    );
  }
  if (
    !size.width ||
    !size.height ||
    size.width > 20000 ||
    size.height > 20000 ||
    size.width * size.height > 50_000_000
  )
    throw new AttachmentError(
      "This image is too large to process. Use an image up to 50 megapixels.",
    );
  return bytes;
}

export async function prepareImage(
  upload: ImageUpload,
  signal?: AbortSignal,
  limits: ImageLimits = DEFAULT_IMAGE_LIMITS,
) {
  const bytes = imageBytes(upload);
  const cancelled = () => {
    if (signal?.aborted)
      throw new AttachmentError("Image upload cancelled. Your draft is here.");
  };
  cancelled();
  processor ??= createNodePhotonImages({ idleMs: 2000 });
  const prepared = await (
    await processor
  ).prepare(new Uint8Array(bytes), upload.mimeType, {
    maxWidth: Math.min(DEFAULT_IMAGE_LIMITS.maxWidth, limits.maxWidth),
    maxHeight: Math.min(DEFAULT_IMAGE_LIMITS.maxHeight, limits.maxHeight),
    maxBytes: Math.min(
      DEFAULT_IMAGE_LIMITS.maxBytes,
      limits.maxBytes,
      Math.ceil(imageLimits.preparedBytes / 3) * 4,
    ),
  });
  cancelled();
  if (!prepared)
    throw new AttachmentError(
      "This image could not be decoded. Choose another image or export it as PNG or JPEG.",
    );
  return ImageUpload.parse({
    ...upload,
    mimeType: prepared.mimeType,
    data: prepared.data,
  });
}
