import { assert, it, afterEach, describe, expect, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/unstable/process";
import { VcsProcessExitError, VcsProcessSpawnError } from "@t3tools/contracts";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import { GitHubAccountResolver } from "./GitHubAccountResolver.ts";
import * as GitHubCli from "./GitHubCli.ts";

const processOutput = (stdout: string): VcsProcess.VcsProcessOutput => ({
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

const mockRun = vi.fn<VcsProcess.VcsProcess["Service"]["run"]>();

const layer = GitHubCli.layer.pipe(
  Layer.provide(
    Layer.mock(VcsProcess.VcsProcess)({
      run: mockRun,
    }),
  ),
);

afterEach(() => {
  mockRun.mockReset();
});

describe("GitHubCli.layer", () => {
  it("does not classify a missing cwd as an unavailable gh executable", () => {
    const context = { command: "gh", cwd: "/repo" } as const;
    const missingCwd = new VcsProcessSpawnError({
      operation: "GitHubCli.execute",
      command: "gh",
      cwd: context.cwd,
      cause: PlatformError.systemError({
        _tag: "NotFound",
        module: "FileSystem",
        method: "access",
        pathOrDescriptor: context.cwd,
      }),
    });

    const commandFailure = GitHubCli.fromVcsError(context, missingCwd);

    assert.equal(commandFailure._tag, "GitHubCliCommandError");
    assert.strictEqual(commandFailure.cause, missingCwd);
    assert.notProperty(commandFailure, "operation");
  });

  it.effect("parses pull request view output", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              number: 42,
              title: "Add PR thread creation",
              url: "https://github.com/pingdotgg/codething-mvp/pull/42",
              baseRefName: "main",
              headRefName: "feature/pr-threads",
              state: "OPEN",
              mergedAt: null,
              mergeable: "CONFLICTING",
              mergeStateStatus: "DIRTY",
              statusCheckRollup: [{ status: "COMPLETED", conclusion: "FAILURE" }],
              isCrossRepository: true,
              headRepository: {
                nameWithOwner: "octocat/codething-mvp",
              },
              headRepositoryOwner: {
                login: "octocat",
              },
            }),
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.getPullRequest({
        cwd: "/repo",
        reference: "#42",
      });

      assert.deepStrictEqual(result, {
        number: 42,
        title: "Add PR thread creation",
        url: "https://github.com/pingdotgg/codething-mvp/pull/42",
        baseRefName: "main",
        headRefName: "feature/pr-threads",
        state: "open",
        mergeability: "conflicting",
        checks: "failing",
        failedCheckCount: 1,
        isCrossRepository: true,
        headRepositoryNameWithOwner: "octocat/codething-mvp",
        headRepositoryOwnerLogin: "octocat",
      });
      expect(mockRun).toHaveBeenCalledWith({
        operation: "GitHubCli.execute",
        command: "gh",
        args: [
          "pr",
          "view",
          "#42",
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner,mergeable,mergeStateStatus,statusCheckRollup",
        ],
        cwd: "/repo",
        timeoutMs: 30_000,
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("trims pull request fields decoded from gh json", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              number: 42,
              title: "  Add PR thread creation  \n",
              url: " https://github.com/pingdotgg/codething-mvp/pull/42 ",
              baseRefName: " main ",
              headRefName: "\tfeature/pr-threads\t",
              state: "OPEN",
              mergedAt: null,
              isCrossRepository: true,
              headRepository: {
                nameWithOwner: " octocat/codething-mvp ",
              },
              headRepositoryOwner: {
                login: " octocat ",
              },
            }),
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.getPullRequest({
        cwd: "/repo",
        reference: "#42",
      });

      assert.deepStrictEqual(result, {
        number: 42,
        title: "Add PR thread creation",
        url: "https://github.com/pingdotgg/codething-mvp/pull/42",
        baseRefName: "main",
        headRefName: "feature/pr-threads",
        state: "open",
        isCrossRepository: true,
        headRepositoryNameWithOwner: "octocat/codething-mvp",
        headRepositoryOwnerLogin: "octocat",
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("skips invalid entries when parsing pr lists", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify([
              {
                number: 0,
                title: "invalid",
                url: "https://github.com/pingdotgg/codething-mvp/pull/0",
                baseRefName: "main",
                headRefName: "feature/invalid",
              },
              {
                number: 43,
                title: "  Valid PR  ",
                url: " https://github.com/pingdotgg/codething-mvp/pull/43 ",
                baseRefName: " main ",
                headRefName: " feature/pr-list ",
                headRepository: {
                  nameWithOwner: "   ",
                },
                headRepositoryOwner: {
                  login: "   ",
                },
              },
            ]),
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.listOpenPullRequests({
        cwd: "/repo",
        headSelector: "feature/pr-list",
      });

      assert.deepStrictEqual(result, [
        {
          number: 43,
          title: "Valid PR",
          url: "https://github.com/pingdotgg/codething-mvp/pull/43",
          baseRefName: "main",
          headRefName: "feature/pr-list",
          state: "open",
        },
      ]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("keeps pull requests from gh versions without headRepository.nameWithOwner", () =>
    // gh < 2.47 (e.g. Ubuntu-packaged 2.46) exports headRepository as
    // {id, name} only. These entries must decode instead of being dropped,
    // with nameWithOwner rebuilt from the owner login.
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify([
              {
                number: 2829,
                title: "Codex turn mapping",
                url: "https://github.com/pingdotgg/codething-mvp/pull/2829",
                baseRefName: "main",
                headRefName: "t3code/codex-turn-mapping",
                state: "OPEN",
                mergedAt: null,
                isCrossRepository: false,
                headRepository: {
                  id: "R_kgDORLtfbQ",
                  name: "codething-mvp",
                },
                headRepositoryOwner: {
                  id: "MDEyOk9yZ2FuaXphdGlvbjg5MTkxNzI3",
                  login: "pingdotgg",
                },
              },
            ]),
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.listOpenPullRequests({
        cwd: "/repo",
        headSelector: "t3code/codex-turn-mapping",
      });

      assert.deepStrictEqual(result, [
        {
          number: 2829,
          title: "Codex turn mapping",
          url: "https://github.com/pingdotgg/codething-mvp/pull/2829",
          baseRefName: "main",
          headRefName: "t3code/codex-turn-mapping",
          state: "open",
          isCrossRepository: false,
          headRepositoryNameWithOwner: "pingdotgg/codething-mvp",
          headRepositoryOwnerLogin: "pingdotgg",
        },
      ]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("reads repository clone URLs", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              nameWithOwner: "octocat/codething-mvp",
              url: "https://github.com/octocat/codething-mvp",
              sshUrl: "git@github.com:octocat/codething-mvp.git",
            }),
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.getRepositoryCloneUrls({
        cwd: "/repo",
        repository: "octocat/codething-mvp",
      });

      assert.deepStrictEqual(result, {
        nameWithOwner: "octocat/codething-mvp",
        url: "https://github.com/octocat/codething-mvp",
        sshUrl: "git@github.com:octocat/codething-mvp.git",
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("creates repositories and parses clone URLs from create output", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            "✓ Created repository octocat/codething-mvp on github.com\nhttps://github.com/octocat/codething-mvp\n",
          ),
        ),
      );

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.createRepository({
        cwd: "/repo",
        repository: "octocat/codething-mvp",
        visibility: "private",
      });

      assert.deepStrictEqual(result, {
        nameWithOwner: "octocat/codething-mvp",
        url: "https://github.com/octocat/codething-mvp",
        sshUrl: "git@github.com:octocat/codething-mvp.git",
      });
      expect(mockRun).toHaveBeenCalledTimes(1);
      expect(mockRun).toHaveBeenNthCalledWith(1, {
        operation: "GitHubCli.execute",
        command: "gh",
        args: ["repo", "create", "octocat/codething-mvp", "--private"],
        cwd: "/repo",
        timeoutMs: 30_000,
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("falls back to constructed URLs when create output omits a URL", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput("")));

      const gh = yield* GitHubCli.GitHubCli;
      const result = yield* gh.createRepository({
        cwd: "/repo",
        repository: "octocat/codething-mvp",
        visibility: "private",
      });

      assert.deepStrictEqual(result, {
        nameWithOwner: "octocat/codething-mvp",
        url: "https://github.com/octocat/codething-mvp",
        sshUrl: "git@github.com:octocat/codething-mvp.git",
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("surfaces a friendly error when the pull request is not found", () =>
    Effect.gen(function* () {
      const cause = new VcsProcessExitError({
        operation: "GitHubCli.execute",
        command: "gh pr view",
        cwd: "/repo",
        exitCode: 1,
        failureKind: "not-found",
        detail:
          "GraphQL: Could not resolve to a PullRequest with the number of 4888. (repository.pullRequest)",
      });
      mockRun.mockReturnValueOnce(Effect.fail(cause));

      const gh = yield* GitHubCli.GitHubCli;
      const error = yield* gh
        .getPullRequest({
          cwd: "/repo",
          reference: "4888",
        })
        .pipe(Effect.flip);

      assert.equal(error.message.includes("Pull request not found"), true);
      assert.strictEqual(error._tag, "GitHubPullRequestNotFoundError");
      assert.strictEqual(error.command, "gh");
      assert.strictEqual(error.cwd, "/repo");
      assert.strictEqual(error.cause, cause);
      assert.equal(error.message.includes(cause.detail), false);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("merges with a real merge commit when the repository allows it", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              mergeCommitAllowed: true,
              squashMergeAllowed: true,
              rebaseMergeAllowed: true,
            }),
          ),
        ),
      );
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({ mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" }),
          ),
        ),
      );
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput("")));

      const gh = yield* GitHubCli.GitHubCli;
      yield* gh.mergePullRequest({ cwd: "/repo", reference: "#42" });

      expect(mockRun).toHaveBeenNthCalledWith(1, {
        operation: "GitHubCli.execute",
        command: "gh",
        args: [
          "repo",
          "view",
          "--json",
          "mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed",
        ],
        cwd: "/repo",
        timeoutMs: 30_000,
      });
      expect(mockRun).toHaveBeenNthCalledWith(2, {
        operation: "GitHubCli.execute",
        command: "gh",
        args: ["pr", "view", "#42", "--json", "mergeable,mergeStateStatus"],
        cwd: "/repo",
        timeoutMs: 30_000,
      });
      expect(mockRun).toHaveBeenNthCalledWith(3, {
        operation: "GitHubCli.execute",
        command: "gh",
        args: ["pr", "merge", "#42", "--merge"],
        cwd: "/repo",
        timeoutMs: 30_000,
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("falls back to squash when merge commits are disallowed", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              mergeCommitAllowed: false,
              squashMergeAllowed: true,
              rebaseMergeAllowed: true,
            }),
          ),
        ),
      );
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({ mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" }),
          ),
        ),
      );
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput("")));

      const gh = yield* GitHubCli.GitHubCli;
      yield* gh.mergePullRequest({ cwd: "/repo", reference: "#42" });

      expect(mockRun).toHaveBeenNthCalledWith(3, {
        operation: "GitHubCli.execute",
        command: "gh",
        args: ["pr", "merge", "#42", "--squash"],
        cwd: "/repo",
        timeoutMs: 30_000,
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("falls back to rebase when only rebase merges are allowed", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              mergeCommitAllowed: false,
              squashMergeAllowed: false,
              rebaseMergeAllowed: true,
            }),
          ),
        ),
      );
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({ mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" }),
          ),
        ),
      );
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput("")));

      const gh = yield* GitHubCli.GitHubCli;
      yield* gh.mergePullRequest({ cwd: "/repo", reference: "#42" });

      expect(mockRun).toHaveBeenNthCalledWith(3, {
        operation: "GitHubCli.execute",
        command: "gh",
        args: ["pr", "merge", "#42", "--rebase"],
        cwd: "/repo",
        timeoutMs: 30_000,
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("falls back to a plain merge when repository settings can't be read", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput("not json")));
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({ mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" }),
          ),
        ),
      );
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput("")));

      const gh = yield* GitHubCli.GitHubCli;
      yield* gh.mergePullRequest({ cwd: "/repo", reference: "#42" });

      expect(mockRun).toHaveBeenNthCalledWith(3, {
        operation: "GitHubCli.execute",
        command: "gh",
        args: ["pr", "merge", "#42", "--merge"],
        cwd: "/repo",
        timeoutMs: 30_000,
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("polls until GitHub finishes computing mergeability before merging", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              mergeCommitAllowed: true,
              squashMergeAllowed: true,
              rebaseMergeAllowed: true,
            }),
          ),
        ),
      );
      // First read: still computing. Second read: settled.
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({ mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }),
          ),
        ),
      );
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({ mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" }),
          ),
        ),
      );
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput("")));

      const gh = yield* GitHubCli.GitHubCli;
      const merge = yield* gh
        .mergePullRequest({ cwd: "/repo", reference: "#42" })
        .pipe(Effect.forkChild({ startImmediately: true }));
      // Let the one-second poll backoff elapse so the second read runs.
      yield* TestClock.adjust("1 second");
      yield* Fiber.join(merge);

      expect(mockRun).toHaveBeenNthCalledWith(2, {
        operation: "GitHubCli.execute",
        command: "gh",
        args: ["pr", "view", "#42", "--json", "mergeable,mergeStateStatus"],
        cwd: "/repo",
        timeoutMs: 30_000,
      });
      expect(mockRun).toHaveBeenNthCalledWith(3, {
        operation: "GitHubCli.execute",
        command: "gh",
        args: ["pr", "view", "#42", "--json", "mergeable,mergeStateStatus"],
        cwd: "/repo",
        timeoutMs: 30_000,
      });
      expect(mockRun).toHaveBeenNthCalledWith(4, {
        operation: "GitHubCli.execute",
        command: "gh",
        args: ["pr", "merge", "#42", "--merge"],
        cwd: "/repo",
        timeoutMs: 30_000,
      });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("retries a transient merge-blocked failure", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              mergeCommitAllowed: true,
              squashMergeAllowed: true,
              rebaseMergeAllowed: true,
            }),
          ),
        ),
      );
      mockRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({ mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" }),
          ),
        ),
      );
      // First merge attempt: transient rejection. Second: success.
      mockRun.mockReturnValueOnce(
        Effect.fail(
          new VcsProcessExitError({
            operation: "GitHubCli.execute",
            command: "gh",
            cwd: "/repo",
            exitCode: 1,
            detail: "blocked",
            failureKind: "merge-blocked",
          }),
        ),
      );
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput("")));

      const gh = yield* GitHubCli.GitHubCli;
      const merge = yield* gh
        .mergePullRequest({ cwd: "/repo", reference: "#42" })
        .pipe(Effect.forkChild({ startImmediately: true }));
      // Let the one-second retry backoff elapse so the second attempt runs.
      yield* TestClock.adjust("1 second");
      yield* Fiber.join(merge);

      expect(mockRun).toHaveBeenNthCalledWith(3, {
        operation: "GitHubCli.execute",
        command: "gh",
        args: ["pr", "merge", "#42", "--merge"],
        cwd: "/repo",
        timeoutMs: 30_000,
      });
      expect(mockRun).toHaveBeenNthCalledWith(4, {
        operation: "GitHubCli.execute",
        command: "gh",
        args: ["pr", "merge", "#42", "--merge"],
        cwd: "/repo",
        timeoutMs: 30_000,
      });
    }).pipe(Effect.provide(layer)),
  );
});

