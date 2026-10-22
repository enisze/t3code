import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import type * as Stream from "effect/Stream";

export type ConnectionWakeup =
  | "application-active"
  | "application-active-probe"
  | "application-active-reconnect"
  | "credentials-changed";

export function isApplicationActiveWakeup(reason: ConnectionWakeup): boolean {
  return (
    reason === "application-active" ||
    reason === "application-active-probe" ||
    reason === "application-active-reconnect"
  );
}

/**
 * Whether a wakeup restarts a durable subscription on its current session. A
 * short mobile resume re-reads every stream: the OS may have paused the app
 * while its socket still looked open. A browser or desktop window keeps
 * receiving frames while hidden, so returning to it only restarts a stream that
 * `stopped` on an error; restarting a live one re-syncs it on every focus. A
 * long resume or a failed probe replaces the session, which resubscribes anyway.
 */
export function shouldResubscribeAfterWakeup(reason: ConnectionWakeup, stopped: boolean): boolean {
  return reason === "application-active-probe" || (reason === "application-active" && stopped);
}

export class ConnectionWakeups extends Context.Service<
  ConnectionWakeups,
  {
    readonly changes: Stream.Stream<ConnectionWakeup>;
  }
>()("@t3tools/client-runtime/connection/wakeups/ConnectionWakeups") {}

const make = (service: ConnectionWakeups["Service"]) => ConnectionWakeups.of(service);

export const layer = (service: ConnectionWakeups["Service"]) =>
  Layer.succeed(ConnectionWakeups, make(service));
