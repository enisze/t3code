import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  readCachedPullRequestResolution,
  usePreparePullRequestThreadAction,
  usePullRequestResolution,
} from "~/lib/sourceControlActions";
import { cn } from "~/lib/utils";
import { parsePullRequestReference } from "~/pullRequestReference";
import { getSourceControlPresentation } from "~/sourceControlPresentation";
import { useEnvironmentQuery } from "~/state/query";
import { vcsEnvironment } from "~/state/vcs";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  canAutoSubmitResolvedReference,
  findBranchRefForReference,
  resolveBranchWorktreeTarget,
  resolveTypedBranchWorktreeTarget,
} from "./PullRequestThreadDialog.logic";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Spinner } from "./ui/spinner";

/**
 * How long a headless auto-submit may stay invisible before the dialog is shown.
 * Long enough for a normal resolve + prepare, short enough that a dead end never
 * looks like a frozen UI.
 */
const HEADLESS_REVEAL_TIMEOUT_MS = 10_000;

interface PullRequestThreadDialogProps {
  open: boolean;
  environmentId: EnvironmentId;
  threadId: ThreadId;
  cwd: string | null;
  initialReference: string | null;
  autoSubmitInitialReference?: boolean;
  headless?: boolean;
  onOpenChange: (open: boolean) => void;
  onPrepared: (input: {
    branch: string;
    worktreePath: string | null;
    reuseLocalCheckout?: boolean;
  }) => Promise<boolean>;
}

