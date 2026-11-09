import type { NextRequest } from 'next/server';
import { documentApi } from '@/server/api';

/** Finishes an upload: checks the stored object, marks it uploaded, queues indexing. */
export async function POST(
  request: NextRequest,
  context: RouteContext<'/api/workspaces/[id]/documents/[docId]/confirm'>,
): Promise<Response> {
  const { id, docId } = await context.params;
  return documentApi().confirmUpload(request, id, docId);
}
