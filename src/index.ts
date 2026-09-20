#!/usr/bin/env node
/**
 * The stdio MCP server: tool calls in, GraphQL out.
 *
 * ## Why the low-level `Server` and not `McpServer`
 *
 * The SDK's high-level helper takes zod schemas and derives the JSON Schema it
 * advertises. Every input shape here is already pinned by the subgraph's own
 * GraphQL input types, so writing them as zod would mean describing each shape
 * twice and hoping the derivation matches what the schema actually accepts.
 * `tools.ts` writes the JSON Schema directly, and this file hands it over
 * unchanged, so what a client validates against is what was written down.
 *
 * ## Why a missing token does not stop the server starting
 *
 * The tempting shape is to exit(1) when there is no token. Do not: an MCP
 * client that fails to start a server shows "failed" and, in most of them,
 * nothing else - the person never sees the line explaining which environment
 * variable is missing, because that line went to a log they do not know about.
 * So this starts, advertises its whole catalogue, and refuses each CALL with a
 * message naming both places a token can live. The failure lands where somebody
 * is looking at it.
 *
 * ## Why every failure is a tool result and not a thrown error
 *
 * A tool result with `isError: true` goes to the MODEL, which is the only party
 * that can do anything about FREELANCE_ACKNOWLEDGEMENT_REQUIRED (re-send with
 * the flag, after asking) or FREELANCE_AGENT_SCOPE_REQUIRED (stop, and tell the
 * person which scope to grant). A protocol-level error goes to the client's
 * plumbing and typically reaches the model as "the tool failed", which throws
 * away the sentence that was the whole point of refusing that way. See the
 * header of `server/src/utils/money-acknowledgement.ts` for why those refusals
 * are written to be read.
 *
 * ## Stdout belongs to the transport
 *
 * One stray `console.log` is parsed as a JSON-RPC frame and kills the session.
 * Diagnostics go to stderr, here and in `config.ts`.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { FreelanceClient, FreelanceGraphqlError } from './client.js';
import { describeMissingToken, loadConfig } from './config.js';
import { TOOLS, TOOLS_BY_NAME, type FreelanceTool } from './tools.js';

const SERVER_NAME = 'freelance';
const SERVER_VERSION = '0.1.0';

const config = loadConfig();
const client = new FreelanceClient(config);

/**
 * Check the arguments a client actually sent against the tool's own
 * `required` list.
 *
 * This exists because the low-level server does NOT validate arguments against
 * the advertised `inputSchema` - that is the client's job, and clients vary in
 * whether they do it at all. Without this, a call that forgot `id` reaches the
 * subgraph as a GraphQL variable-coercion error, which names the variable's
 * type rather than the tool's argument and reads like a bug in this server.
 *
 * Deliberately shallow: only the top level, and only presence. Full JSON Schema
 * validation would mean an ajv dependency to re-derive what the server is about
 * to check properly anyway. The job here is turning the two or three mistakes a
 * model actually makes into a sentence it can act on.
 */
function missingRequiredArgs(tool: FreelanceTool, args: Record<string, unknown>): string[] {
    const required = (tool.inputSchema as { required?: unknown }).required;
    if (!Array.isArray(required)) return [];
    return required.filter((key): key is string => {
        if (typeof key !== 'string') return false;
        const value = args[key];
        return value === undefined || value === null || (typeof value === 'string' && !value.trim());
    });
}

const textResult = (text: string, isError = false) => ({
    content: [{ type: 'text' as const, text }],
    ...(isError ? { isError: true } : {}),
});