describe("GitHubCli account scoping", () => {
  const resolverLayer = Layer.succeed(
    GitHubAccountResolver,
    GitHubAccountResolver.of({
      resolveForCwd: () =>
        Effect.succeed({
          _tag: "resolved",
          account: { host: "github.com", login: "octo" },
          token: "gho_project",
        }),
      resolveCommitIdentityForCwd: () => Effect.succeed({ _tag: "ambient" }),
    }),
  );

  it.effect("gives gh the credential config its child git processes need", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValue(Effect.succeed(processOutput("")));
      const gh = yield* GitHubCli.GitHubCli;
      yield* gh.execute({ cwd: "/repo", args: ["pr", "create"] });

      const env = mockRun.mock.calls[0]?.[0]?.env;
      assert.equal(env?.GH_TOKEN, "gho_project");
      // Without these, `gh pr create` pushing a new branch falls back to the
      // machine credential helper and acts as the wrong account.
      assert.equal(env?.GIT_CONFIG_KEY_1, "credential.https://github.com.helper");
      assert.equal(env?.GIT_CONFIG_VALUE_1, "!gh auth git-credential");
    }).pipe(Effect.provide(layer.pipe(Layer.provideMerge(resolverLayer)))),
  );

  it.effect("leaves the environment alone when no account is attached", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValue(Effect.succeed(processOutput("")));
      const gh = yield* GitHubCli.GitHubCli;
      yield* gh.execute({ cwd: "/repo", args: ["pr", "list"] });

      assert.equal(mockRun.mock.calls[0]?.[0]?.env, undefined);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("refuses to run gh as the wrong account when the selected one is unavailable", () =>
    Effect.gen(function* () {
      const gh = yield* GitHubCli.GitHubCli;
      const error = yield* gh
        .execute({ cwd: "/repo", args: ["pr", "merge", "#42", "--merge"] })
        .pipe(Effect.flip);

      // No gh command runs — we fail before acting as the ambient account.
      assert.equal(mockRun.mock.calls.length, 0);
      assert.strictEqual(error._tag, "GitHubAccountNotLoggedInError");
      assert.equal(error.message.includes("octo"), true);
      assert.equal(error.message.includes("gh auth login"), true);
    }).pipe(
      Effect.provide(
        layer.pipe(
          Layer.provideMerge(
            Layer.succeed(
              GitHubAccountResolver,
              GitHubAccountResolver.of({
                resolveForCwd: () =>
                  Effect.succeed({
                    _tag: "unavailable",
                    account: { host: "github.com", login: "octo" },
                  }),
                resolveCommitIdentityForCwd: () => Effect.succeed({ _tag: "ambient" }),
              }),
            ),
          ),
        ),
      ),
    ),
  );
});
