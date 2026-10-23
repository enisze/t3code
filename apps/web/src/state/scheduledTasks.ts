import { createScheduledTaskEnvironmentAtoms } from "@t3tools/client-runtime/state/scheduled-tasks";
import { connectionAtomRuntime } from "../connection/runtime";

export const scheduledTaskEnvironment = createScheduledTaskEnvironmentAtoms(connectionAtomRuntime);
