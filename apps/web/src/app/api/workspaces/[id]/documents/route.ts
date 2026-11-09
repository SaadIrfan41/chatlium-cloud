import type { NextRequest } from 'next/server';
import { documentApi, workspaceApi } from '@/server/api';

/** The workspace's documents. Operator role or higher; anything else is the same 403. */
export async function GET(
  request: NextRequest,
  context: RouteContext<'/api/workspaces/[id]/documents'>,
): Promise<Response> {
  const { id } = await context.params;
  return workspaceApi().listDocuments(request, id);
}

/** Starts an upload: a pending document and a presigned PUT URL. Operator role or higher. */
export async function POST(
  request: NextRequest,
  context: RouteContext<'/api/workspaces/[id]/documents'>,
): Promise<Response> {
  const { id } = await context.params;
  return documentApi().createDocument(request, id);
}
