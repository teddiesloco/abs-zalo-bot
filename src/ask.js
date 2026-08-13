// Legacy ask helpers kept for tests/MCP; Phase-1 brain path lives in inbound_router.js
export {
  isBotCommand,
  isBotCommand as looksLikeAsk,
  handleBotBrainCommand as handleDestinationAsk,
} from "./inbound_router.js";
export { resolveDestinationByName } from "./discovery.js";