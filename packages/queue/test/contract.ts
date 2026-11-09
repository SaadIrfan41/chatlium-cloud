/**
 * The queue contract (amendments §3, build guide 2.1). Every `MessageQueue` adapter runs this
 * same suite: the in-process adapter in unit tests now, and the SQS adapter against Floci (and,
 * before the production demo, real SQS) from Phase 3.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { MessageQueue, QueueKind, ReceivedMessage } from '../src/index.ts';

export const jobSchema = z.object({ jobId: z.string().min(1), step: z.number().int() });
export type Job = z.infer<typeof jobSchema>;

export interface QueueUnderTest {
  readonly queue: MessageQueue<Job>;
  /** Bodies in the dead-letter queue. */
  deadLetters(): Promise<readonly unknown[]>;
  close(): Promise<void>;
}

export interface ContractTiming {
  /** The visibility timeout the factory configures. SQS counts whole seconds. */
  readonly visibilityTimeoutMs: number;
  /** How long to wait for something to happen before failing. */
  readonly waitMs: number;
  /** How long to watch for something that must NOT happen (a second delivery). */
  readonly quietMs: number;
}

export type QueueFactory = (config: {
  readonly kind: QueueKind;
  readonly maxReceiveCount: number;
  readonly visibilityTimeoutMs: number;
}) => Promise<QueueUnderTest>;

/** Waits until `condition` holds, polling every 5 ms (Vitest's own `vi.waitFor`). */
async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs: number) {
  await vi.waitFor(
    async () => {
      expect(await condition()).toBe(true);
    },
    { timeout: timeoutMs, interval: 5 },
  );
}

const fifo = (group: string, id: string) => ({ groupId: group, deduplicationId: id });

