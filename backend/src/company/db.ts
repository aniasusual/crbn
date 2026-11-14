import { SQL } from "bun";

const DEFAULT_POSTGRES_CORE =
  process.env.POSTGRES_URI_CORE ||
  "postgresql://username:password@127.0.0.1:5432/agenta_oss_core";
const DEFAULT_POSTGRES_TOKENS =
  process.env.POSTGRES_URI_SUPERTOKENS ||
  "postgresql://username:password@127.0.0.1:5432/agenta_oss_supertokens";

let coreDbInstance: SQL | null = null;
let tokensDbInstance: SQL | null = null;
let coreUriCached = "";
let tokensUriCached = "";

export function isPostgresConfigured(): boolean {
  const raw = (process.env.POSTGRES_URI_CORE || "").trim().toLowerCase();
  if (raw === "disabled" || raw === "none" || raw === "false" || raw === "0") {
    return false;
  }
  return true;
}

export function getCoreDb(): SQL {
  const currentUri = process.env.POSTGRES_URI_CORE || DEFAULT_POSTGRES_CORE;
  if (!coreDbInstance || coreUriCached !== currentUri) {
    coreUriCached = currentUri;
    coreDbInstance = new SQL(currentUri, { max: 3, connectionTimeout: 1.5 });
  }
  return coreDbInstance;
}

export function getTokensDb(): SQL {
  const currentUri = process.env.POSTGRES_URI_SUPERTOKENS || DEFAULT_POSTGRES_TOKENS;
  if (!tokensDbInstance || tokensUriCached !== currentUri) {
    tokensUriCached = currentUri;
    tokensDbInstance = new SQL(currentUri, { max: 3, connectionTimeout: 1.5 });
  }
  return tokensDbInstance;
}
