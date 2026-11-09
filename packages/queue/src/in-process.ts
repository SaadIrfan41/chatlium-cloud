import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import {
  InvalidMessageError,
  type Consumer,
  type ConsumeOptions,
  type MessageHandler,
  type MessageQueue,
  type PublishOptions,
  type PublishResult,
  type QueueKind,
  type ReceivedMessage,
} from './types.ts';

/** SQS FIFO's deduplication window. */
export const DEDUPLICATION_WINDOW_MS = 5 * 60 * 1000;

export interface InProcessQueueOptions<S extends z.ZodType> {
  readonly kind: QueueKind;
  /** Every body is validated on publish, and again on delivery (it travels as JSON). */
  readonly schema: S;
  /** Deliveries before a message moves to the dead-letter queue (SQS redrive policy). */
  readonly maxReceiveCount: number;
  /** How long a delivered message stays invisible before it is redelivered. */
  readonly visibilityTimeoutMs: number;
  /** Delay before a nacked message is visible again. */
  readonly retryDelayMs?: number;
  readonly deduplicationWindowMs?: number;
  readonly now?: () => number;
}

export interface DeadLetter {
  readonly messageId: string;
  readonly body: unknown;
  readonly groupId: string | undefined;
  readonly attributes: Readonly<Record<string, string>>;
  readonly receiveCount: number;
}

export interface InProcessQueue<T> extends MessageQueue<T> {
  /** Messages that exceeded `maxReceiveCount`, oldest first. */
  deadLetters(): readonly DeadLetter[];
  /** Resolves once nothing is waiting, delayed or in flight. For tests and orderly shutdown. */
  whenIdle(): Promise<void>;
}

interface Entry {
  readonly messageId: string;
  readonly groupId: string | undefined;
  /** Bodies are stored as JSON, as on a real queue: nothing is shared by reference. */
  readonly json: string;
  readonly attributes: Readonly<Record<string, string>>;
  receiveCount: number;
  visibleAt: number;
  /** Set while delivered and not yet acked, nacked or timed out. */
  receipt: string | undefined;
  visibilityTimer: NodeJS.Timeout | undefined;
}

interface ConsumerState<T> {
  readonly handler: MessageHandler<T>;
  readonly concurrency: number;
  running: number;
  stopping: boolean;
  readonly inFlight: Set<Promise<void>>;
}

/**
 * An in-process `MessageQueue` with SQS semantics (see types.ts). Unit tests use it in every
 * phase; it is also the development queue during Phase 2. Phase 3 replaces it with SQS on Floci
 * for development and integration tests, verified by the same contract suite.
 */
