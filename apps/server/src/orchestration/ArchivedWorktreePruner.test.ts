// @effect-diagnostics nodeBuiltinImport:off - synchronous fixture setup.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { pruneWorktreeArtifacts } from "./ArchivedWorktreePruner.ts";

const TestLayer = GitVcsDriver.layer.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-worktree-pruner-test-" })),
  Layer.provideMerge(NodeServices.layer),
);

const git = (cwd: string, args: string[]) =>
  NodeChildProcess.execFileSync("git", args, { cwd, stdio: "pipe" });

const write = (root: string, relativePath: string, contents = "x") => {
  const target = NodePath.join(root, relativePath);
  NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
  NodeFS.writeFileSync(target, contents);
};

const makeRepoWithWorktree = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-worktree-pruner-" });
  const repo = NodePath.join(root, "repo");
  const worktree = NodePath.join(root, "worktree");
  NodeFS.mkdirSync(repo);
  git(repo, ["init", "--initial-branch=main"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test User"]);
  write(repo, ".gitignore", "node_modules/\n.next/\n*.apk\n.env\ncache/\n");
  write(repo, "apps/web/index.ts");
  write(repo, "tracked/build/keep.txt");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "init"]);
  git(repo, ["worktree", "add", "-b", "feature", worktree]);
  return { repo, worktree };
});

it.layer(TestLayer)("pruneWorktreeArtifacts", (it) => {
  it.effect("removes ignored build output and keeps source, secrets, and tracked files", () =>
    Effect.gen(function* () {
      const { worktree } = yield* makeRepoWithWorktree;
      write(worktree, "node_modules/pkg/index.js");
      write(worktree, "apps/web/node_modules/pkg/index.js");
      write(worktree, "apps/web/.next/server.js");
      write(worktree, "android/app-release.apk");
      write(worktree, ".env", "SECRET=1");
      write(worktree, "cache/data.bin");

      const removed = yield* pruneWorktreeArtifacts(worktree);

      assert.deepStrictEqual(removed.toSorted(), [
        "android/app-release.apk",
        "apps/web/.next/",
        "apps/web/node_modules/",
        "node_modules/",
      ]);
      assert.isFalse(NodeFS.existsSync(NodePath.join(worktree, "node_modules")));
      assert.isFalse(NodeFS.existsSync(NodePath.join(worktree, "apps/web/node_modules")));
      assert.isFalse(NodeFS.existsSync(NodePath.join(worktree, "apps/web/.next")));
      assert.isFalse(NodeFS.existsSync(NodePath.join(worktree, "android/app-release.apk")));
      assert.isTrue(NodeFS.existsSync(NodePath.join(worktree, ".env")));
      assert.isTrue(NodeFS.existsSync(NodePath.join(worktree, "cache/data.bin")));
      assert.isTrue(NodeFS.existsSync(NodePath.join(worktree, "apps/web/index.ts")));
      assert.isTrue(NodeFS.existsSync(NodePath.join(worktree, "tracked/build/keep.txt")));
    }).pipe(Effect.scoped),
  );

  it.effect("never prunes a main checkout", () =>
    Effect.gen(function* () {
      const { repo } = yield* makeRepoWithWorktree;
      write(repo, "node_modules/pkg/index.js");

      const removed = yield* pruneWorktreeArtifacts(repo);

      assert.deepStrictEqual(removed, []);
      assert.isTrue(NodeFS.existsSync(NodePath.join(repo, "node_modules/pkg/index.js")));
    }).pipe(Effect.scoped),
  );
});
