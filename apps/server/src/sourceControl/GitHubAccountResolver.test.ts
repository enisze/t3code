import { assert, afterEach, describe, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  ProjectId,
  ThreadId,
  type GitHubAccountRef,
  type OrchestrationProjectShell,
  type OrchestrationShellSnapshot,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import {
  GitHubAccountResolver,
  gitHubAccountAuthEnv,
  gitHubAccountGhEnv,
  layer as resolverLayer,
} from "./GitHubAccountResolver.ts";

const NOW = "2026-01-01T00:00:00.000Z";

const projectShell = (input: {
  readonly id: string;
  readonly workspaceRoot: string;
  readonly gitHubAccount: GitHubAccountRef | null;
}): OrchestrationProjectShell => ({
  id: ProjectId.make(input.id),
  title: input.id,
  workspaceRoot: input.workspaceRoot,
  defaultModelSelection: null,
  gitHubAccount: input.gitHubAccount,
  worktreeBranchPrefix: null,
  defaultWorktreeBranch: null,
  previewPort: null,
  worktreeCopyFiles: [],
  scripts: [],
  createdAt: NOW,
  updatedAt: NOW,
});

const threadShell = (input: {
  readonly id: string;
  readonly projectId: string;
  readonly worktreePath: string | null;
}): OrchestrationThreadShell =>
  ({
    id: ThreadId.make(input.id),
    projectId: ProjectId.make(input.projectId),
    worktreePath: input.worktreePath,
    branch: null,
    latestTurn: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    createdAt: NOW,
    updatedAt: NOW,
    // Fields the resolver never reads are omitted; cast keeps the fixture terse.
  }) as unknown as OrchestrationThreadShell;

const shellSnapshot = (input: {
  readonly projects: ReadonlyArray<OrchestrationProjectShell>;
  readonly threads: ReadonlyArray<OrchestrationThreadShell>;
}): OrchestrationShellSnapshot => ({
  snapshotSequence: 1,
  projects: input.projects,
  threads: input.threads,
  updatedAt: NOW,
});

const processOutput = (stdout: string): VcsProcess.VcsProcessOutput => ({
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

const mockRun = vi.fn<VcsProcess.VcsProcess["Service"]["run"]>();
const mockListAccountRoutes = vi.fn<ProjectionSnapshotQuery["Service"]["listAccountRoutes"]>();

// Derive the flat path→account routes the resolver consumes from the same
// projects/threads fixtures the tests express, mirroring the SQL union in
// ProjectionSnapshotQuery.listAccountRoutes.
const routesFromSnapshot = (
  snapshot: OrchestrationShellSnapshot,
): ReadonlyArray<{ readonly path: string; readonly account: GitHubAccountRef }> => {
  const accountByProjectId = new Map(
    snapshot.projects
      .filter((project) => project.gitHubAccount !== null)
      .map((project) => [project.id, project.gitHubAccount as GitHubAccountRef] as const),
  );
  const routes: Array<{ path: string; account: GitHubAccountRef }> = [];
  for (const project of snapshot.projects) {
    if (project.gitHubAccount !== null) {
      routes.push({ path: project.workspaceRoot, account: project.gitHubAccount });
    }
  }
  for (const thread of snapshot.threads) {
    if (thread.worktreePath === null) continue;
    const account = accountByProjectId.get(thread.projectId);
    if (account !== undefined) {
      routes.push({ path: thread.worktreePath, account });
    }
  }
  return routes;
};

const layerFor = (snapshot: OrchestrationShellSnapshot) => {
  mockListAccountRoutes.mockReturnValue(Effect.succeed(routesFromSnapshot(snapshot)));
  return resolverLayer.pipe(
    Layer.provide(Layer.mock(VcsProcess.VcsProcess)({ run: mockRun })),
    Layer.provide(
      Layer.mock(ProjectionSnapshotQuery)({ listAccountRoutes: mockListAccountRoutes }),
    ),
  );
};

afterEach(() => {
  mockRun.mockReset();
  mockListAccountRoutes.mockReset();
});

describe("gitHubAccountGhEnv", () => {
  it("uses GH_TOKEN for github.com", () => {
    assert.deepEqual(
      gitHubAccountGhEnv({ account: { host: "github.com", login: "octo" }, token: "t0ken" }),
      { GH_HOST: "github.com", GH_TOKEN: "t0ken" },
    );
  });

  it("uses GH_ENTERPRISE_TOKEN for enterprise hosts", () => {
    assert.deepEqual(
      gitHubAccountGhEnv({ account: { host: "ghe.corp", login: "octo" }, token: "t0ken" }),
      { GH_HOST: "ghe.corp", GH_ENTERPRISE_TOKEN: "t0ken" },
    );
  });
});

describe("gitHubAccountAuthEnv", () => {
  it("pins git credentials for the account host to gh's helper", () => {
    assert.deepEqual(
      gitHubAccountAuthEnv({ account: { host: "github.com", login: "octo" }, token: "t0ken" }, {}),
      {
        GH_HOST: "github.com",
        GH_TOKEN: "t0ken",
        GIT_CONFIG_COUNT: "4",
        // An empty helper resets the list, so the machine-global helper (usually
        // an OS keychain) cannot answer for this host first.
        GIT_CONFIG_KEY_0: "credential.https://github.com.helper",
        GIT_CONFIG_VALUE_0: "",
        GIT_CONFIG_KEY_1: "credential.https://github.com.helper",
        GIT_CONFIG_VALUE_1: "!gh auth git-credential",
        // SSH remotes for the host are rewritten to HTTPS so the token applies.
        GIT_CONFIG_KEY_2: "url.https://github.com/.insteadOf",
        GIT_CONFIG_VALUE_2: "git@github.com:",
        GIT_CONFIG_KEY_3: "url.https://github.com/.insteadOf",
        GIT_CONFIG_VALUE_3: "ssh://git@github.com/",
      },
    );
  });

  it("scopes the helper to enterprise hosts", () => {
    assert.deepEqual(
      gitHubAccountAuthEnv({ account: { host: "ghe.corp", login: "octo" }, token: "t0ken" }, {}),
      {
        GH_HOST: "ghe.corp",
        GH_ENTERPRISE_TOKEN: "t0ken",
        GIT_CONFIG_COUNT: "4",
        GIT_CONFIG_KEY_0: "credential.https://ghe.corp.helper",
        GIT_CONFIG_VALUE_0: "",
        GIT_CONFIG_KEY_1: "credential.https://ghe.corp.helper",
        GIT_CONFIG_VALUE_1: "!gh auth git-credential",
        GIT_CONFIG_KEY_2: "url.https://ghe.corp/.insteadOf",
        GIT_CONFIG_VALUE_2: "git@ghe.corp:",
        GIT_CONFIG_KEY_3: "url.https://ghe.corp/.insteadOf",
        GIT_CONFIG_VALUE_3: "ssh://git@ghe.corp/",
      },
    );
  });

  it("appends after runtime config pairs already in the environment", () => {
    const env = gitHubAccountAuthEnv(
      { account: { host: "github.com", login: "octo" }, token: "t0ken" },
      { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.pager", GIT_CONFIG_VALUE_0: "cat" },
    );
    assert.equal(env.GIT_CONFIG_COUNT, "5");
    // Index 0 stays with the inherited pair instead of being overwritten.
    assert.equal(env.GIT_CONFIG_KEY_0, undefined);
    assert.equal(env.GIT_CONFIG_KEY_1, "credential.https://github.com.helper");
    assert.equal(env.GIT_CONFIG_VALUE_1, "");
    assert.equal(env.GIT_CONFIG_KEY_2, "credential.https://github.com.helper");
    assert.equal(env.GIT_CONFIG_VALUE_2, "!gh auth git-credential");
    assert.equal(env.GIT_CONFIG_KEY_3, "url.https://github.com/.insteadOf");
    assert.equal(env.GIT_CONFIG_VALUE_3, "git@github.com:");
    assert.equal(env.GIT_CONFIG_KEY_4, "url.https://github.com/.insteadOf");
    assert.equal(env.GIT_CONFIG_VALUE_4, "ssh://git@github.com/");
  });

  it("ignores a malformed inherited GIT_CONFIG_COUNT", () => {
    const env = gitHubAccountAuthEnv(
      { account: { host: "github.com", login: "octo" }, token: "t0ken" },
      { GIT_CONFIG_COUNT: "not-a-number" },
    );
    assert.equal(env.GIT_CONFIG_COUNT, "4");
    assert.equal(env.GIT_CONFIG_KEY_0, "credential.https://github.com.helper");
  });
});

describe("GitHubAccountResolver.resolveForCwd", () => {
  it.effect("resolves to ambient when the owning project has no account", () =>
    Effect.gen(function* () {
      const resolver = yield* GitHubAccountResolver;
      const resolved = yield* resolver.resolveForCwd("/repos/app/src");
      assert.deepEqual(resolved, { _tag: "ambient" });
      assert.equal(mockRun.mock.calls.length, 0);
    }).pipe(
      Effect.provide(
        layerFor(
          shellSnapshot({
            projects: [
              projectShell({ id: "app", workspaceRoot: "/repos/app", gitHubAccount: null }),
            ],
            threads: [],
          }),
        ),
      ),
    ),
  );

  it.effect("resolves the account and token when cwd is inside the workspace root", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValue(Effect.succeed(processOutput("gho_secret\n")));
      const resolver = yield* GitHubAccountResolver;
      const resolved = yield* resolver.resolveForCwd("/repos/app/packages/x");
      assert.deepEqual(resolved, {
        _tag: "resolved",
        account: { host: "github.com", login: "octo" },
        token: "gho_secret",
      });
      const call = mockRun.mock.calls[0]?.[0];
      assert.deepEqual(call?.args, ["auth", "token", "--user", "octo", "--hostname", "github.com"]);
    }).pipe(
      Effect.provide(
        layerFor(
          shellSnapshot({
            projects: [
              projectShell({
                id: "app",
                workspaceRoot: "/repos/app",
                gitHubAccount: { host: "github.com", login: "octo" },
              }),
            ],
            threads: [],
          }),
        ),
      ),
    ),
  );

  it.effect("resolves via a thread worktree that lives outside the workspace root", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValue(Effect.succeed(processOutput("gho_wt\n")));
      const resolver = yield* GitHubAccountResolver;
      const resolved = yield* resolver.resolveForCwd("/state/worktrees/wt-1/sub");
      assert.deepEqual(resolved, {
        _tag: "resolved",
        account: { host: "github.com", login: "octo" },
        token: "gho_wt",
      });
    }).pipe(
      Effect.provide(
        layerFor(
          shellSnapshot({
            projects: [
              projectShell({
                id: "app",
                workspaceRoot: "/repos/app",
                gitHubAccount: { host: "github.com", login: "octo" },
              }),
            ],
            threads: [
              threadShell({ id: "t1", projectId: "app", worktreePath: "/state/worktrees/wt-1" }),
            ],
          }),
        ),
      ),
    ),
  );

  it.effect("does not match a sibling path with a shared prefix", () =>
    Effect.gen(function* () {
      const resolver = yield* GitHubAccountResolver;
      const resolved = yield* resolver.resolveForCwd("/repos/app-2/src");
      assert.deepEqual(resolved, { _tag: "ambient" });
    }).pipe(
      Effect.provide(
        layerFor(
          shellSnapshot({
            projects: [
              projectShell({
                id: "app",
                workspaceRoot: "/repos/app",
                gitHubAccount: { host: "github.com", login: "octo" },
              }),
            ],
            threads: [],
          }),
        ),
      ),
    ),
  );

  it.effect("reports unavailable when the attached account can't mint a token", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValue(Effect.succeed(processOutput("")));
      const resolver = yield* GitHubAccountResolver;
      const resolved = yield* resolver.resolveForCwd("/repos/app");
      assert.deepEqual(resolved, {
        _tag: "unavailable",
        account: { host: "github.com", login: "octo" },
      });
    }).pipe(
      Effect.provide(
        layerFor(
          shellSnapshot({
            projects: [
              projectShell({
                id: "app",
                workspaceRoot: "/repos/app",
                gitHubAccount: { host: "github.com", login: "octo" },
              }),
            ],
            threads: [],
          }),
        ),
      ),
    ),
  );
});

