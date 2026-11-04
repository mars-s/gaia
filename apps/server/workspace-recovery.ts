import type { Context } from "@earendil-works/chord";
import { createModels } from "@earendil-works/pi-ai";
import {
  Harness,
  type ConversationId,
  type HarnessOptions,
  type Storage,
  type SubmissionId,
  type TaskId,
  type ToolRegistration,
} from "@earendil-works/pi-durable";

export type InterruptedWork = {
  tasks: { taskId: TaskId; conversationId: ConversationId }[];
  submissions: {
    submissionId: SubmissionId;
    conversationId: ConversationId;
    requestId?: string;
  }[];
};

export async function openRecoveredHarness<Tool extends ToolRegistration>(
  storage: Storage,
  options: HarnessOptions<Tool>,
  context: Context,
): Promise<{ harness: Harness; interrupted: InterruptedWork }> {
  const offlineModels = createModels();
  let recovered = false;
  const harness = await Harness.open(
    storage,
    {
      ...options,
      models: () =>
        recovered
          ? typeof options.models === "function"
            ? options.models()
            : options.models
          : offlineModels,
    },
    context,
  );
  try {
    const interrupted = await recoverInterruptedWork(harness, context);
    recovered = true;
    return { harness, interrupted };
  } catch (error) {
    await harness.close(context);
    throw error;
  }
}

async function recoverInterruptedWork(
  harness: Harness,
  context: Context,
): Promise<InterruptedWork> {
  const interrupted = await harness.inspect(context);
  if (interrupted.scheduling !== "paused")
    throw new Error(
      "Interrupted work must be recovered before the Harness scheduler resumes.",
    );
  const result: InterruptedWork = {
    tasks: interrupted.tasks.map(({ record }) => ({
      taskId: record.id,
      conversationId: record.conversationId,
    })),
    submissions: interrupted.submissions.map((record) => ({
      submissionId: record.id,
      conversationId: record.conversationId,
      ...(record.requestId === undefined
        ? {}
        : { requestId: record.requestId }),
    })),
  };
  for (const submission of interrupted.submissions)
    if (submission.status === "queued")
      await harness.abortSubmission(submission.id, context);
  for (const { record } of interrupted.tasks)
    await harness.abortTask(record.id, context);
  harness.resume();
  // waitForIdle excludes background tasks. Join every interrupted task explicitly.
  await Promise.all(
    result.tasks.map(({ taskId }) => harness.waitForTask(taskId, context)),
  );
  const remaining = await harness.inspect(context);
  if (remaining.tasks.length || remaining.submissions.length)
    throw new Error(
      "Interrupted work did not settle. Do not admit new user actions.",
    );
  return result;
}
