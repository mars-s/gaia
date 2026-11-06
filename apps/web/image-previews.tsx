import { cx } from "./utils/cx";
import { useEffect, useState } from "react";
import { RiCloseLine, RiImageLine } from "@remixicon/react";
import {
  attachmentUrl,
  type Attachment,
  type ImageUpload,
} from "../../packages/protocol/attachments.ts";

function Thumbnail({
  src,
  name,
  remove,
  mimeType,
}: {
  src?: string;
  name: string;
  remove?: () => void;
  mimeType?: ImageUpload["mimeType"];
}) {
  const [aspect, setAspect] = useState(1);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <figure className={cx("image-thumbnail", remove && "draft-file-chip")}>
      {src && !failed ? (
        <img
          src={src}
          alt={name}
          width={80}
          height={80}
          style={remove ? {width: `clamp(48px, ${48 * aspect}px, 72px)`} : undefined}
          onLoad={event => setAspect(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="image-unavailable">
          <RiImageLine className="size-5" aria-hidden />
          <span>{src ? "Unavailable" : "Loading"}</span>
        </span>
      )}
      {remove && <div className="draft-file-copy"><p title={name}>{name}</p><p>{mimeType === "image/png" ? "PNG image" : mimeType === "image/jpeg" ? "JPEG image" : "WebP image"}{failed ? ", preview unavailable" : ""}</p></div>}
      {remove && (
        <button
          type="button"
          className="remove-image"
          aria-label={`Remove ${name}`}
          onClick={remove}
        >
          <RiCloseLine className="size-3.5" aria-hidden />
        </button>
      )}
      {!remove && <figcaption>
        {name}
        {failed ? ", preview unavailable" : ""}
      </figcaption>}
    </figure>
  );
}

function DraftThumbnail({
  image,
  remove,
}: {
  image: ImageUpload;
  remove: () => void;
}) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = Uint8Array.from(atob(image.data), (character) =>
        character.charCodeAt(0),
      );
    } catch {
      setSrc(undefined);
      return;
    }
    const url = URL.createObjectURL(
      new Blob([bytes], { type: image.mimeType }),
    );
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [image.data, image.mimeType]);
  return <Thumbnail src={src} name={image.name} mimeType={image.mimeType} remove={remove} />;
}

export function DraftImages({
  images,
  onRemove,
}: {
  images: ImageUpload[];
  onRemove: (id: string) => void;
}) {
  return (
    <div className="draft-images" role="group" aria-label="Attached images">
      {images.map((image) => (
        <DraftThumbnail
          key={image.id}
          image={image}
          remove={() => onRemove(image.id)}
        />
      ))}
    </div>
  );
}

export function MessageImages({ images }: { images: Attachment[] }) {
  return (
    <div className="message-images" role="group" aria-label="Message images">
      {images.map((image) => (
        <Thumbnail
          key={image.id}
          src={attachmentUrl(image.id)}
          name={image.name}
        />
      ))}
    </div>
  );
}
