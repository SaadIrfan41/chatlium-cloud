import {
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** A presigned upload: the client sends exactly these headers with a PUT of the body. */
export interface PresignedUpload {
  readonly url: string;
  readonly method: 'PUT';
  /** Signed headers the client must send unchanged. */
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
}

export interface StoredObject {
  readonly sizeBytes: number;
  readonly contentType: string | undefined;
}

export interface ObjectStorage {
  /**
   * A URL that lets a client PUT one object at `key`. The content type and the exact length are
   * part of the signature, so a different type or size is refused by S3 itself.
   */
  presignPut(
    key: string,
    options: {
      readonly contentType: string;
      readonly contentLength: number;
      readonly expiresInSeconds: number;
    },
  ): Promise<PresignedUpload>;
  /** Size and type of a stored object, or undefined if there is none. */
  head(key: string): Promise<StoredObject | undefined>;
  /** The object's bytes. Throws if it does not exist. */
  get(key: string): Promise<Uint8Array>;
}

export interface S3StorageOptions {
  readonly bucket: string;
  readonly region: string;
  /** Set for Floci (http://localhost:4566); unset on AWS. */
  readonly endpoint?: string;
  readonly now?: () => Date;
}

export function createS3Storage(options: S3StorageOptions): ObjectStorage {
  const client = new S3Client({
    region: options.region,
    ...(options.endpoint === undefined
      ? {}
      : // Emulators serve buckets by path (host:port/bucket); AWS uses virtual-hosted style.
        { endpoint: options.endpoint, forcePathStyle: true }),
  });
  const now = options.now ?? (() => new Date());

  return {
    async presignPut(key, put): Promise<PresignedUpload> {
      const command = new PutObjectCommand({
        Bucket: options.bucket,
        Key: key,
        ContentType: put.contentType,
        ContentLength: put.contentLength,
      });
      const url = await getSignedUrl(client, command, {
        expiresIn: put.expiresInSeconds,
        // Bind the type and exact length into the signature, so S3 rejects an upload whose
        // type or length differs from what was declared. (Only x-amz-* headers are ever hoisted
        // into the query string, so these stay request headers the client must send.)
        signableHeaders: new Set(['content-type', 'content-length']),
      });
      return {
        url,
        method: 'PUT',
        headers: { 'content-type': put.contentType },
        expiresAt: new Date(now().getTime() + put.expiresInSeconds * 1000),
      };
    },

    async head(key): Promise<StoredObject | undefined> {
      try {
        const object = await client.send(
          new HeadObjectCommand({ Bucket: options.bucket, Key: key }),
        );
        return { sizeBytes: object.ContentLength ?? 0, contentType: object.ContentType };
      } catch (error) {
        if (
          error instanceof NotFound ||
          (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404)
        ) {
          return undefined;
        }
        throw error;
      }
    },

    async get(key): Promise<Uint8Array> {
      const object = await client.send(new GetObjectCommand({ Bucket: options.bucket, Key: key }));
      if (object.Body === undefined) {
        throw new Error('object has no body');
      }
      return object.Body.transformToByteArray();
    },
  };
}
