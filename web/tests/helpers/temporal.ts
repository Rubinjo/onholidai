import { TestWorkflowEnvironment } from "@temporalio/testing";

export interface TemporalTestEnvironmentOptions {
  readonly timeSkipping?: boolean;
}

export async function createTemporalTestEnvironment({
  timeSkipping = true,
}: TemporalTestEnvironmentOptions = {}): Promise<TestWorkflowEnvironment> {
  return timeSkipping
    ? TestWorkflowEnvironment.createTimeSkipping()
    : TestWorkflowEnvironment.createLocal();
}

export async function withTemporalTestEnvironment<T>(
  test: (environment: TestWorkflowEnvironment) => Promise<T>,
  options?: TemporalTestEnvironmentOptions,
): Promise<T> {
  const environment = await createTemporalTestEnvironment(options);
  try {
    return await test(environment);
  } finally {
    await environment.teardown();
  }
}