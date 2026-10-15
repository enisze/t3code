import { ShowDiffInput } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";

export class ShowDiffError extends Schema.TaggedErrorClass<ShowDiffError>()("ShowDiffError", {
  message: Schema.String,
}) {}

export const ShowDiffResult = Schema.Struct({
  shown: Schema.Boolean,
}).annotate({ description: "The diff is now shown inline in the user's chat." });

export const ShowDiffTool = Tool.make("show_diff", {
  description:
    "Show the user a diff viewer inline in the chat. Call this when the user asks to see the diff, the changes, or what was changed. The viewer renders live from the workspace's git state, so do not also paste the patch into your reply; a short summary is enough.",
  parameters: ShowDiffInput,
  success: ShowDiffResult,
  failure: ShowDiffError,
  dependencies: [McpInvocationContext.McpInvocationContext],
})
  .annotate(Tool.Title, "Show diff in chat")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const DiffToolkit = Toolkit.make(ShowDiffTool);
