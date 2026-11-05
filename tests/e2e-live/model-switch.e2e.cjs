// Live end-to-end check for switching a Copilot session to a chosen model.
//
// Usage:
//   npm run test:model-switch
//   FID_MODEL="claude-haiku-4.5" npm run test:model-switch
//
// Requirements:
//   - `npm run build:node` output present (the npm script runs it).
//   - A signed-in Copilot account on this PC. The test copies the saved
//     secrets into a temporary userData directory and never writes the live
//     database or conversation.
//
// The test opens a real Copilot session through the production session code,
// asks for one short answer, and reports:
//   - the effective model from model.getCurrent
//   - the model reported by assistant.usage
//   - the model on the final assistant message
// It fails when the effective model or the usage model is not the requested
// model, or when the turn errors.

const { app } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const liveUserData = process.env.FID_CODER_LIVE_USER_DATA || path.join(os.homedir(), ".fid_coder_app");
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "fid-model-switch-"));
const resultFile = path.join(userData, "result.json");
const targetModel = process.env.FID_MODEL || "claude-haiku-4.5";
const turnTimeoutMs = Number(process.env.FID_MODEL_TIMEOUT_MS || 120_000);

app.setName("fid-coder-model-switch");
app.setPath("userData", userData);

function copySecrets() {
  const source = path.join(liveUserData, "secrets.bin.json");
  if (!fs.existsSync(source)) return false;
  fs.copyFileSync(source, path.join(userData, "secrets.bin.json"));
  return true;
}

