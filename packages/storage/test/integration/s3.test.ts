import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createS3Storage, type ObjectStorage } from '../../src/index.ts';
import { FLOCI_REGION, startFloci, type StartedFloci } from './floci.ts';

const BUCKET = 'chatlium-documents-test';

let floci: StartedFloci;
let storage: ObjectStorage;

beforeAll(async () => {
  floci = await startFloci();
  await floci.createBucket(BUCKET);
  storage = createS3Storage({ bucket: BUCKET, region: FLOCI_REGION, endpoint: floci.endpoint });
});

afterAll(async () => {
  await floci.stop();
});

const body = new TextEncoder().encode('Refunds are issued within 14 days.\n');

async function put(url: string, headers: Record<string, string>, payload: Uint8Array) {
  return fetch(url, { method: 'PUT', headers, body: payload });
}

describe('S3 storage (Floci)', () => {
  it('a presigned PUT with the declared type and size stores the object', async () => {
    const upload = await storage.presignPut('workspaces/w1/documents/d1', {
      contentType: 'text/plain',
      contentLength: body.byteLength,
      expiresInSeconds: 300,
    });

    const response = await put(upload.url, upload.headers, body);

    expect(response.status).toBe(200);
    expect(await storage.head('workspaces/w1/documents/d1')).toEqual({
      sizeBytes: body.byteLength,
      contentType: 'text/plain',
    });
    expect(new TextDecoder().decode(await storage.get('workspaces/w1/documents/d1'))).toBe(
      'Refunds are issued within 14 days.\n',
    );
  });

  it('refuses an upload larger than the signed length', async () => {
    const upload = await storage.presignPut('workspaces/w1/documents/d2', {
      contentType: 'text/plain',
      contentLength: 10,
      expiresInSeconds: 300,
    });

    const response = await put(upload.url, upload.headers, body);

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await storage.head('workspaces/w1/documents/d2')).toBeUndefined();
  });

  it('refuses an upload with a different content type than signed', async () => {
    const upload = await storage.presignPut('workspaces/w1/documents/d3', {
      contentType: 'text/plain',
      contentLength: body.byteLength,
      expiresInSeconds: 300,
    });

    const response = await put(upload.url, { 'content-type': 'application/pdf' }, body);

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await storage.head('workspaces/w1/documents/d3')).toBeUndefined();
  });

  it('refuses a tampered URL (signature covers the key)', async () => {
    const upload = await storage.presignPut('workspaces/w1/documents/d4', {
      contentType: 'text/plain',
      contentLength: body.byteLength,
      expiresInSeconds: 300,
    });

    const response = await put(
      upload.url.replace('workspaces/w1/documents/d4', 'workspaces/w2/documents/d4'),
      upload.headers,
      body,
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await storage.head('workspaces/w2/documents/d4')).toBeUndefined();
  });

  it('refuses an expired URL', async () => {
    const upload = await storage.presignPut('workspaces/w1/documents/d5', {
      contentType: 'text/plain',
      contentLength: body.byteLength,
      expiresInSeconds: 1,
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 2100);
    });

    const response = await put(upload.url, upload.headers, body);

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await storage.head('workspaces/w1/documents/d5')).toBeUndefined();
  });

  it('head returns undefined for a missing object', async () => {
    expect(await storage.head('workspaces/w1/documents/missing')).toBeUndefined();
  });
});
