import { FileTextIcon, UserRoundIcon } from 'lucide-react';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker';
import { Message, MessageContent, MessageFooter, MessageGroup } from '@/components/ui/message';

/**
 * A sample conversation that shows what Chatlium does: answer from a document, then hand over
 * to a person when no document covers the question.
 */
export function ConversationPreview() {
  return (
    <figure className="flex w-full flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
      <figcaption className="text-sm text-muted-foreground">
        A visitor on an online shop, answered from the shop’s own documents
      </figcaption>
      <MessageGroup className="flex flex-col gap-3">
        <Message align="end">
          <MessageContent>
            <Bubble align="end" variant="secondary">
              <BubbleContent>Can I change my delivery address after the order ships?</BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
        <Message>
          <MessageContent>
            <Bubble variant="answer">
              <BubbleContent>
                Yes, until the parcel reaches your local depot. Open Track order and choose Change
                address. After that, the courier can hold it for you to collect.
              </BubbleContent>
            </Bubble>
            <MessageFooter className="gap-1.5">
              <FileTextIcon aria-hidden="true" className="size-3.5" />
              <span>Source: Shipping policy, section 4</span>
            </MessageFooter>
          </MessageContent>
        </Message>
        <Message align="end">
          <MessageContent>
            <Bubble align="end" variant="secondary">
              <BubbleContent>It’s already at the depot. Can someone call me?</BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
      </MessageGroup>
      <Marker variant="handoff">
        <MarkerIcon>
          <UserRoundIcon />
        </MarkerIcon>
        <MarkerContent>
          No document covers phone calls from the depot, so Priya from support is taking over.
        </MarkerContent>
      </Marker>
    </figure>
  );
}