export function createInProcessQueue<S extends z.ZodType>(
  options: InProcessQueueOptions<S>,
): InProcessQueue<z.output<S>> {
  type T = z.output<S>;
  const now = options.now ?? Date.now;
  const retryDelayMs = options.retryDelayMs ?? 0;
  const windowMs = options.deduplicationWindowMs ?? DEDUPLICATION_WINDOW_MS;
  if (!Number.isInteger(options.maxReceiveCount) || options.maxReceiveCount < 1) {
    throw new RangeError('maxReceiveCount must be a positive integer');
  }

  const entries: Entry[] = [];
  const dead: DeadLetter[] = [];
  const seen = new Map<string, { messageId: string; expiresAt: number }>();
  const consumers: ConsumerState<T>[] = [];
  const idleWaiters: (() => void)[] = [];
  let wakeTimer: NodeJS.Timeout | undefined;
  let pumpScheduled = false;
  let nextConsumer = 0;

  const isIdle = (): boolean =>
    entries.length === 0 && consumers.every((consumer) => consumer.running === 0);

  function settleIdleWaiters(): void {
    if (isIdle()) {
      for (const resolve of idleWaiters.splice(0)) {
        resolve();
      }
    }
  }

  function schedulePump(): void {
    if (!pumpScheduled) {
      pumpScheduled = true;
      queueMicrotask(() => {
        pumpScheduled = false;
        pump();
      });
    }
  }

  /** The next deliverable entry, honouring FIFO group order. */
  function nextDeliverable(at: number): Entry | undefined {
    const blockedGroups = new Set<string>();
    for (const entry of entries) {
      if (options.kind === 'fifo' && entry.groupId !== undefined) {
        // Only the head of a group may be delivered; anything behind it waits.
        if (blockedGroups.has(entry.groupId)) {
          continue;
        }
        blockedGroups.add(entry.groupId);
      }
      if (entry.receipt === undefined && entry.visibleAt <= at) {
        return entry;
      }
    }
    return undefined;
  }

  function availableConsumer(): ConsumerState<T> | undefined {
    for (let i = 0; i < consumers.length; i += 1) {
      const consumer = consumers[(nextConsumer + i) % consumers.length];
      if (consumer !== undefined && !consumer.stopping && consumer.running < consumer.concurrency) {
        nextConsumer = (nextConsumer + i + 1) % consumers.length;
        return consumer;
      }
    }
    return undefined;
  }

  function remove(entry: Entry): void {
    clearTimeout(entry.visibilityTimer);
    const index = entries.indexOf(entry);
    if (index !== -1) {
      entries.splice(index, 1);
    }
  }

  function deadLetter(entry: Entry): void {
    remove(entry);
    dead.push({
      messageId: entry.messageId,
      body: JSON.parse(entry.json),
      groupId: entry.groupId,
      attributes: entry.attributes,
      receiveCount: entry.receiveCount,
    });
  }

  function makeVisible(entry: Entry, at: number): void {
    clearTimeout(entry.visibilityTimer);
    entry.visibilityTimer = undefined;
    entry.receipt = undefined;
    entry.visibleAt = at;
  }

  function deliver(entry: Entry, consumer: ConsumerState<T>): void {
    entry.receiveCount += 1;
    const receipt = randomUUID();
    entry.receipt = receipt;
    entry.visibilityTimer = setTimeout(() => {
      // The handler took too long: the message becomes visible and is redelivered.
      if (entry.receipt === receipt) {
        makeVisible(entry, now());
        schedulePump();
      }
    }, options.visibilityTimeoutMs);

    const parsed = options.schema.safeParse(JSON.parse(entry.json));
    if (!parsed.success) {
      // Cannot happen for bodies validated on publish; kept so a bad body never loops.
      deadLetter(entry);
      return;
    }
    const message: ReceivedMessage<T> = {
      messageId: entry.messageId,
      body: parsed.data,
      groupId: entry.groupId,
      attributes: entry.attributes,
      receiveCount: entry.receiveCount,
      receipt,
    };

    consumer.running += 1;
    const run = (async () => {
      try {
        await consumer.handler(message);
        await queue.ack(message);
      } catch {
        await queue.nack(message, { delayMs: retryDelayMs });
      } finally {
        consumer.running -= 1;
        schedulePump();
        settleIdleWaiters();
      }
    })();
    consumer.inFlight.add(run);
    void run.finally(() => consumer.inFlight.delete(run));
  }

  function pump(): void {
    clearTimeout(wakeTimer);
    wakeTimer = undefined;
    for (;;) {
      const at = now();
      const entry = nextDeliverable(at);
      if (entry === undefined) {
        break;
      }
      if (entry.receiveCount >= options.maxReceiveCount) {
        // Received the maximum number of times without success (SQS redrive policy).
        deadLetter(entry);
        continue;
      }
      const consumer = availableConsumer();
      if (consumer === undefined) {
        break;
      }
      deliver(entry, consumer);
    }
    // Wake up for the next message that is delayed after a nack. Messages that are visible but
    // waiting for a free consumer are picked up when a handler finishes.
    const at = now();
    const delayed = entries.filter((entry) => entry.receipt === undefined && entry.visibleAt > at);
    if (delayed.length > 0 && consumers.some((consumer) => !consumer.stopping)) {
      const soonest = Math.min(...delayed.map((entry) => entry.visibleAt));
      wakeTimer = setTimeout(() => schedulePump(), soonest - at);
    }
    settleIdleWaiters();
  }

  function findDelivered(message: ReceivedMessage<T>): Entry | undefined {
    return entries.find(
      (entry) => entry.receipt !== undefined && entry.receipt === message.receipt,
    );
  }

  const queue: InProcessQueue<T> = {
    kind: options.kind,

    publish(body: T, publishOptions: PublishOptions = {}): Promise<PublishResult> {
      const { groupId, deduplicationId, attributes = {} } = publishOptions;
      if (options.kind === 'fifo' && (groupId === undefined || deduplicationId === undefined)) {
        return Promise.reject(
          new InvalidMessageError('a FIFO message needs a groupId and a deduplicationId'),
        );
      }
      if (options.kind === 'standard' && deduplicationId !== undefined) {
        return Promise.reject(new InvalidMessageError('deduplication is FIFO-only'));
      }
      const parsed = options.schema.safeParse(body);
      if (!parsed.success) {
        return Promise.reject(new InvalidMessageError('body does not match the queue schema'));
      }

      const at = now();
      if (deduplicationId !== undefined) {
        for (const [id, record] of seen) {
          if (record.expiresAt <= at) {
            seen.delete(id);
          }
        }
        const previous = seen.get(deduplicationId);
        if (previous !== undefined) {
          return Promise.resolve({ messageId: previous.messageId, duplicate: true });
        }
      }

      const messageId = randomUUID();
      if (deduplicationId !== undefined) {
        seen.set(deduplicationId, { messageId, expiresAt: at + windowMs });
      }
      entries.push({
        messageId,
        groupId,
        json: JSON.stringify(parsed.data),
        attributes: { ...attributes },
        receiveCount: 0,
        visibleAt: at,
        receipt: undefined,
        visibilityTimer: undefined,
      });
      schedulePump();
      return Promise.resolve({ messageId, duplicate: false });
    },

    consume(handler: MessageHandler<T>, consumeOptions: ConsumeOptions = {}): Consumer {
      const concurrency = consumeOptions.concurrency ?? 1;
      if (!Number.isInteger(concurrency) || concurrency < 1) {
        throw new RangeError('concurrency must be a positive integer');
      }
      const state: ConsumerState<T> = {
        handler,
        concurrency,
        running: 0,
        stopping: false,
        inFlight: new Set(),
      };
      consumers.push(state);
      schedulePump();
      return {
        async stop(): Promise<void> {
          state.stopping = true;
          await Promise.allSettled(state.inFlight);
          const index = consumers.indexOf(state);
          if (index !== -1) {
            consumers.splice(index, 1);
          }
          if (consumers.length === 0) {
            clearTimeout(wakeTimer);
            wakeTimer = undefined;
          }
          settleIdleWaiters();
        },
      };
    },

    ack(message: ReceivedMessage<T>): Promise<boolean> {
      const entry = findDelivered(message);
      if (entry === undefined) {
        return Promise.resolve(false);
      }
      remove(entry);
      settleIdleWaiters();
      return Promise.resolve(true);
    },

    nack(message: ReceivedMessage<T>, nackOptions: { delayMs?: number } = {}): Promise<boolean> {
      const entry = findDelivered(message);
      if (entry === undefined) {
        return Promise.resolve(false);
      }
      makeVisible(entry, now() + (nackOptions.delayMs ?? 0));
      schedulePump();
      return Promise.resolve(true);
    },

    deadLetters: () => [...dead],

    whenIdle(): Promise<void> {
      if (isIdle()) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        idleWaiters.push(resolve);
      });
    },
  };

  return queue;
}
