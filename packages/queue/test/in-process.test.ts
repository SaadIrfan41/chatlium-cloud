import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { createInProcessQueue } from '../src/index.ts';
import { describeQueueContract, jobSchema } from './contract.ts';

describeQueueContract(
  'in-process',
  ({ kind, maxReceiveCount, visibilityTimeoutMs }) => {
    const queue = createInProcessQueue({
      kind,
      schema: jobSchema,
      maxReceiveCount,
      visibilityTimeoutMs,
    });
    return Promise.resolve({
      queue,
      deadLetters: () => Promise.resolve(queue.deadLetters().map((letter) => letter.body)),
      close: () => Promise.resolve(),
    });
  },
  { visibilityTimeoutMs: 100, waitMs: 2000, quietMs: 150 },
);

describe('in-process adapter specifics', () => {
  it('a stale receipt from a timed-out delivery cannot ack the redelivered message', async () => {
    const queue = createInProcessQueue({
      kind: 'standard',
      schema: jobSchema,
      maxReceiveCount: 5,
      visibilityTimeoutMs: 30,
    });
    const deliveries: { receipt: string; receiveCount: number }[] = [];
    const firstDelivery = Promise.withResolvers<void>();
    const consumer = queue.consume(
      (message) => {
        deliveries.push({ receipt: message.receipt, receiveCount: message.receiveCount });
        return message.receiveCount === 1
          ? firstDelivery.promise
          : new Promise<void>(() => undefined);
      },
      { concurrency: 2 },
    );

    const { messageId } = await queue.publish({ jobId: 'stale', step: 1 });
    await vi.waitFor(() => {
      expect(deliveries).toHaveLength(2);
    });
    const [first, second] = deliveries;

    expect(first?.receipt).not.toBe(second?.receipt);
    const staleAck = await queue.ack({
      messageId,
      body: { jobId: 'stale', step: 1 },
      groupId: undefined,
      attributes: {},
      receiveCount: 1,
      receipt: first?.receipt ?? '',
    });
    expect(staleAck).toBe(false);
    firstDelivery.resolve();
    void consumer.stop();
  });

  it('whenIdle resolves once everything is handled', async () => {
    const queue = createInProcessQueue({
      kind: 'standard',
      schema: jobSchema,
      maxReceiveCount: 3,
      visibilityTimeoutMs: 1000,
    });
    const handled: string[] = [];
    const consumer = queue.consume(async (message) => {
      await sleep(5);
      handled.push(message.body.jobId);
    });

    await Promise.all(['a', 'b', 'c'].map((jobId) => queue.publish({ jobId, step: 1 })));
    await queue.whenIdle();

    expect(handled.toSorted()).toEqual(['a', 'b', 'c']);
    await consumer.stop();
  });

  it('a duplicate is accepted again once the deduplication window has passed', async () => {
    let clock = 1_000_000;
    const queue = createInProcessQueue({
      kind: 'fifo',
      schema: jobSchema,
      maxReceiveCount: 3,
      visibilityTimeoutMs: 1000,
      deduplicationWindowMs: 5 * 60 * 1000,
      now: () => clock,
    });

    const first = await queue.publish(
      { jobId: 'j', step: 1 },
      { groupId: 'g', deduplicationId: 'd' },
    );
    clock += 5 * 60 * 1000 - 1;
    const inside = await queue.publish(
      { jobId: 'j', step: 1 },
      { groupId: 'g', deduplicationId: 'd' },
    );
    clock += 1;
    const after = await queue.publish(
      { jobId: 'j', step: 1 },
      { groupId: 'g', deduplicationId: 'd' },
    );

    expect(inside).toEqual({ messageId: first.messageId, duplicate: true });
    expect(after.duplicate).toBe(false);
    expect(after.messageId).not.toBe(first.messageId);
  });

  it('rejects deduplication on a standard queue and invalid limits', async () => {
    const queue = createInProcessQueue({
      kind: 'standard',
      schema: jobSchema,
      maxReceiveCount: 1,
      visibilityTimeoutMs: 1000,
    });

    await expect(queue.publish({ jobId: 'j', step: 1 }, { deduplicationId: 'd' })).rejects.toThrow(
      /deduplication is FIFO-only/,
    );
    expect(() =>
      createInProcessQueue({
        kind: 'standard',
        schema: jobSchema,
        maxReceiveCount: 0,
        visibilityTimeoutMs: 1000,
      }),
    ).toThrow(/maxReceiveCount must be a positive integer/);
    expect(() => queue.consume(() => Promise.resolve(), { concurrency: 0 })).toThrow(
      /concurrency must be a positive integer/,
    );
  });
});