const attachedProjectSnapshot = (account: GitHubAccountRef) =>
  shellSnapshot({
    projects: [projectShell({ id: "app", workspaceRoot: "/repos/app", gitHubAccount: account })],
    threads: [],
  });

describe("GitHubAccountResolver.resolveCommitIdentityForCwd", () => {
  it.effect("resolves to ambient when the owning project has no account", () =>
    Effect.gen(function* () {
      const resolver = yield* GitHubAccountResolver;
      const identity = yield* resolver.resolveCommitIdentityForCwd("/repos/app/src");
      assert.deepEqual(identity, { _tag: "ambient" });
      assert.equal(mockRun.mock.calls.length, 0);
    }).pipe(
      Effect.provide(
        layerFor(
          shellSnapshot({
            projects: [
              projectShell({ id: "app", workspaceRoot: "/repos/app", gitHubAccount: null }),
            ],
            threads: [],
          }),
        ),
      ),
    ),
  );

  it.effect("uses the account's numeric id and display name from gh api user", () =>
    Effect.gen(function* () {
      // First call mints the token, second reads the profile.
      mockRun
        .mockReturnValueOnce(Effect.succeed(processOutput("gho_secret\n")))
        .mockReturnValueOnce(
          Effect.succeed(processOutput(`{"login":"octo","id":12345,"name":"Octo Cat"}`)),
        );
      const resolver = yield* GitHubAccountResolver;
      const identity = yield* resolver.resolveCommitIdentityForCwd("/repos/app/src");
      assert.deepEqual(identity, {
        _tag: "resolved",
        account: { host: "github.com", login: "octo" },
        identity: {
          name: "Octo Cat",
          email: "12345+octo@users.noreply.github.com",
        },
      });
      const apiCall = mockRun.mock.calls[1]?.[0];
      assert.deepEqual(apiCall?.args, ["api", "user", "--hostname", "github.com"]);
      // The profile read must act as the account, not the machine-active one.
      assert.equal(apiCall?.env?.GH_TOKEN, "gho_secret");
      assert.equal(apiCall?.env?.GH_HOST, "github.com");
    }).pipe(
      Effect.provide(layerFor(attachedProjectSnapshot({ host: "github.com", login: "octo" }))),
    ),
  );

  it.effect("falls back to the login no-reply email when the token can't be minted", () =>
    Effect.gen(function* () {
      // Empty token → cannot act as the account, so no profile call is made.
      mockRun.mockReturnValue(Effect.succeed(processOutput("")));
      const resolver = yield* GitHubAccountResolver;
      const identity = yield* resolver.resolveCommitIdentityForCwd("/repos/app/src");
      assert.deepEqual(identity, {
        _tag: "resolved",
        account: { host: "github.com", login: "octo" },
        identity: {
          name: "octo",
          email: "octo@users.noreply.github.com",
        },
      });
      // Only the token mint runs; the profile read is skipped without a token.
      assert.equal(mockRun.mock.calls.length, 1);
    }).pipe(
      Effect.provide(layerFor(attachedProjectSnapshot({ host: "github.com", login: "octo" }))),
    ),
  );

  it.effect("falls back to the login no-reply email when the profile read fails", () =>
    Effect.gen(function* () {
      mockRun
        .mockReturnValueOnce(Effect.succeed(processOutput("gho_secret\n")))
        .mockReturnValueOnce(Effect.fail(new Error("network down") as never));
      const resolver = yield* GitHubAccountResolver;
      const identity = yield* resolver.resolveCommitIdentityForCwd("/repos/app/src");
      assert.deepEqual(identity, {
        _tag: "resolved",
        account: { host: "github.com", login: "octo" },
        identity: {
          name: "octo",
          email: "octo@users.noreply.github.com",
        },
      });
    }).pipe(
      Effect.provide(layerFor(attachedProjectSnapshot({ host: "github.com", login: "octo" }))),
    ),
  );

  it.effect("derives the enterprise no-reply host for a GHE account", () =>
    Effect.gen(function* () {
      mockRun
        .mockReturnValueOnce(Effect.succeed(processOutput("ghe_secret\n")))
        .mockReturnValueOnce(Effect.succeed(processOutput(`{"login":"octo","id":42}`)));
      const resolver = yield* GitHubAccountResolver;
      const identity = yield* resolver.resolveCommitIdentityForCwd("/repos/app/src");
      assert.deepEqual(identity, {
        _tag: "resolved",
        account: { host: "ghe.corp", login: "octo" },
        identity: {
          name: "octo",
          email: "42+octo@users.noreply.ghe.corp",
        },
      });
      assert.equal(mockRun.mock.calls[1]?.[0]?.env?.GH_ENTERPRISE_TOKEN, "ghe_secret");
    }).pipe(Effect.provide(layerFor(attachedProjectSnapshot({ host: "ghe.corp", login: "octo" })))),
  );
});
