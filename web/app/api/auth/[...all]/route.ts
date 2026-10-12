import { toNextJsHandler } from "better-auth/next-js";

import { getApplication } from "@/server/application";

export async function GET(request: Request): Promise<Response> {
  return toNextJsHandler(getApplication().auth).GET(request);
}

export async function POST(request: Request): Promise<Response> {
  return toNextJsHandler(getApplication().auth).POST(request);
}
