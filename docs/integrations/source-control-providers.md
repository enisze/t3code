# Source Control Integrations

T3 Code connects directly to your Git hosting provider so you can create pull requests, review code, and manage repositories without leaving your editor. Work stays in flow—no more jumping between browser tabs and terminal windows.

## Supported Providers

T3 Code works with the platforms your team already uses:

- **GitHub** – Pull requests, repository creation, and clone integration
- **GitLab** – Merge requests, repository publishing, and hosted clones
- **Bitbucket** – Pull request workflows (via API token authentication)
- **Azure DevOps** – Pull request support for Microsoft-hosted repositories

## What You Can Do

### Start Projects from Anywhere

**Clone repositories directly**

- Open the Command Palette (`Cmd/Ctrl + K`) → **Add Project**
- Choose **GitHub repository**, **GitLab repository**, **Bitbucket repository**, **Azure DevOps repository**, or paste any **Git URL**
- Enter the repository path (`owner/repo`, `group/project`, `workspace/repository`, or `project/repository`) or a full Git URL, pick a destination, and start coding

**Publish local projects to the cloud**

- Have a local Git repository without a remote?
- Use the **Publish Repository** action to create a new hosted repository (GitHub, GitLab, Bitbucket, or Azure DevOps), add it as your origin remote, and push—all in one flow
- Perfect for turning a weekend prototype into a real project

### Manage Code Reviews Without Context Switching

**Create pull requests while you work**

- Push a branch and create a pull request from the Git panel
- T3 Code can suggest titles and descriptions based on your commits
- Supports GitHub Pull Requests, GitLab Merge Requests, and Bitbucket Pull Requests

**Review branch changes without leaving the thread**

- **Changes** beside the Git actions opens the branch diff against its base, including after a pull request has been created
- **Review** inserts a configurable review prompt into the composer; edit it under **Settings → Source Control → Text generation**

**Stay on top of open reviews**

- See if your current branch already has an open PR/MR
- Open the review directly in your browser with one click
- Check out a teammate's branch to review code locally

### Know Your Setup at a Glance

The **Source Control settings** page shows you exactly what's connected:

- ✅ Which providers are authenticated and ready
- ⚠️ What's missing and how to fix it
- 👤 Which account is signed in (when available)

Run a quick **Rescan** after setting up a new machine or changing credentials.

### Use a Different GitHub Account per Project

If you juggle more than one GitHub identity — a work account and a personal one, say — you can attach a specific account to each project instead of relying on the machine-wide default.

**Set it up once:**

1. Sign in to each account with the GitHub CLI (you can be logged into several at the same time):
   ```bash
   gh auth login   # repeat for each account
   ```
   Confirm they're all listed with `gh auth status`.
2. In T3 Code, open a project's **GitHub account** selector and pick the account it should use. Choose **Use default account** to fall back to the machine-wide active account.

Once attached, every GitHub operation T3 Code runs for that project acts as the chosen account:

- **`gh` operations** — creating and listing pull requests, checking out a PR, viewing or creating repositories.
- **`git` over the network** — push, pull, fetch, and the background refresh that keeps each project's branch list and ahead/behind counts up to date (including the push half of **Commit, Push & PR**). T3 Code points Git's credential lookup for that host at the chosen account instead of letting your OS keychain answer with whichever account it cached first. Only that host is redirected, so credentials for other hosts keep working. If the project's remote is an SSH URL (`git@github.com:…`), T3 Code rewrites just that host to HTTPS for its own operations so the chosen account's token still applies — your stored remote URL is left unchanged.
- **The integrated terminal** — each terminal starts with `gh` and `git` already pinned to the project's account, so `gh repo view` and `git push` see the same repositories the app does. You don't need `gh auth switch`; switching globally won't help either, because the pin is per project.

T3 Code never stores your token; it asks the GitHub CLI for a short-lived token for that account only when it needs one, and it never changes which account is globally active, so projects on different accounts don't interfere with each other.

> **Notes:** A terminal picks up the account when it starts — restart an open terminal after changing the selection. If the selected account can't be used (its GitHub CLI token expired or was revoked), the **GitHub account** selector flags it and Git falls back to your default account until you re-run `gh auth login`. Commit authorship still comes from your Git config (`user.name`/`user.email`), not the selected account.

## Getting Started

### For GitHub (Recommended for most users)

1. Install the GitHub CLI on the machine running T3 Code:
   ```bash
   brew install gh
   ```
2. Sign in:
   ```bash
   gh auth login
   ```
3. Open **Settings → Source Control** in T3 Code and verify GitHub shows as authenticated

That's it—you can now clone, publish, and create pull requests.

### For GitLab

1. Install the GitLab CLI:
   ```bash
   brew install glab
   ```
2. Authenticate:
   ```bash
   glab auth login
   ```
3. Check **Settings → Source Control** to confirm the connection

### For Bitbucket

Bitbucket uses API tokens instead of a CLI tool:

1. Create an API token in your Atlassian account with read/write access to pull requests and repositories
2. Add these environment variables to the environment running T3 Code:
   ```bash
   export T3CODE_BITBUCKET_EMAIL="you@example.com"
   export T3CODE_BITBUCKET_API_TOKEN="your-token"
   ```
3. Restart T3 Code and verify the connection in **Source Control settings**

### For Azure DevOps

1. Install Azure CLI:
   ```bash
   brew install azure-cli
   ```
2. Add the DevOps extension:
   ```bash
   az extension add --name azure-devops
   ```
3. Sign in:
   ```bash
   az login
   ```

---

## Requirements & Troubleshooting

**Git is required** – T3 Code uses Git for all local operations. Ensure `git` is installed on your server.

**Server-side setup** – Authentication happens on the machine running T3 Code (the server), not your local browser. If you're using a hosted or team instance, your administrator may have already configured providers.

**Common issues:**

- **Provider shows "Not authenticated"** – Run the login command for that provider (e.g., `gh auth login`) in a terminal on the server, then rescan in Settings
- **Bitbucket not connecting** – Double-check your environment variables are set in the correct shell profile and the server was restarted
- **Can't push to a remote** – Verify your Git remote URL matches the provider you've authenticated with (SSH vs HTTPS remotes may need different credentials)

**Need more help?** Check your provider's CLI documentation:

- [GitHub CLI](https://cli.github.com/)
- [GitLab CLI](https://gitlab.com/gitlab-org/cli)
- [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/)
