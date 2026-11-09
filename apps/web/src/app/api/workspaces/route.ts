import type { NextRequest } from 'next/server';
import { workspaceApi } from '@/server/api';

/** The signed-in user's workspaces and their role in each. */
export function GET(request: NextRequest): Promise<Response> {
  return workspaceApi().listWorkspaces(request);
}
