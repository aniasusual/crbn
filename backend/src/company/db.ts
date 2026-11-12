import { SQL } from "bun";

const DEFAULT_POSTGRES_CORE =
  process.env.POSTGRES_URI_CORE ||
  "postgresql://username:password@127.0.0.1:5432/agenta_oss_core";
const DEFAULT_POSTGRES_TOKENS =
  process.env.POSTGRES_URI_SUPERTOKENS ||
  "postgresql://username:password@127.0.0.1:5432/agenta_oss_supertokens";

let coreDbInstance: SQL | null = null;
let tokensDbInstance: SQL | null = null;

export function getCoreDb(): SQL {
  if (!coreDbInstance) {
    coreDbInstance = new SQL(DEFAULT_POSTGRES_CORE, { max: 3 });
  }
  return coreDbInstance;
}

export function getTokensDb(): SQL {
  if (!tokensDbInstance) {
    tokensDbInstance = new SQL(DEFAULT_POSTGRES_TOKENS, { max: 3 });
  }
  return tokensDbInstance;
}
