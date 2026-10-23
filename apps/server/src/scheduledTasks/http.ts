import { ScheduledTaskError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  HttpIncomingMessage,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";

import { ScheduledTasks } from "./ScheduledTasks.ts";

const MAX_WEBHOOK_BODY_BYTES = 65_536;
const decodeWebhookPayload = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

export const handleWebhook = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const url = HttpServerRequest.toURL(request);
  if (Option.isNone(url)) return HttpServerResponse.empty({ status: 404 });
  const match = /^\/api\/hooks\/([\w-]+)\/([\w-]+)$/.exec(url.value.pathname);
  if (!match) return HttpServerResponse.empty({ status: 404 });
  const tasks = yield* ScheduledTasks;
  const contentLength = request.headers["content-length"];
  if (
    contentLength !== undefined &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_WEBHOOK_BODY_BYTES)
  ) {
    return HttpServerResponse.text("Webhook payload exceeds 64 KiB.", { status: 413 });
  }
  const body = yield* request.text.pipe(
    Effect.provideService(HttpIncomingMessage.MaxBodySize, FileSystem.Size(MAX_WEBHOOK_BODY_BYTES)),
    Effect.mapError(
      () =>
        new ScheduledTaskError({
          reason: "invalid",
          message: "Could not read webhook JSON (64 KiB limit).",
        }),
    ),
  );
  if (Buffer.byteLength(body) > MAX_WEBHOOK_BODY_BYTES)
    return HttpServerResponse.empty({ status: 413 });
  const payload = yield* decodeWebhookPayload(body).pipe(
    Effect.mapError(
      () => new ScheduledTaskError({ reason: "invalid", message: "Send a JSON webhook payload." }),
    ),
  );
  const delivery = yield* tasks.triggerWebhook(
    match[1]!,
    match[2]!,
    { body: payload, headers: request.headers, query: url.value.search.replace(/^\?/, "") },
    request.headers["x-webhook-id"] ?? request.headers["x-github-delivery"],
  );
  return yield* HttpServerResponse.json(
    delivery.outcome === "filtered"
      ? { status: "filtered", reason: delivery.reason }
      : {
          runId: delivery.run.id,
          status: delivery.outcome === "coalesced" ? "coalesced" : delivery.run.status,
          ...(delivery.run.dueAt === undefined ? {} : { dueAt: delivery.run.dueAt }),
        },
    {
      status: 202,
      headers: { "cache-control": "no-store" },
    },
  );
}).pipe(
  Effect.catchTag("ScheduledTaskError", (error) =>
    HttpServerResponse.json(
      { error: error.message },
      {
        status:
          error.reason === "unauthorized" || error.reason === "not_found"
            ? 404
            : error.reason === "disabled"
              ? 409
              : error.reason === "rate_limited"
                ? 429
                : error.reason === "internal"
                  ? 500
                  : 400,
        headers: { "cache-control": "no-store" },
      },
    ),
  ),
);

export const webhookRouteLayer = HttpRouter.add("POST", "/api/hooks/*", handleWebhook);