export function PullRequestThreadDialog({
  open,
  environmentId,
  threadId,
  cwd,
  initialReference,
  autoSubmitInitialReference = false,
  headless = false,
  onOpenChange,
  onPrepared,
}: PullRequestThreadDialogProps) {
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const autoSubmittedRef = useRef(false);
  const [reference, setReference] = useState(initialReference ?? "");
  const [referenceDirty, setReferenceDirty] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  // Failures on the plain "create a worktree from this branch" path aren't
  // reported through any action's `error`, so hold them here to keep a failed
  // "Open worktree" click from looking like a no-op.
  const [createWorktreeError, setCreateWorktreeError] = useState<string | null>(null);
  // A headless auto-submit renders nothing, so a failure there would leave an
  // invisible dialog with an error the user can never see or dismiss. Revealing
  // it turns any dead end back into something clickable.
  const [revealed, setRevealed] = useState(false);
  const [debouncedReference, referenceDebouncer] = useDebouncedValue(
    reference,
    { wait: 450 },
    (debouncerState) => ({ isPending: debouncerState.isPending }),
  );
  const { data: gitStatus } = useEnvironmentQuery(
    cwd === null
      ? null
      : vcsEnvironment.status({
          environmentId,
          input: { cwd },
        }),
  );
  const sourceControlPresentation = useMemo(
    () => getSourceControlPresentation(gitStatus?.sourceControlProvider),
    [gitStatus?.sourceControlProvider],
  );
  const terminology = sourceControlPresentation.terminology;
  const SourceControlIcon = sourceControlPresentation.Icon;

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      referenceInputRef.current?.focus();
      referenceInputRef.current?.select();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [open]);

  const parsedReference = parsePullRequestReference(reference);
  const parsedDebouncedReference = parsePullRequestReference(debouncedReference);
  const sourceControlScope = useMemo(
    () => ({
      environmentId,
      cwd,
    }),
    [cwd, environmentId],
  );
  const pullRequestResolution = usePullRequestResolution({
    ...sourceControlScope,
    reference: open ? parsedDebouncedReference : null,
  });
  const cachedPullRequest = useMemo(() => {
    return (
      readCachedPullRequestResolution({
        ...sourceControlScope,
        reference: parsedReference,
      })?.pullRequest ?? null
    );
  }, [parsedReference, sourceControlScope]);
  const preparePullRequestThreadAction = usePreparePullRequestThreadAction(sourceControlScope);
  const createWorktree = useAtomCommand(vcsEnvironment.createWorktree);
  const branchQuery = useEnvironmentQuery(
    open && cwd && reference.trim()
      ? vcsEnvironment.listRefs({
          environmentId,
          input: { cwd, query: reference.trim(), limit: 20 },
        })
      : null,
  );
  const resolvedBranch = findBranchRefForReference(branchQuery.data?.refs ?? [], reference);
  const listedBranchTarget = useMemo(
    () =>
      cwd && resolvedBranch ? resolveBranchWorktreeTarget({ cwd, ref: resolvedBranch }) : null,
    [cwd, resolvedBranch],
  );
  // A branch nobody here has fetched yet matches no listed ref, so once the
  // lookup has settled without a match the typed name itself becomes the target
  // and the server resolves it against the remotes.
  const typedBranchTarget = useMemo(
    () =>
      cwd && !resolvedBranch && !branchQuery.isPending
        ? resolveTypedBranchWorktreeTarget({
            cwd,
            reference,
            isPullRequestReference: parsedReference !== null,
          })
        : null,
    [branchQuery.isPending, cwd, parsedReference, reference, resolvedBranch],
  );
  const resolvedBranchTarget = listedBranchTarget ?? typedBranchTarget;

  const liveResolvedPullRequest =
    parsedReference !== null && parsedReference === parsedDebouncedReference
      ? (pullRequestResolution.data?.pullRequest ?? null)
      : null;
  const resolvedPullRequest = liveResolvedPullRequest ?? cachedPullRequest;
  const isResolving =
    open &&
    parsedReference !== null &&
    resolvedPullRequest === null &&
    (referenceDebouncer.state.isPending ||
      parsedReference !== parsedDebouncedReference ||
      pullRequestResolution.isPending ||
      pullRequestResolution.isFetching);
  const statusTone = useMemo(() => {
    switch (resolvedPullRequest?.state) {
      case "merged":
        return "text-violet-600 dark:text-violet-300/90";
      case "closed":
        return "text-zinc-500 dark:text-zinc-400/80";
      case "open":
        return "text-emerald-600 dark:text-emerald-300/90";
      default:
        return "text-muted-foreground";
    }
  }, [resolvedPullRequest?.state]);

  const handleConfirm = useCallback(async () => {
    if (!resolvedPullRequest && !resolvedBranchTarget) {
      setReferenceDirty(true);
      setRevealed(true);
      return;
    }
    if (!cwd) {
      setRevealed(true);
      return;
    }
    const targetBranch = resolvedPullRequest?.headBranch ?? resolvedBranchTarget?.branch;
    if (!targetBranch) {
      setRevealed(true);
      return;
    }
    setCreateWorktreeError(null);
    const branchWorktreePath = resolvedPullRequest
      ? null
      : (resolvedBranchTarget?.worktreePath ?? null);
    // A branch already checked out in the primary checkout can't get its own
    // worktree; reuse that checkout as the local workspace instead of failing on
    // `git worktree add`.
    const reuseLocalCheckout =
      !resolvedPullRequest &&
      (resolvedBranchTarget?.reuseExisting ?? false) &&
      branchWorktreePath === null;
    if (
      await onPrepared({
        branch: targetBranch,
        worktreePath: branchWorktreePath,
        reuseLocalCheckout,
      })
    ) {
      onOpenChange(false);
      return;
    }
    setIsPreparing(true);
    // Prefer the server's pull-request path whenever the input names one: it
    // fetches the PR head, configures its upstream, and runs the project setup
    // script. Creating a worktree straight from the typed reference skips all of
    // that and lands the user in an empty worktree.
    if (resolvedPullRequest && parsedReference !== null) {
      const result = await preparePullRequestThreadAction.run({
        reference: parsedReference,
        mode: "worktree",
        threadId,
      });
      setIsPreparing(false);
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) {
          preparePullRequestThreadAction.resetError();
        }
        setRevealed(true);
        return;
      }
      await onPrepared({ branch: result.value.branch, worktreePath: result.value.worktreePath });
    } else {
      if (!resolvedBranchTarget?.createInput) {
        setIsPreparing(false);
        setRevealed(true);
        return;
      }
      const result = await createWorktree({
        environmentId,
        input: resolvedBranchTarget.createInput,
      });
      setIsPreparing(false);
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const failure = squashAtomCommandFailure(result);
          setCreateWorktreeError(
            failure instanceof Error ? failure.message : "Failed to open branch in a worktree.",
          );
        }
        setRevealed(true);
        return;
      }
      await onPrepared({
        branch: result.value.worktree.refName,
        worktreePath: result.value.worktree.path,
      });
    }
    onOpenChange(false);
  }, [
    cwd,
    onOpenChange,
    onPrepared,
    createWorktree,
    environmentId,
    parsedReference,
    preparePullRequestThreadAction,
    resolvedBranchTarget,
    resolvedPullRequest,
    threadId,
  ]);

  const canAutoSubmit = canAutoSubmitResolvedReference({
    isPullRequestReference: parsedReference !== null,
    hasResolvedPullRequest: resolvedPullRequest !== null,
    hasResolvedBranch: Boolean(resolvedBranchTarget),
  });

  useEffect(() => {
    if (!autoSubmitInitialReference || autoSubmittedRef.current || isPreparing || !canAutoSubmit) {
      return;
    }
    autoSubmittedRef.current = true;
    void handleConfirm();
  }, [autoSubmitInitialReference, canAutoSubmit, handleConfirm, isPreparing]);

  // A headless auto-submit that can never fire (unresolvable reference, failed
  // lookup, no cwd) would otherwise hang invisibly forever. Surface the dialog so
  // the error is readable and the user can retry or cancel.
  useEffect(() => {
    if (!headless || revealed || autoSubmittedRef.current || isPreparing) return;
    if (pullRequestResolution.error) {
      setRevealed(true);
      return;
    }
    if (isResolving) return;
    const timer = window.setTimeout(() => {
      if (!autoSubmittedRef.current) {
        setRevealed(true);
      }
    }, HEADLESS_REVEAL_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [headless, isPreparing, isResolving, pullRequestResolution.error, revealed]);

  const validationMessage = !referenceDirty
    ? null
    : reference.trim().length === 0
      ? `Paste a ${terminology.singular} URL, checkout command, or enter 123 / #123.`
      : null;
  const errorMessage =
    validationMessage ??
    createWorktreeError ??
    (resolvedPullRequest === null && pullRequestResolution.error
      ? pullRequestResolution.error
      : preparePullRequestThreadAction.error instanceof Error
        ? preparePullRequestThreadAction.error.message
        : preparePullRequestThreadAction.error
          ? `Failed to prepare ${terminology.singular} thread.`
          : null);

  if (headless && !revealed) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isPreparing) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SourceControlIcon className="size-4" />
            Open branch or {terminology.shortLabel}
          </DialogTitle>
          <DialogDescription>
            Enter an existing branch or a {sourceControlPresentation.providerName}{" "}
            {terminology.singular}. Existing chats are reused; otherwise a dedicated worktree is
            created.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground capitalize">
              Branch or {terminology.shortLabel}
            </span>
            <Input
              ref={referenceInputRef}
              placeholder={`Branch name, ${terminology.shortLabel} URL, or #42`}
              value={reference}
              onChange={(event) => {
                setReferenceDirty(true);
                setCreateWorktreeError(null);
                setReference(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") {
                  return;
                }
                event.preventDefault();
                if (!isResolving && !isPreparing) {
                  void handleConfirm();
                }
              }}
            />
          </label>

          {resolvedPullRequest ? (
            <div className="rounded-xl border border-border/70 bg-muted/24 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">{resolvedPullRequest.title}</p>
                  <p className="truncate text-muted-foreground text-xs">
                    #{resolvedPullRequest.number} · {resolvedPullRequest.headBranch} to{" "}
                    {resolvedPullRequest.baseBranch}
                  </p>
                </div>
                <span className={cn("shrink-0 text-xs capitalize", statusTone)}>
                  {resolvedPullRequest.state}
                </span>
              </div>
            </div>
          ) : null}
          {!resolvedPullRequest && resolvedBranchTarget ? (
            <div className="rounded-xl border border-border/70 bg-muted/24 p-3">
              <p className="font-medium text-sm">
                {resolvedBranch?.name ?? resolvedBranchTarget.branch}
              </p>
              <p className="text-muted-foreground text-xs">
                {resolvedBranchTarget.worktreePath
                  ? "Existing worktree"
                  : resolvedBranch
                    ? "Existing branch"
                    : "Fetched from the remote when opened"}
              </p>
            </div>
          ) : null}

          {isResolving ? (
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <Spinner className="size-3.5" />
              Resolving {terminology.singular}...
            </div>
          ) : null}

          {errorMessage ? <p className="text-destructive text-xs">{errorMessage}</p> : null}
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isPreparing}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              void handleConfirm();
            }}
            disabled={
              !cwd || (!resolvedPullRequest && !resolvedBranchTarget) || isResolving || isPreparing
            }
          >
            {isPreparing ? "Preparing worktree..." : "Open worktree"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
