/**
 * The queue abstraction (decision record: SQS behind a `MessageQueue` interface).
 *
 * Semantics follow Amazon SQS, so the in-process adapter and the SQS adapter (Phase 3) pass the
 * same contract tests (amendments §3):
 * - At-least-once delivery. A handler can see a message more than once; consumers stay
 *   idempotent through `processed_messages`, not through the queue.
 * - FIFO queues: messages with the same `groupId` are delivered one at a time, in publish order.
 *   Different groups are processed concurrently. A `deduplicationId` seen again within the
 *   deduplication window is accepted but not enqueued a second time.
 * - Visibility timeout: a message whose handler neither finishes nor fails within the timeout
 *   becomes visible again and is redelivered.
 * - Dead-letter queue: a message received `maxReceiveCount` times without success moves to the
 *   dead-letter queue instead of being retried forever.
 */

export type QueueKind = 'fifo' | 'standard';

export interface PublishOptions {
  /** FIFO only, and required there: ordering applies within a group (chat: the conversation ID). */
  readonly groupId?: string;
  /** FIFO only, and required there: repeats within the deduplication window are dropped. */
  readonly deduplicationId?: string;
  /** String metadata carried alongside the body, such as W3C `traceparent`. */
  readonly attributes?: Readonly<Record<string, string>>;
}

export interface PublishResult {
  readonly messageId: string;
  /** True when a FIFO deduplication ID was already seen and nothing new was enqueued. */
  readonly duplicate: boolean;
}

export interface ReceivedMessage<T> {
  readonly messageId: string;
  readonly body: T;
  readonly groupId: string | undefined;
  readonly attributes: Readonly<Record<string, string>>;
  /** 1 on first delivery. Grows on every redelivery. */
  readonly receiveCount: number;
  /** Identifies this delivery. A stale receipt (from an earlier, timed-out delivery) is ignored. */
  readonly receipt: string;
}

export type MessageHandler<T> = (message: ReceivedMessage<T>) => Promise<void>;

export interface ConsumeOptions {
  /** Messages handled at the same time. FIFO groups still see one message at a time. */
  readonly concurrency?: number;
}

export interface Consumer {
  /** Stops taking new messages and waits for in-flight handlers to settle. */
  stop(): Promise<void>;
}

export interface MessageQueue<T> {
  readonly kind: QueueKind;
  publish(body: T, options?: PublishOptions): Promise<PublishResult>;
  /**
   * Delivers messages to `handler`. A handler that resolves acks the message; one that throws
   * nacks it, so it is redelivered until `maxReceiveCount` and then dead-lettered.
   */
  consume(handler: MessageHandler<T>, options?: ConsumeOptions): Consumer;
  /** Deletes a delivered message. Returns false for a stale or unknown receipt. */
  ack(message: ReceivedMessage<T>): Promise<boolean>;
  /** Makes a delivered message visible again after `delayMs`. False for a stale receipt. */
  nack(message: ReceivedMessage<T>, options?: { readonly delayMs?: number }): Promise<boolean>;
}

/** Thrown by `publish` for a body that fails the queue's schema or options that break its kind. */
export class InvalidMessageError extends Error {
  constructor(reason: string) {
    super(`Invalid message: ${reason}`);
    this.name = 'InvalidMessageError';
  }
}