const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
        capabilities: { tools: {} },
        /*
         * Shown by clients that surface server instructions to the model. Kept
         * to the two things that are not deducible from any single tool
         * description: that this acts as one specific account, and that the
         * money tools are gated rather than merely discouraged.
         */
        instructions:
            'Tools for the Clockbook freelance marketplace: the talent directory, job postings, proposals, ' +
            'contracts with milestones and escrow, the wallet, messages and notifications. Every call acts as ' +
            'the one account whose API token this server was configured with - start with ' +
            'freelance_get_my_profile to see who that is. Reads are free to make. Writes reach real people or ' +
            'real money: confirm with the person you are acting for before creating a posting, sending a bid, ' +
            'hiring, messaging, or moving money. Releasing escrow additionally requires acknowledge: true, ' +
            'which means that person was told the amount and the payee and said yes to that specific release.',
    },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as { type: 'object'; [key: string]: unknown },
    })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const tool = TOOLS_BY_NAME.get(name);
    if (!tool) {
        return textResult(
            `Unknown tool "${name}". This server offers: ${TOOLS.map((t) => t.name).join(', ')}`,
            true,
        );
    }

    if (!config.token) {
        return textResult(describeMissingToken(config), true);
    }

    const args = (rawArgs ?? {}) as Record<string, unknown>;
    const missing = missingRequiredArgs(tool, args);
    if (missing.length) {
        return textResult(
            `${name} needs ${missing.map((key) => `\`${key}\``).join(' and ')}. ` +
                'Ids come from the corresponding list or search tool; a name or a title is never an id.',
            true,
        );
    }

    /*
     * SEND AN EMPTY `filter` RATHER THAN OMITTING IT, and this is not tidiness.
     *
     * Most list methods on the subgraph take `(filter, ctx)` with filter
     * OPTIONAL, and they are reached over a moleculer proxy that drops absent
     * params and closes the gap - so omitting `filter` shifts `ctx` into its
     * place, the service sees no `ctx.orgId`, and it answers `{totalCount: 0}`
     * instead of the caller's own rows. No error, no warning a model could act
     * on, just an empty list that looks like "you have nothing".
     *
     * Observed, not theorised: `freelance_list_org_jobs` with no arguments
     * returned 0 for a posting created seconds earlier through this same
     * server, and returned it correctly the moment a filter was present. The
     * surface never hit it because every one of its documents sends a filter.
     *
     * 15 service methods share that shape, so this defends every tool at once
     * rather than per-document. Harmless where the parameter is genuinely
     * absent: an empty filter is what "no filter" already meant.
     */
    const declaredProps = (tool.inputSchema?.properties ?? {}) as Record<string, unknown>;
    if (declaredProps.filter && !Object.keys((args.filter ?? {}) as object).length) {
        // `limit` and not `{}` or `{offset: 0}`: an EMPTY object is dropped by
        // the same proxy step that drops an absent one, and a zero is dropped
        // as falsy, so both still vanish. 25 is exactly what the repository
        // already defaults to (`filter.limit || 25`), so this changes no
        // result - it only keeps the parameter from disappearing.
        args.filter = { limit: 25 };
    }

    try {
        const data = await client.request(tool.document, args);
        // Pretty-printed, because the reader is a model and two extra kilobytes
        // of whitespace cost less than one misread nesting level.
        return textResult(JSON.stringify(data, null, 2));
    } catch (error) {
        if (error instanceof FreelanceGraphqlError) {
            // The message already carries the subgraph's own wording and its
            // `extensions.code`; passing it through unwrapped is the point.
            return textResult(error.message, true);
        }
        return textResult(`${name} failed: ${(error as Error).message}`, true);
    }
});

async function main(): Promise<void> {
    await server.connect(new StdioServerTransport());
    // One line on stderr so a person tailing the client's MCP log can see which
    // plane this process is pointed at and whether it found a credential -
    // the two facts behind almost every "it returns nothing" report. The token
    // itself is never printed, and neither is its digest.
    console.error(
        `[freelance-mcp] ready - endpoint ${config.graphqlUrl}, token from ${config.tokenSource}, ` +
            `${TOOLS.length} tools`,
    );
}

main().catch((error) => {
    console.error('[freelance-mcp] failed to start:', error);
    process.exit(1);
});
