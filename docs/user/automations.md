# Automations

Open **Settings → Automations** on web, desktop, or mobile. Choose the environment,
create an automation, and select an active thread, a prompt, and a trigger.
Runs use that thread’s current model, workspace, and permissions. Approval requests
still need your response.

Choose an interval of at least one minute, or a time of day with a time zone and
optional weekdays. The environment must keep running; your clients can be closed.
Schedules survive restarts. After downtime, missed intervals produce one run;
fixed-time runs more than ten minutes late are skipped. Busy threads are skipped
instead of being interrupted.

Use **Run now** to send the saved prompt immediately, including while paused.
Pause stops future triggers and cancels deliveries still waiting to start. Edit,
resume, or delete an automation from the same page. History retains the latest
50 runs. **Started** means the prompt was sent; open its thread for the result.

## Webhook triggers

Choose **Webhook** and save. Copy the secret URL shown once, then configure your
sender to POST JSON to it. Use `{{payload}}` in the prompt to insert the JSON;
otherwise the payload is appended. The body limit is 64 KiB, with at most ten
deliveries per minute per automation.

Set `X-Webhook-Id` or `X-GitHub-Delivery` to a stable delivery ID when retrying.
Retries matching a retained run do not start another turn. A `202` response means
the delivery is recorded; history shows whether it started or was skipped.

Webhook senders need a directly reachable environment URL, such as an appropriate
Tailscale or tunnel address. A client’s T3 Connect relay connection does not expose
an external webhook receiver; append the copied webhook path to a direct server
origin instead. No client pairing cookie or token is required for this URL.

Keep the URL private. **Rotate webhook URL** creates a replacement and invalidates
the previous URL. Update the sender after rotating.
