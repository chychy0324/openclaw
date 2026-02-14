onfig) {
              logHooks.error("Hooks config not loaded");
              return true;
}

          const headers = normalizeHookHeaders(req.headers);
          const token = extractHookToken(headers, url.searchParams);
          const channel = resolveHookChannel(config, token);

          if (!channel) {
                        logHooks.error("Invalid hook token", { token });
                        return true;
          }

          const payload = normalizeAgentPayload(body);
          const deliver = resolveHookDeliver(channel, payload);

          dispatchAgentHook({
                        message: payload.message,
                        name: payload.name || "Webhook User",import type { TlsOptions } from "node:tls";
import type { WebSocketServer } from "ws";
import {
  createServer as createHttpServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { CanvasHostHandler } from "../canvas-host/server.js";
import type { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveAgentAvatar } from "../agents/identity-avatar.js";
import { handleA2uiHttpRequest } from "../canvas-host/a2ui.js";
import { loadConfig } from "../config/config.js";
import { handleSlackHttpRequest } from "../slack/http/index.js";
import { handleControlUiAvatarRequest, handleControlUiHttpRequest } from "./control-ui.js";
import { applyHookMappings } from "./hooks-mapping.js";
import {
  extractHookToken,
  getHookChannelError,
  type HookMessageChannel,
  type HooksConfigResolved,
  normalizeAgentPayload,
  normalizeHookHeaders,
  normalizeWakePayload,
  readJsonBody,
  resolveHookChannel,
  resolveHookDeliver,
} from "./hooks.js";
import { handleOpenAiHttpRequest } from "./openai-http.js";
import { handleOpenResponsesHttpRequest } from "./openresponses-http.js";
import { handleToolsInvokeHttpRequest } from "./tools-invoke-http.js";

type SubsystemLogger = ReturnType<typeof createSubsystemLogger>;

type HookDispatchers = {
  dispatchWakeHook: (value: { text: string; mode: "now" | "next-heartbeat" }) => void;
  dispatchAgentHook: (value: {
    message: string;
    name: string;
    wakeMode: "now" | "next-heartbeat";
    sessionKey: string;
    deliver: boolean;
    channel: HookMessageChannel;
    to?: string;
    model?: string;
    thinking?: string;
    timeoutSeconds?: number;
    allowUnsafeExternalContent?: boolean;
  }) => string;
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export type HooksRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

export function createHooksRequestHandler(
  opts: {
    getHooksConfig: () => HooksConfigResolved | null;
    bindHost: string;
    port: number;
    logHooks: SubsystemLogger;
  } & HookDispatchers,
): HooksRequestHandler {
  const { getHooksConfig, logHooks, dispatchWakeHook, dispatchAgentHook } = opts;

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", "http://" + (req.headers.host || "localhost"));

    if (url.pathname === "/webhook") {
      if (req.method === "GET") {
        res.statusCode = 200;
        res.end("Webhook is active");
        return true;
      }

      if (req.method === "POST") {
        try {
          const body = await readJsonBody(req);
          logHooks.info("Received webhook POST", { body });
          
          // Force return 200 OK for LINE Webhook verification
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ status: "ok" }));

          const config = getHooksConfig();
          if (!config) {
            logHooks.error("Hooks config not loaded");
            return true;
          }

          const headers = normalizeHookHeaders(req.headers);
          const token = extractHookToken(headers, url.searchParams);
          const channel = resolveHookChannel(config, token);

          if (!channel) {
            logHooks.error("Invalid hook token", { token });
            return true;
          }

          const payload = normalizeAgentPayload(body);
          const deliver = resolveHookDeliver(channel, payload);

          dispatchAgentHook({
            message: payload.message,
            name: payload.name || "Webhook User",
            wakeMode: "now",
            sessionKey: payload.sessionKey || "default",
            deliver,
            channel,
          });

          return true;
        } catch (err) {
          logHooks.error("Error processing webhook", { err });
          res.statusCode = 200; // Still return 200 to avoid LINE retries
          res.end(JSON.stringify({ status: "error" }));
          return true;
        }
      }
    }

    if (url.pathname === "/v1/chat/completions") {
      return handleOpenAiHttpRequest(req, res, {
        getHooksConfig,
        dispatchAgentHook,
        log: logHooks,
      });
    }

    if (url.pathname === "/v1/messages") {
      return handleOpenResponsesHttpRequest(req, res, {
        getHooksConfig,
        dispatchAgentHook,
        log: logHooks,
      });
    }

    if (url.pathname === "/v1/tools/invoke") {
      return handleToolsInvokeHttpRequest(req, res, {
        getHooksConfig,
        log: logHooks,
      });
    }

    if (url.pathname.startsWith("/a2ui/")) {
      return handleA2uiHttpRequest(req, res, {
        getHooksConfig,
        log: logHooks,
      });
    }

    if (url.pathname.startsWith("/slack/")) {
      return handleSlackHttpRequest(req, res, {
        getHooksConfig,
        dispatchAgentHook,
        log: logHooks,
      });
    }

    if (url.pathname === "/control-ui/avatar") {
      return handleControlUiAvatarRequest(req, res, {
        getHooksConfig,
        log: logHooks,
      });
    }

    if (url.pathname.startsWith("/control-ui/")) {
      return handleControlUiHttpRequest(req, res, {
        getHooksConfig,
        log: logHooks,
      });
    }

    return false;
  };
}

export function createHttpGatewayServer(
  opts: {
    getHooksConfig: () => HooksConfigResolved | null;
    bindHost: string;
    port: number;
    tls?: TlsOptions;
    logHooks: SubsystemLogger;
  } & HookDispatchers,
) {
  const { tls, bindHost, port, logHooks } = opts;
  const handler = createHooksRequestHandler(opts);

  const server = tls
    ? createHttpsServer(tls, async (req, res) => {
        if (!(await handler(req, res))) {
          res.statusCode = 404;
          res.end("Not Found");
        }
      })
    : createHttpServer(async (req, res) => {
        if (!(await handler(req, res))) {
          res.statusCode = 404;
          res.end("Not Found");
        }
      });

  server.listen(port, bindHost, () => {
    logHooks.info("HTTP Gateway listening on " + bindHost + ":" + port);
  });

  return server;
}
