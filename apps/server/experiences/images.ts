import { z } from "zod";
import { defineDoc, type Harness } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { ScopeId } from "../../../packages/protocol/experiences.ts";
import {
  ImageUpload,
  AttachmentId,
  Attachment,
} from "../../../packages/protocol/attachments.ts";
import { prepareImage, imageBytes } from "../prepare-image.ts";
import { HttpError } from "../http-error.ts";
import { digest } from "./storage.ts";
import type { State } from "./state.ts";
const ImageDoc = z.object({
  scopeId: ScopeId,
  attachment: Attachment,
  data: z.string(),
  digest: z.string(),
});
export const Images = defineDoc<{ images: z.infer<typeof ImageDoc>[] }>({
  kind: "gaia.experience-images",
  version: 1,
  scope: "session",
  initial: () => ({ images: [] }),
  checkpointWhen: () => true,
});

export function createImages({
  getHarness,
  gate,
  read,
  scopeIn,
  track,
}: {
  getHarness(): Harness;
  gate(): void;
  read(): Promise<State>;
  scopeIn(state: State, id: string): State["scopes"][number];
  track<T>(work: () => Promise<T>): Promise<T>;
}) {
  return {
    async upload(scopeId: string, input: ImageUpload) {
      return track(async () => {
        gate();
        scopeIn(await read(), scopeId);
        const fingerprint = digest(input);
        const upload = await prepareImage(input);
        const bytes = imageBytes(upload);
        return getHarness().commit(async (tx) => {
          const doc = await tx.doc(Images);
          const old = doc.images.find((f) => f.attachment.id === input.id);
          if (old) {
            if (old.scopeId !== scopeId || old.digest !== fingerprint)
              throw new HttpError(409, "Image ID belongs to another upload.");
            return old.attachment;
          }
          const attachment = Attachment.parse({
            id: upload.id,
            name: upload.name,
            mimeType: upload.mimeType,
            size: bytes.length,
          });
          doc.images.push(
            ImageDoc.parse({
              scopeId: ScopeId.parse(scopeId),
              attachment,
              data: upload.data,
              digest: fingerprint,
            }),
          );
          return attachment;
        }, ctx);
      });
    },
    async image(scopeId: string, imageId: string) {
      scopeIn(await read(), scopeId);
      if (!AttachmentId.safeParse(imageId).success)
        throw new HttpError(404, "Unknown scoped image.");
      const images = await getHarness().snapshot(Images, ctx);
      const image = images?.images.find(
        (f) =>
          f.scopeId === scopeId &&
          f.attachment.id === AttachmentId.parse(imageId),
      );
      if (!image) throw new HttpError(404, "Unknown scoped image.");
      return {
        attachment: image.attachment,
        bytes: imageBytes({ ...image.attachment, data: image.data }),
      };
    },
  };
}
