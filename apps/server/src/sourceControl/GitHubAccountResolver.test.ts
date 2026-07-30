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
const mockGetShellSnapshot = vi.fn<ProjectionSnapshotQuery["Service"]["getShellSnapshot"]>();

const layerFor = (snapshot: OrchestrationShellSnapshot) => {
  mockGetShellSnapshot.mockReturnValue(Effect.succeed(snapshot));
  return resolverLayer.pipe(
    Layer.provide(Layer.mock(VcsProcess.VcsProcess)({ run: mockRun })),
    Layer.provide(Layer.mock(ProjectionSnapshotQuery)({ getShellSnapshot: mockGetShellSnapshot })),
  );
};

afterEach(() => {
  mockRun.mockReset();
  mockGetShellSnapshot.mockReset();
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
        GIT_CONFIG_COUNT: "2",
        // An empty helper resets the list, so the machine-global helper (usually
        // an OS keychain) cannot answer for this host first.
        GIT_CONFIG_KEY_0: "credential.https://github.com.helper",
        GIT_CONFIG_VALUE_0: "",
        GIT_CONFIG_KEY_1: "credential.https://github.com.helper",
        GIT_CONFIG_VALUE_1: "!gh auth git-credential",
      },
    );
  });

  it("scopes the helper to enterprise hosts", () => {
    assert.deepEqual(
      gitHubAccountAuthEnv({ account: { host: "ghe.corp", login: "octo" }, token: "t0ken" }, {}),
      {
        GH_HOST: "ghe.corp",
        GH_ENTERPRISE_TOKEN: "t0ken",
        GIT_CONFIG_COUNT: "2",
        GIT_CONFIG_KEY_0: "credential.https://ghe.corp.helper",
        GIT_CONFIG_VALUE_0: "",
        GIT_CONFIG_KEY_1: "credential.https://ghe.corp.helper",
        GIT_CONFIG_VALUE_1: "!gh auth git-credential",
      },
    );
  });

  it("appends after runtime config pairs already in the environment", () => {
    const env = gitHubAccountAuthEnv(
      { account: { host: "github.com", login: "octo" }, token: "t0ken" },
      { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.pager", GIT_CONFIG_VALUE_0: "cat" },
    );
    assert.equal(env.GIT_CONFIG_COUNT, "3");
    // Index 0 stays with the inherited pair instead of being overwritten.
    assert.equal(env.GIT_CONFIG_KEY_0, undefined);
    assert.equal(env.GIT_CONFIG_KEY_1, "credential.https://github.com.helper");
    assert.equal(env.GIT_CONFIG_VALUE_1, "");
    assert.equal(env.GIT_CONFIG_KEY_2, "credential.https://github.com.helper");
    assert.equal(env.GIT_CONFIG_VALUE_2, "!gh auth git-credential");
  });

  it("ignores a malformed inherited GIT_CONFIG_COUNT", () => {
    const env = gitHubAccountAuthEnv(
      { account: { host: "github.com", login: "octo" }, token: "t0ken" },
      { GIT_CONFIG_COUNT: "not-a-number" },
    );
    assert.equal(env.GIT_CONFIG_COUNT, "2");
    assert.equal(env.GIT_CONFIG_KEY_0, "credential.https://github.com.helper");
  });
});

describe("GitHubAccountResolver.resolveForCwd", () => {
  it.effect("returns null when the owning project has no account", () =>
    Effect.gen(function* () {
      const resolver = yield* GitHubAccountResolver;
      const resolved = yield* resolver.resolveForCwd("/repos/app/src");
      assert.equal(resolved, null);
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
      assert.equal(resolved, null);
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

  it.effect("returns null when gh cannot mint a token", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValue(Effect.succeed(processOutput("")));
      const resolver = yield* GitHubAccountResolver;
      const resolved = yield* resolver.resolveForCwd("/repos/app");
      assert.equal(resolved, null);
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
