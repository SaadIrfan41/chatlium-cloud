import 'server-only';
import { createS3Storage, type ObjectStorage } from '@chatlium/storage';
import { config } from './config.ts';

let storage: ObjectStorage | undefined;

/** Document originals in S3 (Floci locally, through AWS_ENDPOINT_URL). */
export function documentStorage(): ObjectStorage {
  if (storage === undefined) {
    const { AWS_REGION, AWS_ENDPOINT_URL, DOCUMENTS_BUCKET } = config();
    storage = createS3Storage({
      bucket: DOCUMENTS_BUCKET,
      region: AWS_REGION,
      ...(AWS_ENDPOINT_URL === undefined ? {} : { endpoint: AWS_ENDPOINT_URL }),
    });
  }
  return storage;
}