export function describeQueueContract(
  adapter: string,
  factory: QueueFactory,
  timing: ContractTiming,
): void {
  describe(`MessageQueue contract: ${adapter}`, () => {
    const open: QueueUnderTest[] = [];
    async function start(kind: QueueKind, maxReceiveCount = 3): Promise<QueueUnderTest> {
      const subject = await factory({
        kind,
        maxReceiveCount,
        visibilityTimeoutMs: timing.visibilityTimeoutMs,
      });
      open.push(subject);
      return subject;
    }
    afterEach(async () => {
      await Promise.all(open.splice(0).map((subject) => subject.close()));
    });

    it.each(['standard', 'fifo'] as const)(
      '%s: publish then consume delivers the message exactly once',
      async (kind) => {
        const { queue } = await start(kind);
        const seen: ReceivedMessage<Job>[] = [];
        const consumer = queue.consume((message) => {
          seen.push(message);
          return Promise.resolve();
        });

        const attributes = { traceparent: 'tp-1' };
        await queue.publish(
          { jobId: 'job-1', step: 1 },
          kind === 'fifo' ? { ...fifo('g', 'job-1'), attributes } : { attributes },
        );
        await waitFor(() => seen.length === 1, timing.waitMs);
        await sleep(timing.quietMs);

        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({ body: { jobId: 'job-1', step: 1 }, receiveCount: 1 });
        expect(seen[0]?.attributes).toEqual(attributes);
        await consumer.stop();
      },
    );

    it('a handler that throws is redelivered up to the limit, then dead-lettered', async () => {
      const subject = await start('standard', 3);
      const counts: number[] = [];
      const consumer = subject.queue.consume((message) => {
        counts.push(message.receiveCount);
        return Promise.reject(new Error('handler failure'));
      });

      await subject.queue.publish({ jobId: 'poison', step: 1 });
      await waitFor(async () => (await subject.deadLetters()).length === 1, timing.waitMs);
      await sleep(timing.quietMs);

      expect(counts).toEqual([1, 2, 3]);
      expect(await subject.deadLetters()).toEqual([{ jobId: 'poison', step: 1 }]);
      await consumer.stop();
    });

    it('a handler that fails once succeeds on redelivery and is not dead-lettered', async () => {
      const subject = await start('standard', 3);
      const counts: number[] = [];
      const consumer = subject.queue.consume((message) => {
        counts.push(message.receiveCount);
        return message.receiveCount === 1
          ? Promise.reject(new Error('transient'))
          : Promise.resolve();
      });

      await subject.queue.publish({ jobId: 'flaky', step: 1 });
      await waitFor(() => counts.length === 2, timing.waitMs);
      await sleep(timing.quietMs);

      expect(counts).toEqual([1, 2]);
      expect(await subject.deadLetters()).toEqual([]);
      await consumer.stop();
    });

    it('fifo: messages in one group are processed in publish order', async () => {
      const { queue } = await start('fifo');
      const order: string[] = [];
      const consumer = queue.consume(
        async (message) => {
          // Uneven handler times would reorder messages if the group were not serialized.
          await sleep(message.body.step % 2 === 0 ? 1 : 15);
          order.push(`${message.groupId ?? '?'}:${String(message.body.step)}`);
        },
        { concurrency: 4 },
      );

      for (let step = 1; step <= 5; step += 1) {
        // oxlint-disable-next-line no-await-in-loop -- publish order is what is under test
        await queue.publish({ jobId: `a-${String(step)}`, step }, fifo('a', `a-${String(step)}`));
        // oxlint-disable-next-line no-await-in-loop -- interleave a second group
        await queue.publish({ jobId: `b-${String(step)}`, step }, fifo('b', `b-${String(step)}`));
      }
      await waitFor(() => order.length === 10, timing.waitMs);

      expect(order.filter((entry) => entry.startsWith('a:'))).toEqual([
        'a:1',
        'a:2',
        'a:3',
        'a:4',
        'a:5',
      ]);
      expect(order.filter((entry) => entry.startsWith('b:'))).toEqual([
        'b:1',
        'b:2',
        'b:3',
        'b:4',
        'b:5',
      ]);
      await consumer.stop();
    });

    it('fifo: two consumers process different groups at the same time, never one group twice', async () => {
      const { queue } = await start('fifo');
      const active = new Map<string, number>();
      let maxAcrossGroups = 0;
      let maxWithinGroup = 0;
      const handler = async (message: ReceivedMessage<Job>): Promise<void> => {
        const group = message.groupId ?? '?';
        active.set(group, (active.get(group) ?? 0) + 1);
        maxWithinGroup = Math.max(maxWithinGroup, ...active.values());
        maxAcrossGroups = Math.max(
          maxAcrossGroups,
          [...active.values()].filter((count) => count > 0).length,
        );
        await sleep(20);
        active.set(group, (active.get(group) ?? 1) - 1);
      };
      const consumers = [queue.consume(handler), queue.consume(handler)];

      await Promise.all(
        ['x', 'y'].flatMap((group) =>
          [1, 2, 3].map((step) =>
            queue.publish(
              { jobId: `${group}-${String(step)}`, step },
              fifo(group, `${group}-${String(step)}`),
            ),
          ),
        ),
      );
      await waitFor(() => maxAcrossGroups === 2, timing.waitMs);
      await Promise.all(consumers.map((consumer) => consumer.stop()));

      expect(maxAcrossGroups).toBe(2);
      expect(maxWithinGroup).toBe(1);
    });

    it('fifo: a duplicate send within the deduplication window is not delivered again', async () => {
      const { queue } = await start('fifo');
      const seen: string[] = [];
      const consumer = queue.consume((message) => {
        seen.push(message.messageId);
        return Promise.resolve();
      });

      const first = await queue.publish({ jobId: 'dup', step: 1 }, fifo('g', 'dup'));
      const second = await queue.publish({ jobId: 'dup', step: 1 }, fifo('g', 'dup'));
      await waitFor(() => seen.length >= 1, timing.waitMs);
      await sleep(timing.quietMs);

      expect(second).toEqual({ messageId: first.messageId, duplicate: true });
      expect(first.duplicate).toBe(false);
      expect(seen).toEqual([first.messageId]);
      await consumer.stop();
    });

    it('an unacknowledged message reappears after the visibility timeout', async () => {
      const { queue } = await start('standard', 5);
      const counts: number[] = [];
      const firstDelivery = Promise.withResolvers<void>();
      const consumer = queue.consume(
        (message) => {
          counts.push(message.receiveCount);
          if (message.receiveCount === 1) {
            // Outlive the visibility timeout, as a stuck handler would.
            return firstDelivery.promise;
          }
          return Promise.resolve();
        },
        { concurrency: 2 },
      );

      await queue.publish({ jobId: 'slow', step: 1 });
      await waitFor(() => counts.length === 2, timing.visibilityTimeoutMs + timing.waitMs);
      firstDelivery.resolve();
      await sleep(timing.quietMs);

      expect(counts).toEqual([1, 2]);
      await consumer.stop();
    });

    it('a crashed consumer’s in-flight message is processed after recovery, once in effect', async () => {
      const { queue } = await start('fifo', 5);
      // The idempotency record a real worker keeps in processed_messages.
      const processed = new Set<string>();
      const sideEffects: string[] = [];

      const crashed = queue.consume((message) => {
        sideEffects.push(message.body.jobId);
        processed.add(message.body.jobId);
        // The process dies here, after the side effect but before the ack.
        return new Promise<void>(() => undefined);
      });
      await queue.publish({ jobId: 'job-crash', step: 1 }, fifo('conv-1', 'job-crash'));
      await waitFor(() => processed.size === 1, timing.waitMs);
      void crashed.stop();

      const recovered: number[] = [];
      const consumer = queue.consume((message) => {
        recovered.push(message.receiveCount);
        if (!processed.has(message.body.jobId)) {
          sideEffects.push(message.body.jobId);
          processed.add(message.body.jobId);
        }
        return Promise.resolve();
      });
      await waitFor(() => recovered.length === 1, timing.visibilityTimeoutMs + timing.waitMs);
      await sleep(timing.quietMs);

      expect(recovered).toEqual([2]);
      expect(sideEffects).toEqual(['job-crash']);
      await consumer.stop();
    });

    it('a consumer that is stopping takes no new messages while it finishes in-flight work', async () => {
      const { queue } = await start('standard');
      const inFlight = Promise.withResolvers<void>();
      const stoppingSaw: string[] = [];
      const stopping = queue.consume(
        (message) => {
          stoppingSaw.push(message.body.jobId);
          return message.body.jobId === 'in-flight' ? inFlight.promise : Promise.resolve();
        },
        { concurrency: 2 },
      );
      await queue.publish({ jobId: 'in-flight', step: 1 });
      await waitFor(() => stoppingSaw.length === 1, timing.waitMs);
      const stopped = stopping.stop();

      const activeSaw: string[] = [];
      const active = queue.consume((message) => {
        activeSaw.push(message.body.jobId);
        return Promise.resolve();
      });
      await queue.publish({ jobId: 'during-stop', step: 1 });
      await waitFor(() => activeSaw.length === 1, timing.waitMs);
      inFlight.resolve();
      await stopped;

      expect(stoppingSaw).toEqual(['in-flight']);
      expect(activeSaw).toEqual(['during-stop']);
      await active.stop();
    });

    it('rejects a body that does not match the schema, and FIFO sends without group or dedup ID', async () => {
      const standard = await start('standard');
      const fifoQueue = await start('fifo');

      await expect(standard.queue.publish({ jobId: '', step: 1.5 })).rejects.toThrow(
        /Invalid message/,
      );
      await expect(fifoQueue.queue.publish({ jobId: 'j', step: 1 })).rejects.toThrow(
        /groupId and a deduplicationId/,
      );
    });
  });
}
