/** Headless evaluation of the same createAgentSession engine used by SessionBridge. */
import { mkdirSync, appendFileSync, writeFileSync, readFileSync } from "node:fs";
import { createAgentSession, SessionManager, Settings, AuthStorage, ModelRegistry } from "../../pi-harness/packages/coding-agent/src/index";

const [modelId, effort, instructionPath, logs] = process.argv.slice(2);
if (!["gpt-6.1-sol", "gpt-6-astra"].includes(modelId) || effort !== "medium") {
  throw new Error("Expected gpt-6.1-sol or gpt-6-astra with medium effort");
}
mkdirSync(logs, { recursive: true });
const auth = await AuthStorage.create(":memory:");
const raw = JSON.parse(readFileSync(process.env.BENCH_CODEX_AUTH!, "utf8"));
const token = raw.tokens?.access_token;
if (!token) throw new Error("Codex subscription login required; no API fallback allowed");
const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
await auth.credentials.set("openai-codex", {
  type: "oauth", access: token, refresh: raw.tokens.refresh_token,
  expires: payload.exp * 1000, accountId: raw.tokens.account_id,
});
const registry = new ModelRegistry(auth);
const model = registry.find("openai-codex", modelId);
if (!model) throw new Error(`Exact model unavailable: ${modelId}`);
const settings = Settings.isolated({
  "retry.modelFallback": false,
  "retry.enabled": false,
  "autolearn.enabled": false,
});
const { session } = await createAgentSession({
  cwd: process.cwd(), agentDir: "/tmp/80degrees-agent", model,
  thinkingLevel: "medium", thinkingLevelCeiling: "medium",
  authStorage: auth, modelRegistry: registry, settings,
  sessionManager: SessionManager.create(process.cwd(), `${logs}/sessions`),
  interactivePrompts: false, cacheWarming: false, allowSessionModelFallback: false,
  openAIServiceTier: null,
  toolNames: ["read", "bash", "edit", "write", "grep", "todo"],
});
writeFileSync(`${logs}/identity.json`, JSON.stringify({
  model: session.model?.id, provider: session.model?.provider,
  reasoning_effort: session.thinkingLevel, profile: "80degrees-headless-single-agent-v1",
  tools: session.agent.state.tools.map(t => t.name),
}, null, 2));
if (session.model?.id !== modelId || session.thinkingLevel !== effort) throw new Error("Model/effort mismatch");
session.subscribe(event => {
  if (event.type !== "message_update") appendFileSync(`${logs}/events.jsonl`, JSON.stringify(event) + "\n");
});
let failed = false;
let safetyRefusal = false;
try {
  await session.prompt(readFileSync(instructionPath, "utf8"));
  const errors = session.messages.filter(m => m.role === "assistant" && m.stopReason === "error");
  failed = errors.length > 0;
  safetyRefusal = errors.some(m => /cyber_policy|flagged for possible cybersecurity risk/i.test(String((m as any).errorMessage ?? "")));
} finally {
  writeFileSync(`${logs}/stats.json`, JSON.stringify(session.getSessionStats(), null, 2));
  writeFileSync(`${logs}/outcome.json`, JSON.stringify({ failed, safety_refusal: safetyRefusal }, null, 2));
  await session.dispose();
  auth.close();
}
// Match Harbor Codex semantics: a policy refusal is a completed agent outcome
// and must proceed to the verifier (normally scoring 0), not an infra failure.
process.exit(failed && !safetyRefusal ? 1 : 0);
