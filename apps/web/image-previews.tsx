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
}: {
  src?: string;
  name: string;
  remove?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <figure className="image-thumbnail">
      {src && !failed ? (
        <img
          src={src}
          alt={name}
          width={80}
          height={80}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="image-unavailable">
          <RiImageLine className="size-5" aria-hidden />
          <span>{src ? "Unavailable" : "Loading"}</span>
        </span>
      )}
      {remove && (
        <button
          type="button"
          className="quiet-action remove-image"
          aria-label={`Remove ${name}`}
          onClick={remove}
        >
          <RiCloseLine className="size-4" aria-hidden />
        </button>
      )}
      <figcaption>
        {name}
        {failed ? ", preview unavailable" : ""}
      </figcaption>
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
  return <Thumbnail src={src} name={image.name} remove={remove} />;
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
