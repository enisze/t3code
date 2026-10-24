# Messages and context

Give the agent a task in the composer. Add files, quote a previous response, or
include a skill when the task needs more context.

Messages can contain up to 120,000 characters. Longer drafts stay in the composer
so you can shorten them or split them into several messages.

## Attach files

Attach up to eight files per message. Images can be up to 10 MB; other files can
be up to 50 MB, subject to the environment's upload support and limit. The agent
receives them on the environment's machine.

Uploads begin when you add an attachment. All uploads must finish before the
message can send. Retry or remove a failed upload. On web and desktop, reloading
before an upload finishes requires you to attach that file again.

You can drag or paste images into the web or desktop composer. HEIC and HEIF
photos are converted to JPEG there and when selected from the iOS photo library;
the image limit applies after conversion. On mobile, you can also send files to
T3 Code through another app's system share sheet.

See [images and videos](#images-and-videos-in-messages) for previewing and saving media.

## Send while the agent is working

On web and desktop, a message you send during a running turn goes to the agent
right away and steers its current turn. To hold follow-ups instead, choose **Queue**
in **Settings → General → Follow-up behavior**. This setting applies to the current
client. Press `mod+Enter` to do the opposite for one message; see
[Composer controls](./keybindings.md#composer-controls).

A queued message waits at the end of the conversation as a dashed bubble. It goes
out on its own when the agent finishes its next tool call, or when the turn ends,
even while you have another thread open. While messages are queued, a new message
lines up behind them. Use the arrow in the bubble to send it right away, or the X to
move it back into the composer. Stop returns every queued message to the composer.
Queued messages live only in the open app, so a reload discards them.

Use `Cmd+Shift+Enter` on macOS or `Ctrl+Shift+Enter` on Windows and Linux to send
the oldest queued message now. Change `thread.steerQueuedMessage` in
**Settings → Keybindings** to use another shortcut. It leaves the current draft
in the composer and waits if the agent needs an approval or an answer.

## Queue messages offline on mobile

Mobile keeps local copies of draft attachments, so you can preview them and queue
messages while disconnected. Uploads resume when you reconnect. Drafts and queued
messages survive app restarts. Signing out of T3 Connect keeps that work on your
device until you sign back into the same account.

## Custom models

On web and desktop, use Settings → Providers → **Models** to add an unlisted model with a custom
name and options. Only options supported by the provider integration affect turns. Antigravity
uses its account catalog and does not support custom models.

## Model defaults

T3 Code remembers your provider, model, and model options for new threads. A
project's configured model takes precedence; resetting that project setting
returns to the remembered selection.

Leaving reasoning level or service tier unset uses the provider's own configuration.

## Quote an assistant response

On web and desktop, select text within one assistant response and choose
**Cite in composer**. You can add a comment about the quote and write instructions
around it.

Select the quote in a draft or sent message to return to its source. If the source
is unavailable or has changed, the saved quote remains readable.

Mobile displays saved quotes and comments, but does not create citations or
navigate to their sources.

## Recall a sent prompt

Press `ArrowUp` in an empty composer to bring back the last prompt you sent in this thread. Press
`ArrowUp` again to go further back, and `ArrowDown` to come forward. Moving forward past the newest
prompt clears the composer. Recall walks the prompts loaded in the thread. Attachments, terminal
context, and other extras from the original message are not restored, only the text you typed. A
composer that holds an attachment or a picked element does not count as empty.

When the composer has text, the arrow keys move the caret as usual. Recall takes over only while
the text is an unedited recalled prompt, with the caret on the first visual line for `ArrowUp` or
the last visual line for `ArrowDown`, counting wrapped lines. Editing a recalled prompt turns it
into a normal draft.

## Revert to an earlier message

On web and desktop, choose **Revert to this message** beneath a sent message to
rewind the thread to before it. Choose **Revert and keep changes** to leave
workspace files as they are, or **Revert files too** to restore them as well.

This removes the selected message and later conversation from the thread and
provider history. It does not undo external actions or separate provider memory.
The action is available only when the provider supports rewind.

## Prompt stash

On web and desktop, press `Cmd+S` on macOS or `Ctrl+S` on Windows and Linux to save
the current prompt and its attachments for later. Wait for uploads to finish first.
With an empty composer, the same shortcut restores a single stash or opens the
stash menu when there are several.

Stashes containing uploaded files must be restored in their original environment.
Those files are retained for 24 hours. After an upload expires, restore the prompt
and use **Attach again** or remove the missing file before sending.

## Voice input

Use the composer's microphone to record, then stop to finish. Text is inserted
where your selection was when recording started, ready for you to review and edit
before sending. Sending is held until the transcript lands, so it cannot arrive
after the message it belongs to.

In the Mac desktop app the text appears as you speak and is corrected as the
engine hears more, so the composer is read-only while recording; stopping
replaces it with the finished transcript. On iPhone the text arrives once, after
you stop.

Voice input needs Apple's on-device speech engine, so the microphone appears on
supported iPhones with iOS 26 or later, and in the Mac desktop app on macOS 26 or
later. It is not available in a browser, or on Windows and Linux.

Dictation follows your device language. To dictate in a different language than
your Mac is set to, choose one under Settings › General › Dictation language. The
list shows what the engine can transcribe on your machine and marks languages
whose model downloads on first use.

The first use may download Apple's speech model and needs a network connection.
Later transcription works offline for that language. Recordings can be up to five
minutes long. Canceling, leaving the screen, or an audio interruption discards the
recording and preserves your existing draft.

Transcription runs on your device. T3 Code deletes the temporary audio after
transcription or cancellation; only the message text is sent when you submit.

macOS asks for microphone permission the first time you record. If you declined
earlier, re-enable T3 Code under System Settings › Privacy & Security › Microphone.

## Commands and skills

Type `/` for commands or `$` to add a skill from the selected environment and
provider. On mobile, both are also available before starting a thread on
**New task**.

The slash menu includes the provider's own commands for the project, such as
OpenCode project commands. Cursor reports its commands when a session starts, so
they appear after your first message in a project.

The `$` menu lists only skills enabled for the provider. On mobile, the slash menu
lists them too.

After you add or change skills, plugins, or MCP servers, use **Restart agent
session** in the command palette on web and desktop. The conversation continues,
and your next message starts the agent again with the new setup.

Provider commands must start the message to run. T3 Code commands such as
`/model` and `/plan`, and skill mentions, work on any line.

Send `/compact` in an existing conversation to reduce context usage when the
provider supports it. Web and desktop also offer compaction from the context meter.

## Images and videos in messages

Select an image or video attachment or link to preview it. Playback support depends
on your browser or device; save an unsupported video to open it in another app.

On web and desktop, right-click media to save it or copy its path or URL. On mobile,
touch and hold an image or video thumbnail and choose **Save or share**. On iOS,
return to the thumbnail to open this menu after watching a full-screen video.

File links refer to the environment's machine, including when you connect remotely.
Previews use the original file, even outside the workspace. Moving or deleting it
can break the preview, so save a copy if you need to keep it.

## Files outside the workspace

Follow an agent's file link to read a report or other file outside the workspace.
These files open read-only. An HTML file outside the workspace cannot load scripts,
styles, or images from neighboring files.

## HTML and PDF files in the file viewer

On web and desktop, HTML and PDF files open as rendered pages. Switch an HTML
file to source view to read its markup; a link to a specific line opens source
automatically. HTML previews cannot access your T3 Code session.

On mobile, select a PDF attachment or link to open it. iOS uses the native viewer;
Android opens the system chooser.