function modelMatches(current, requested) {
  if (!current) return false;
  const left = String(current).trim().toLowerCase();
  const right = String(requested).trim().toLowerCase();
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

function slimUsage(data) {
  return {
    model: data?.model,
    isAuto: data?.isAuto,
    interactionType: data?.interactionType,
    inputTokens: data?.inputTokens,
    outputTokens: data?.outputTokens,
    aiCreditsStatus: data?.aiCreditsStatus,
    copilotUsage: data?.copilotUsage,
    provider: data?.provider,
  };
}

async function main() {
  const secretsCopied = copySecrets();
  const {
    getCopilotStatus,
    openSession,
    closeLiveSession,
    stopClient,
  } = require("../../dist/main/copilot/index.js");

  const status = await getCopilotStatus();
  console.log(
    "STATUS",
    JSON.stringify({
      secretsCopied,
      signedIn: status.signedIn,
      cliFound: status.cliFound,
      authStatus: status.authStatus,
    }),
  );
  if (!status.signedIn) {
    console.log("SKIP Copilot is not signed in.");
    return 0;
  }

  const sessionArgs = (model) => ({
    model,
    systemMessage: "Reply briefly. Do not use tools.",
    tools: [],
    getContext: () => ({}),
    onToolStart: () => undefined,
    onToolEnd: () => undefined,
  });

  const probe = await openSession(sessionArgs("auto"));
  const probeListed = await probe.session.rpc?.model?.list?.({ skipCache: true });
  const availableModels = (probeListed?.list ?? [])
    .map((item) => (typeof item.id === "string" ? item.id : ""))
    .filter(Boolean);
  console.log("SESSION MODELS", JSON.stringify(availableModels));
  await closeLiveSession(probe).catch(() => undefined);

  if (targetModel !== "auto" && !availableModels.some((id) => modelMatches(id, targetModel))) {
    console.error(
      `FAIL ${targetModel} is not available on this Copilot account. Available models: ${
        availableModels.length > 0 ? availableModels.join(", ") : "none (Auto only)"
      }`,
    );
    await stopClient().catch(() => undefined);
    return 1;
  }

  const targetEntry = (probeListed?.list ?? []).find((item) => {
    const id = typeof item.id === "string" ? item.id : "";
    return modelMatches(id, targetModel);
  });
  console.log("MODEL ENTRY", JSON.stringify(targetEntry, null, 2));

  const live = await openSession(sessionArgs(targetModel));

  const events = [];
  const unsubscribe = live.session.on((event) => {
    if (event.type === "assistant.usage") {
      events.push({ type: event.type, data: slimUsage(event.data) });
      return;
    }
    if (event.type === "assistant.message") {
      events.push({
        type: event.type,
        data: {
          model: event.data?.model,
          outputTokens: event.data?.outputTokens,
          content: String(event.data?.content ?? "").slice(0, 120),
        },
      });
      return;
    }
    if (
      event.type === "session.model_change" ||
      event.type === "session.model_deselected" ||
      event.type === "session.auto_mode_resolved" ||
      event.type === "session.auto_tier_recommendation" ||
      event.type === "session.auto_tier_switch_failed" ||
      event.type === "session.mode_changed" ||
      event.type === "auto_mode_switch.requested" ||
      event.type === "auto_mode_switch.completed" ||
      event.type === "session.error"
    ) {
      events.push({ type: event.type, data: event.data });
    }
  });

  const listed = await live.session.rpc?.model?.list?.({ skipCache: true });
  console.log("SESSION MODELS AFTER SWITCH", JSON.stringify((listed?.list ?? []).map((item) => item.id)));

  const before = await live.session.rpc?.model?.getCurrent?.();
  console.log("CURRENT BEFORE", JSON.stringify(before));

  let response = null;
  let error = null;
  try {
    response = await Promise.race([
      live.session.sendAndWait({ prompt: "Reply with only the word pong. Do not use tools." }, turnTimeoutMs),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("turn timed out")), turnTimeoutMs + 5_000),
      ),
    ]);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  const after = await live.session.rpc?.model?.getCurrent?.();
  const usage = events.filter((event) => event.type === "assistant.usage");
  const lastUsage = usage.length > 0 ? usage[usage.length - 1].data : null;
  const lastUsageModel = lastUsage?.model ?? null;
  const usageAuto = lastUsage ? lastUsage.isAuto === true : null;
  const responseModel = response?.data?.model ?? null;
  const effective = after?.modelId ?? null;
  const effectiveOk = targetModel === "auto" ? modelMatches(effective, "auto") : modelMatches(effective, targetModel);
  const usageOk = targetModel === "auto" ? usageAuto === true : modelMatches(lastUsageModel, targetModel);
  const responseModelOk =
    targetModel === "auto" ? usageAuto === true : modelMatches(responseModel, targetModel);
  const autoOk = targetModel === "auto" ? usageAuto === true : usageAuto !== true;

  const result = {
    targetModel,
    effective,
    lastUsageModel,
    usageAuto,
    responseModel,
    effectiveOk,
    usageOk,
    responseModelOk,
    autoOk,
    error,
    events,
    responseText: response?.data?.content ?? null,
  };
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));

  console.log("CURRENT AFTER", JSON.stringify(after));
  console.log("EVENTS", JSON.stringify(events, null, 2));
  console.log("RESPONSE", JSON.stringify({ model: responseModel, text: result.responseText, error }));
  console.log(
    "RESULT",
    JSON.stringify({
      targetModel,
      effective,
      lastUsageModel,
      usageAuto,
      responseModel,
      effectiveOk,
      usageOk,
      responseModelOk,
      autoOk,
      error,
    }),
  );

  unsubscribe();
  await closeLiveSession(live).catch(() => undefined);
  await stopClient().catch(() => undefined);

  if (error) {
    console.error(`FAIL ${error}`);
    return 1;
  }
  if (!effectiveOk) {
    console.error("FAIL the session did not end on the requested model");
    return 1;
  }
  if (!usageOk) {
    console.error("FAIL assistant.usage reported a different model");
    return 1;
  }
  if (!responseModelOk) {
    console.error("FAIL the assistant message reported a different model");
    return 1;
  }
  if (!autoOk) {
    console.error("FAIL the turn was served by Auto instead of the requested model");
    return 1;
  }
  console.log("PASS model switch");
  return 0;
}

setTimeout(() => {
  console.error("FAIL hard timeout");
  app.exit(1);
}, 180_000).unref();

app.whenReady().then(async () => {
  let code = 1;
  try {
    code = await main();
  } catch (error) {
    console.error("FAIL", error instanceof Error ? error.stack || error.message : String(error));
  } finally {
    app.exit(code);
  }
});
