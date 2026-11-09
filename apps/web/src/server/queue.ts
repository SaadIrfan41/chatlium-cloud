import 'server-only';
import { indexingJobSchema, type IndexingJob } from '@chatlium/contracts';
import { createInProcessQueue, type InProcessQueue } from '@chatlium/queue';

let indexing: InProcessQueue<IndexingJob> | undefined;

/**
 * The indexing queue (decision record: SQS Standard). Phase 2 only: an in-process queue inside
 * the web process, consumed by the in-process indexing worker from Step 2.5. Phase 3 replaces it
 * with SQS on Floci and a separate indexing-worker process.
 */
export function indexingQueue(): InProcessQueue<IndexingJob> {
  indexing ??= createInProcessQueue({
    kind: 'standard',
    schema: indexingJobSchema,
    maxReceiveCount: 5,
    visibilityTimeoutMs: 15 * 60 * 1000,
    retryDelayMs: 30 * 1000,
  });
  return indexing;
}
