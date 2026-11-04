import { z } from "zod";

export const imageLimits = {
  count: 4,
  bytes: 10 * 1024 * 1024,
  preparedBytes: 3 * 1024 * 1024,
};
export const ImageMime = z.enum(["image/png", "image/jpeg", "image/webp"]);
export const AttachmentId = z.string().uuid();
export const Attachment = z.strictObject({
  id: AttachmentId,
  name: z.string().min(1).max(120),
  mimeType: ImageMime,
  size: z.number().int().min(1).max(imageLimits.preparedBytes),
});
export type Attachment = z.infer<typeof Attachment>;
export const ImageUpload = z.strictObject({
  id: AttachmentId,
  name: z.string().min(1).max(512),
  mimeType: ImageMime,
  data: z
    .string()
    .min(4)
    .max(Math.ceil(imageLimits.bytes / 3) * 4),
});
export type ImageUpload = z.infer<typeof ImageUpload>;

export function attachmentUrl(id: string) {
  return `/api/v1/attachments/${AttachmentId.parse(id)}`;
}
