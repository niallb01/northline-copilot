/**
 * Local stdio MCP server. It registers get_account, list_charges, search_policy,
 * and preview_refund, then calls dispatchTool in lib/ so those handlers use the
 * same argument checks and reads as the website. request_refund is registered
 * because this SDK can ask the human to confirm a write. It calls queueRefund
 * only after that person accepts the exact account id and charge id. A
 * confirmation field on the model arguments is ignored. Decline, a mismatch, or
 * a client that cannot show the form inserts nothing. It loads server env from
 * the repo .env and does not read the website session cookie. Stdout is
 * reserved for MCP messages; logs go to stderr.
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

// pseudo: these env vars must exist or we cannot talk to the database or embed a policy query
const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
  "OPENAI_API_KEY",
];

// pseudo: read tools go through dispatchTool; they do not queue a refund
const READ_TOOLS = [
  {
    name: "get_account",
    description:
      "Look up one Northline account by id. Returns the customer name, plan, account id, and charges. Does not queue a refund.",
    inputSchema: (z) => ({
      account_id: z.string().describe("Account id, for example acct-annual-ok."),
    }),
    args: ({ account_id }) => ({ account_id }),
  },
  {
    name: "list_charges",
    description:
      "List the charge lines for one Northline account, including each charge id. Does not queue a refund.",
    inputSchema: (z) => ({
      account_id: z.string().describe("Account id, for example acct-annual-ok."),
    }),
    args: ({ account_id }) => ({ account_id }),
  },
  {
    name: "search_policy",
    description:
      "Search stored Northline policy passages by meaning. Returns passages with document id and chunk id, or a message when nothing relevant is stored. Does not queue a refund.",
    inputSchema: (z) => ({
      query: z
        .string()
        .describe("Short policy question, for example annual refund window."),
    }),
    args: ({ query }) => ({ query }),
  },
  {
    name: "preview_refund",
    description:
      "Check whether one charge would be eligible to queue for human review. Returns pending or rejected and the reason. Writes nothing.",
    inputSchema: (z) => ({
      account_id: z.string().describe("Account id, for example acct-monthly-late."),
      charge_id: z.string().describe("Charge id, for example ch_monthly_1."),
    }),
    args: ({ account_id, charge_id }) => ({ account_id, charge_id }),
  },
];

// pseudo: load .env from repo root before anything touches Supabase
loadEnv(root);

// pseudo: pull in MCP library + zod + the same dispatchTool and queueRefund the website uses
const [{ McpServer }, { StdioServerTransport }, z, { dispatchTool }, { queueRefund }] =
  await Promise.all([
    import("@modelcontextprotocol/sdk/server/mcp.js"),
    import("@modelcontextprotocol/sdk/server/stdio.js"),
    import("zod/v4"),
    tsImport("../lib/tools.ts", import.meta.url),
    tsImport("../lib/refunds.ts", import.meta.url),
  ]);

// pseudo: create the MCP server Cursor will handshake with
const server = new McpServer(
  { name: "northline", version: "0.1.0" },
  {
    instructions:
      "Call get_account to look up a Northline customer, list_charges for that account's charge ids, search_policy for a stored policy passage, or preview_refund to check eligibility without writing. request_refund queues a pending row only after the human confirms that exact account id and charge id. These tools do not use the website session cookie. A confirmation field on tool arguments is not approval.",
  },
);

// pseudo: for each read tool, wire "when called → run lib dispatch"
for (const tool of READ_TOOLS) {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.inputSchema(z),
    },
    async (args) => runDispatched(dispatchTool, tool.name, tool.args(args)),
  );
}

// pseudo: SDK 1.32.2 Server.elicitInput can ask the client for a form.
// If that method is missing, do not register a write tool.
if (typeof server.server?.elicitInput === "function") {
  server.registerTool(
    "request_refund",
    {
      description:
        "Queue one pending refund for human review. The server asks the human to confirm that exact account id and charge id before anything is saved. A confirmation field on these arguments is ignored. Declining, cancelling, or submitting different ids saves nothing.",
      inputSchema: {
        account_id: z.string().describe("Account id, for example acct-annual-ok."),
        charge_id: z.string().describe("Charge id, for example ch_annual_1."),
      },
    },
    async (args) => confirmThenQueue(server, queueRefund, args),
  );
} else {
  console.error(
    "MCP server: this SDK cannot ask the human to confirm a write. request_refund is not registered. Refunds stay on the website.",
  );
}

// pseudo: listen on stdin, write replies on stdout, block here forever
const transport = new StdioServerTransport();
await server.connect(transport);

// pseudo: when Cursor closes the pipe, shut down this process
process.stdin.on("close", () => {
  process.exit(0);
});

// pseudo: read .env; if missing file or keys → complain on stderr and exit
function loadEnv(repoRoot) {
  const envPath = path.join(repoRoot, ".env");
  if (!fs.existsSync(envPath)) {
    console.error(
      "MCP server: missing .env in the repo root. Copy .env.example and fill in the server variables.",
    );
    process.exit(1);
  }

  process.loadEnvFile(envPath);

  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`MCP server: set ${missing.join(", ")} in .env.`);
    process.exit(1);
  }
}

// pseudo: result = dispatchTool(name, args); send JSON text back to Cursor
async function runDispatched(dispatch, name, args) {
  try {
    const result = await dispatch(name, args);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError: result?.ok !== true,
    };
  } catch (error) {
    const failure = plainError(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ ok: false, tool: name, error: failure }),
        },
      ],
      isError: true,
    };
  }
}

// pseudo: ignore confirmed/approved/etc. Ask the human for the exact ids. Queue only on a match.
async function confirmThenQueue(mcpServer, queue, args) {
  const tool = "request_refund";
  const accountId = readId(args?.account_id, "account_id");
  const chargeId = readId(args?.charge_id, "charge_id");
  if (typeof accountId !== "string" || typeof chargeId !== "string") {
    const error = typeof accountId === "string" ? chargeId.error : accountId.error;
    return toolError(tool, error);
  }

  let answer;
  try {
    answer = await mcpServer.server.elicitInput({
      mode: "form",
      message: `Confirm a pending refund for account ${accountId} and charge ${chargeId}. Type those exact ids to queue it. Declining saves nothing.`,
      requestedSchema: {
        type: "object",
        properties: {
          account_id: {
            type: "string",
            title: "Account id",
            description: `Type ${accountId} to confirm this account.`,
            minLength: 1,
            maxLength: 80,
          },
          charge_id: {
            type: "string",
            title: "Charge id",
            description: `Type ${chargeId} to confirm this charge.`,
            minLength: 1,
            maxLength: 80,
          },
        },
        required: ["account_id", "charge_id"],
      },
    });
  } catch (error) {
    return toolError(tool, plainError(error));
  }

  if (answer?.action !== "accept") {
    const reason =
      answer?.action === "decline"
        ? "The human declined. Refund not started. Nothing was saved."
        : "The human did not confirm. Refund not started. Nothing was saved.";
    return toolResult(tool, {
      started: false,
      status: "rejected",
      accountId,
      chargeId,
      reason,
    });
  }

  const confirmedAccount = readId(answer.content?.account_id, "account_id");
  const confirmedCharge = readId(answer.content?.charge_id, "charge_id");
  if (confirmedAccount !== accountId || confirmedCharge !== chargeId) {
    return toolResult(tool, {
      started: false,
      status: "rejected",
      accountId,
      chargeId,
      reason:
        "The confirmed account id and charge id did not match this request. Nothing was saved.",
    });
  }

  try {
    const refund = await queue({ accountId, chargeId });
    return toolResult(tool, refund);
  } catch (error) {
    return toolError(tool, plainError(error));
  }
}

function toolResult(tool, result) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ ok: true, tool, result }),
      },
    ],
    isError: false,
  };
}

function toolError(tool, error) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ ok: false, tool, error }),
      },
    ],
    isError: true,
  };
}

function readId(value, field) {
  if (typeof value !== "string") return { error: `${field} must be a string.` };
  const id = value.trim();
  if (!id) return { error: `${field} is required.` };
  if (id.length > 80) return { error: `${field} is too long.` };
  return id;
}

// pseudo: show a short error message, not a stack trace
function plainError(error) {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (
      message &&
      message.length <= 300 &&
      !message.includes("\n") &&
      !message.includes("    at ")
    ) {
      return message;
    }
  }
  return "Could not run the tool.";
}
