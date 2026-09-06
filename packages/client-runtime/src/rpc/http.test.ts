import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClientError, HttpClientRequest } from "effect/unstable/http";

import { executeEnvironmentHttpRequest } from "./http.ts";

const transportError = (url: string) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({
      request: HttpClientRequest.get(url),
    }),
  });

const failingRequest = (url: string) =>
  executeEnvironmentHttpRequest(url, 10_000, Effect.fail(transportError(url)));

describe("executeEnvironmentHttpRequest", () => {
  it.effect("explains that a local-network address needs the same network", () =>
    Effect.gen(function* () {
      const url = "http://192.168.2.37:3773/.well-known/t3/environment";
      const error = yield* failingRequest(url).pipe(Effect.flip);

      assert.equal(error._tag, "RemoteEnvironmentAuthFetchError");
      // The raw transport detail stays, so the message is still diagnosable.
      assert.include(error.message, `Failed to fetch remote environment endpoint ${url}`);
      assert.include(error.message, "Transport error");
      // ...and the part a user can act on names the host and the actual cause.
      assert.include(error.message, "Nothing answered at 192.168.2.37:3773");
      assert.include(error.message, "same local network");
      assert.include(error.message, "mobile data cannot reach it");
    }),
  );

  it.effect("hints for every private range a desktop can land on", () =>
    Effect.gen(function* () {
      for (const host of ["10.0.0.4:3773", "172.16.5.6:3773", "127.0.0.1:3773", "macbook.local"]) {
        const error = yield* failingRequest(`http://${host}/.well-known/t3/environment`).pipe(
          Effect.flip,
        );
        assert.include(error.message, `Nothing answered at ${host}`);
      }
    }),
  );

  it.effect("leaves routable hosts with the plain transport message", () =>
    Effect.gen(function* () {
      const url = "https://app.t3.codes/.well-known/t3/environment";
      const error = yield* failingRequest(url).pipe(Effect.flip);

      assert.include(error.message, "Failed to fetch remote environment endpoint");
      assert.notInclude(error.message, "Nothing answered at");
      assert.notInclude(error.message, "mobile data");
    }),
  );

  // `live` because the timeout has to elapse on the real clock.
  it.live("does not hint on a timeout, which reports its own reason", () =>
    Effect.gen(function* () {
      const url = "http://192.168.2.37:3773/.well-known/t3/environment";
      const error = yield* executeEnvironmentHttpRequest(url, 1, Effect.never).pipe(Effect.flip);

      assert.equal(error._tag, "RemoteEnvironmentAuthTimeoutError");
      assert.notInclude(error.message, "Nothing answered at");
    }),
  );
});
