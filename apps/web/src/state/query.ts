import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useEffect, useRef } from "react";

const EMPTY_ASYNC_RESULT_ATOM = Atom.make(AsyncResult.initial<never, never>(false)).pipe(
  Atom.withLabel("web-environment-query:empty"),
);

export interface EnvironmentQueryView<A> {
  readonly data: A | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
}

function formatError(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The environment request failed.";
}

export function useEnvironmentQuery<A, E>(
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>> | null,
): EnvironmentQueryView<A> {
  const selectedAtom = atom ?? EMPTY_ASYNC_RESULT_ATOM;
  const result = useAtomValue(selectedAtom);
  const refresh = useAtomRefresh(selectedAtom);

  // An interruption isn't a real failure — the request was cancelled (e.g. a
  // superseded query, or a component that remounted mid-flight). Surfacing it as
  // an error shows the runtime's "All fibers interrupted without error" text; a
  // stuck interrupted result instead re-runs so the query recovers.
  const isFailure = result._tag === "Failure";
  const interruptedOnly = isFailure && Cause.hasInterruptsOnly(result.cause);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  // Re-run a stuck interrupted query once so a cancelled request recovers. The
  // retry re-arms only after a non-failure result, so a retry that is itself
  // interrupted can't spin.
  const recoveredRef = useRef(false);
  useEffect(() => {
    if (interruptedOnly) {
      if (recoveredRef.current) return;
      recoveredRef.current = true;
      refreshRef.current();
    } else if (!isFailure) {
      recoveredRef.current = false;
    }
  }, [interruptedOnly, isFailure]);

  return {
    data: Option.getOrNull(AsyncResult.value(result)),
    error: result._tag === "Failure" && !interruptedOnly ? formatError(result.cause) : null,
    isPending: (atom !== null && result.waiting) || interruptedOnly,
    refresh,
  };
}
