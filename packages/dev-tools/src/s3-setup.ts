/**
 * Creates (or brings back in line) the local documents bucket in Floci (build guide 2.2):
 *   pnpm --filter @chatlium/dev-tools s3:setup
 *
 * Idempotent. The bucket is versioned, closed to public access, and accepts only a browser PUT
 * from the app's own origin (the presigned upload). Refuses to run against real AWS.
 */
import {
  CreateBucketCommand,
  GetBucketCorsCommand,
  GetBucketVersioningCommand,
  HeadBucketCommand,
  NotFound,
  PutBucketCorsCommand,
  PutBucketVersioningCommand,
  PutPublicAccessBlockCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { z } from 'zod';
import { out } from './web-client.ts';

const env = z
  .object({
    AWS_REGION: z.string().min(1),
    AWS_ENDPOINT_URL: z.url({ error: 'must point at Floci, e.g. http://localhost:4566' }),
    APP_BASE_URL: z.url(),
    DOCUMENTS_BUCKET: z.string().min(3),
  })
  .parse(process.env, { reportInput: false });

const endpoint = new URL(env.AWS_ENDPOINT_URL);
if (!['localhost', '127.0.0.1'].includes(endpoint.hostname)) {
  throw new Error(
    `Refusing to run: AWS_ENDPOINT_URL is not a local Floci endpoint (${endpoint.host})`,
  );
}

const s3 = new S3Client({
  region: env.AWS_REGION,
  endpoint: env.AWS_ENDPOINT_URL,
  forcePathStyle: true,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});
const Bucket = env.DOCUMENTS_BUCKET;
const appOrigin = new URL(env.APP_BASE_URL).origin;

async function bucketExists(): Promise<boolean> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket }));
    return true;
  } catch (error) {
    if (
      error instanceof NotFound ||
      (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404)
    ) {
      return false;
    }
    throw error;
  }
}

if (await bucketExists()) {
  out(`bucket ${Bucket}: exists`);
} else {
  await s3.send(new CreateBucketCommand({ Bucket }));
  out(`bucket ${Bucket}: created`);
}

await s3.send(
  new PutPublicAccessBlockCommand({
    Bucket,
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      IgnorePublicAcls: true,
      BlockPublicPolicy: true,
      RestrictPublicBuckets: true,
    },
  }),
);
await s3.send(
  new PutBucketVersioningCommand({ Bucket, VersioningConfiguration: { Status: 'Enabled' } }),
);
await s3.send(
  new PutBucketCorsCommand({
    Bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          // Only the presigned upload runs in the browser; reads go through the API.
          AllowedOrigins: [appOrigin],
          AllowedMethods: ['PUT'],
          AllowedHeaders: ['content-type'],
          MaxAgeSeconds: 300,
        },
      ],
    },
  }),
);

const versioning = await s3.send(new GetBucketVersioningCommand({ Bucket }));
const cors = await s3.send(new GetBucketCorsCommand({ Bucket }));
const rule = cors.CORSRules?.[0];
out(`versioning: ${versioning.Status ?? 'off'}`);
out(
  `CORS: ${(rule?.AllowedMethods ?? []).join(',')} from ${(rule?.AllowedOrigins ?? []).join(',')}`,
);

const ok =
  versioning.Status === 'Enabled' &&
  cors.CORSRules?.length === 1 &&
  rule?.AllowedOrigins?.join() === appOrigin;
out(ok ? 'OK: documents bucket ready.' : 'FAILED');
process.exitCode = ok ? 0 : 1;
