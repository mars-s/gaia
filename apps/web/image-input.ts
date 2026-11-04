import {
  ImageMime,
  imageLimits,
  type ImageUpload,
} from "../../packages/protocol/attachments.ts";

export async function readImageFiles(files: File[]): Promise<ImageUpload[]> {
  if (files.length > imageLimits.count)
    throw new Error("Attach up to four images at a time.");
  return Promise.all(
    files.map(async (file) => {
      const mime = ImageMime.safeParse(file.type);
      if (!mime.success) throw new Error("Choose PNG, JPEG or WebP images.");
      if (!file.size || file.size > imageLimits.bytes)
        throw new Error("Each image must be between 1 byte and 3 MB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return {
        id: crypto.randomUUID(),
        name: file.name.slice(0, 512) || "Image",
        mimeType: mime.data,
        data: btoa(binary),
      };
    }),
  );
}

export function appendImages(current: ImageUpload[], added: ImageUpload[]) {
  const images = [...current];
  for (const image of added)
    if (
      !images.some(
        (existing) =>
          existing.data === image.data && existing.mimeType === image.mimeType,
      )
    )
      images.push(image);
  if (images.length > imageLimits.count)
    throw new Error(
      "A message can have up to four images. Remove one to add another.",
    );
  return images;
}
