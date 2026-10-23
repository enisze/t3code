// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import type { ProjectEntry, ProjectSearchEntriesResult } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { VcsProcess } from "../vcs/VcsProcess.ts";

const MAX_IGNORED_ENTRIES = 25_000;

const readDotfiles = Effect.fn("WorkspaceIgnoredEntries.dotfiles")(function* (cwd: string) {
  const paths: string[] = [];
  let truncated = false;
  let directories = 0;
  // The native index also excludes dotenv files outside Git repositories.
  // Scan names only, without following symlinks or walking dependency trees.
  yield* Effect.tryPromise(async (signal) => {
    for await (const entry of NodeFSP.glob(["**/.env*", "**/.gitignore"], {
      cwd,
      withFileTypes: true,
      exclude: (entry) => {
        if (!entry.isDirectory()) return false;
        if (entry.name === ".git" || entry.name === "node_modules") return true;
        if (++directories <= MAX_IGNORED_ENTRIES) return false;
        truncated = true;
        return true;
      },
    })) {
      if (signal.aborted) break;
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      if (paths.length >= MAX_IGNORED_ENTRIES) {
        truncated = true;
        break;
      }
      paths.push(
        NodePath.relative(cwd, NodePath.join(entry.parentPath, entry.name)).replaceAll("\\", "/"),
      );
    }
  }).pipe(Effect.orElseSucceed(() => undefined));
  return { paths, truncated };
});

/** Supplement the native index with ignored paths and dotenv files, using names only. */
export const readIgnoredEntries = Effect.fn("WorkspaceIgnoredEntries.read")(function* (
  cwd: string,
  query: string = "",
): Effect.fn.Return<ProjectSearchEntriesResult, never, VcsProcess> {
  const git = yield* VcsProcess;
  const dotfiles = yield* readDotfiles(cwd);
  // Narrow an oversized ignored index at Git's pathspec boundary. Ordinary
  // searches reuse the cached listing instead of spawning Git per keystroke.
  const pattern = query
    .replaceAll(/\s/g, "")
    .split("")
    .map((character) => (/[\\*?[\]]/.test(character) ? `\\${character}` : character))
    .join("*");
  const result = yield* git
    .run({
      operation: "WorkspaceIgnoredEntries.list",
      command: "git",
      args: [
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.untrackedCache=false",
        "ls-files",
        "--cached",
        "--others",
        "--ignored",
        "--exclude-standard",
        "-z",
        "--",
        pattern ? `:(icase)*${pattern}*` : ".",
      ],
      cwd,
      allowNonZeroExit: true,
      timeoutMs: 10_000,
      maxOutputBytes: 16 * 1024 * 1024,
    })
    .pipe(Effect.orElseSucceed(() => null));
  const gitPaths = result?.exitCode === 0 ? result.stdout : "";
  const paths = [
    ...new Set([
      ...dotfiles.paths,
      ...gitPaths
        .slice(0, gitPaths.lastIndexOf("\0") + 1)
        .split("\0")
        .filter(Boolean),
    ]),
  ];
  // Keep shallow local configuration visible when a dependency directory
  // exceeds the tree's existing entry cap.
  paths.sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  const files = paths.slice(0, MAX_IGNORED_ENTRIES);
  const parents = new Set<string>();
  for (const file of files) {
    let separator = file.lastIndexOf("/");
    while (separator !== -1) {
      parents.add(file.slice(0, separator));
      separator = file.lastIndexOf("/", separator - 1);
    }
  }
  const ignoredPaths =
    files.length === 0 || result?.exitCode !== 0
      ? null
      : yield* git
          .run({
            operation: "WorkspaceIgnoredEntries.status",
            command: "git",
            args: ["-c", "core.fsmonitor=false", "check-ignore", "-z", "--stdin"],
            cwd,
            stdin: `${[...files, ...parents].join("\0")}\0`,
            allowNonZeroExit: true,
            timeoutMs: 10_000,
            maxOutputBytes: 16 * 1024 * 1024,
          })
          .pipe(Effect.orElseSucceed(() => null));
  const ignored = new Set(
    ignoredPaths?.exitCode === 0
      ? ignoredPaths.stdout
          .slice(0, ignoredPaths.stdout.lastIndexOf("\0") + 1)
          .split("\0")
          .filter(Boolean)
      : [],
  );
  // Matching an ignore rule does not make a tracked file ignored. Keep its
  // ancestors undimmed too, so tree renderers do not inherit an ignored state.
  for (const file of files) {
    if (ignored.has(file)) continue;
    let separator = file.lastIndexOf("/");
    while (separator !== -1) {
      ignored.delete(file.slice(0, separator));
      separator = file.lastIndexOf("/", separator - 1);
    }
  }
  const entries: ProjectEntry[] = files.map((path) => ({
    path,
    kind: "file",
    ...(ignored.has(path) ? { isIgnored: true } : {}),
  }));
  for (const path of parents) {
    entries.push({ path, kind: "directory", ...(ignored.has(path) ? { isIgnored: true } : {}) });
  }
  return {
    entries,
    truncated:
      dotfiles.truncated ||
      result?.stdoutTruncated === true ||
      paths.length > MAX_IGNORED_ENTRIES ||
      ignoredPaths?.stdoutTruncated === true,
  };
});
