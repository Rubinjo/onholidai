import "server-only";

import { Client, Connection } from "@temporalio/client";

let clientPromise: Promise<Client> | undefined;

export function getWorkflowClient(): Promise<Client> {
  return (clientPromise ??= (async () => {
    const address = process.env.TEMPORAL_ADDRESS;
    if (!address) throw new Error("TEMPORAL_ADDRESS is required to start booking workflows");
    const connection = await Connection.connect({ address });
    return new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE ?? "default" });
  })());
}

export async function startWorkflow<T extends object>(
  workflowType: string,
  workflowId: string,
  taskQueue: string,
  args: T,
) {
  const client = await getWorkflowClient();
  return client.workflow.start(workflowType, {
    workflowId,
    taskQueue,
    args: [args],
    workflowIdReusePolicy: "REJECT_DUPLICATE",
  });
}
