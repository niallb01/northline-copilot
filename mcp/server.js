/**
 * Local stdio MCP server for Northline read tools. It registers get_account and
 * list_charges, then calls dispatchTool in lib/ so those handlers use the same
 * argument checks and database reads as the website. It loads SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, and DATABASE_URL from the repo .env. It does not
 * read the website session cookie, register a write tool, queue a refund, or
 * search policy. Stdout is reserved for MCP messages; logs go to stderr.
 */

// pseudo: grab file/path helpers + a way to import TypeScript from lib/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";

// pseudo: root = repo folder (one level up from mcp/)
const serverFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(serverFile), "..");

// pseudo: never print debug to stdout — Cursor owns stdout for MCP messages
console.log = console.error.bind(console);
console.info = console.error.bind(console);
console.debug = console.error.bind(console);

// pseudo: these env vars must exist or we cannot talk to the database
const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL"];

// pseudo: only two tools; both need an account_id string
const READ_TOOLS = [
  {
    name: "get_account",
    description:
      "Look up one Northline account by id. Returns the customer name, plan, account id, and charges. Does not queue a refund.",
  },
  {
    name: "list_charges",
    description:
      "List the charge lines for one Northline account, including each charge id. Does not queue a refund.",
  },
];

// pseudo: load .env from repo root before anything touches Supabase
loadEnv(root);

// pseudo: pull in MCP library + zod + the same dispatchTool the website uses
const [{ McpServer }, { StdioServerTransport }, z, { dispatchTool }] = await Promise.all([
  import("@modelcontextprotocol/sdk/server/mcp.js"),
  import("@modelcontextprotocol/sdk/server/stdio.js"),
  import("zod/v4"),
  tsImport("../lib/tools.ts", import.meta.url),
]);

// pseudo: create the MCP server Cursor will handshake with
const server = new McpServer(
  { name: "northline", version: "0.1.0" },
  {
    instructions:
      "Call get_account to look up a Northline customer, or list_charges for that account's charge ids. These tools do not use the website session cookie and they do not queue a refund.",
  },
);

// pseudo: for each tool name, wire "when called → run lib dispatch with account_id"
for (const tool of READ_TOOLS) {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: {
        account_id: z.string().describe("Account id, for example acct-annual-ok."),
      },
    },
    async ({ account_id }) => runReadTool(dispatchTool, tool.name, account_id),
  );
}

// pseudo: listen on stdin, write replies on stdout, block here forever
const transport = new StdioServerTransport();
await server.connect(transport);
devLog("stdio connected", { tools: READ_TOOLS.map((tool) => tool.name) });

// pseudo: when Cursor closes the pipe, shut down this process
process.stdin.on("close", () => {
  process.exit(0);
});

// pseudo: read .env; if missing file or keys → complain on stderr and exit
function loadEnv(repoRoot) {
  const envPath = path.join(repoRoot, ".env");
  if (!fs.existsSync(envPath)) {
    console.error("MCP server: missing .env in the repo root. Copy .env.example and fill in the server variables.");
    process.exit(1);
  }

  process.loadEnvFile(envPath);

  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`MCP server: set ${missing.join(", ")} in .env.`);
    process.exit(1);
  }
}

// pseudo: result = dispatchTool(name, { account_id }); send JSON text back to Cursor
async function runReadTool(dispatch, name, accountId) {
  devLog("tools/call received", { tool: name, arguments: { account_id: accountId } });
  try {
    const result = await dispatch(name, { account_id: accountId });
    devLog("tools/call returned", summarizeToolResult(result));
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError: result?.ok !== true,
    };
  } catch (error) {
    const failure = plainError(error);
    devLog("tools/call returned", { ok: false, tool: name, error: failure });
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: false, tool: name, error: failure }) }],
      isError: true,
    };
  }
}

// pseudo: only log when NODE_ENV=development — shows in Cursor MCP output (stderr), not the browser
function devLog(label, payload) {
  if (process.env.NODE_ENV !== "development") return;
  console.error(`[northline-mcp] ${label}`, payload);
}

function summarizeToolResult(result) {
  if (!result || typeof result !== "object") return { ok: false };
  if (result.ok === true && result.tool === "get_account") {
    return {
      ok: true,
      tool: result.tool,
      accountId: result.result?.id,
      customerName: result.result?.customerName,
      chargeCount: result.result?.charges?.length ?? 0,
    };
  }
  if (result.ok === true && result.tool === "list_charges") {
    return {
      ok: true,
      tool: result.tool,
      chargeIds: Array.isArray(result.result) ? result.result.map((row) => row.chargeId) : [],
    };
  }
  return { ok: false, tool: result.tool, error: result.error };
}

// pseudo: show a short error message, not a stack trace
function plainError(error) {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message && message.length <= 300 && !message.includes("\n") && !message.includes("    at ")) {
      return message;
    }
  }
  return "Could not run the tool.";
}
