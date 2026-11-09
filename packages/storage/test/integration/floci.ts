import { CreateBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

/** Same image as docker-compose.yml. */
export const FLOCI_IMAGE =
  'floci/floci:2.4.0@sha256:5ee85db604c4aa74ac76e07ea5cc83086f37bb472bf3dbb97e34019e48efae9c';
export const FLOCI_REGION = 'us-east-1';

export interface StartedFloci {
  readonly container: StartedTestContainer;
  readonly endpoint: string;
  createBucket(name: string): Promise<void>;
  /** Writes an object directly, bypassing presigned URLs (to stage what a client could not). */
  putObject(bucket: string, key: string, body: Uint8Array, contentType: string): Promise<void>;
  stop(): Promise<void>;
}

/**
 * A throwaway Floci for integration tests, verifying SigV4 signatures as AWS does (Floci's default
 * skips that, and a tampered presigned URL would then be accepted). Uses Floci's `test` key.
 */
export async function startFloci(): Promise<StartedFloci> {
  const container = await new GenericContainer(FLOCI_IMAGE)
    .withEnvironment({ FLOCI_DEFAULT_REGION: FLOCI_REGION, FLOCI_AUTH_VALIDATE_SIGNATURES: 'true' })
    .withExposedPorts(4566)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
  const endpoint = `http://${container.getHost()}:${String(container.getMappedPort(4566))}`;
  process.env['AWS_ACCESS_KEY_ID'] = 'test';
  process.env['AWS_SECRET_ACCESS_KEY'] = 'test';
  const s3 = new S3Client({ region: FLOCI_REGION, endpoint, forcePathStyle: true });
  return {
    container,
    endpoint,
    async createBucket(name) {
      await s3.send(new CreateBucketCommand({ Bucket: name }));
    },
    async putObject(bucket, key, body, contentType) {
      await s3.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },
    stop: async () => {
      s3.destroy();
      await container.stop();
    },
  };
}
