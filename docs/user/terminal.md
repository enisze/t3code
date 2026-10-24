# Terminal

## Run a command from a reply

On web and desktop, a finished one-line shell command in an agent reply can be
run from its code block. It runs in the thread's terminal, in the thread's
worktree when it has one and in the project folder otherwise.

## History

Each terminal keeps up to 5,000 lines and 8 MiB of scrollback on its environment
server. T3 Code removes the oldest output when either limit is reached. A long
line can be shortened at the start. New terminal output is not truncated.

These limits apply when you reconnect and when T3 Code restores saved terminal
history. A client can show less scrollback than the server keeps.
