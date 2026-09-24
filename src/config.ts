/**
 * Where this server sends requests, and what it presents when it gets there.
 *
 * ## Why the endpoint is resolved and not baked
 *
 * `surface/src/plane.ts` refuses to bake a host because one bundle serves every
 * deployment plane and each plane is a whole separate database - a request that
 * starts on one plane and lands on the other does not degrade, it silently
 * addresses somebody else's organization. That reasoning applies here with one
 * difference: the surface can read its plane off `window.location`, and a stdio
 * process started by Claude Desktop has no location to read. So the plane has
 * to be TOLD, and the only question is what happens when nobody tells it.
 *
 * The answer is a default rather than a refusal, and the default is
 * yantra-app-v1 - the plane the freelance surface itself is built against. A
 * server that refuses to start until somebody sets two environment variables is
 * a server most people never get working; one that starts pointed at the plane
 * almost everybody wants, and says which plane that is on every refusal, is
 * recoverable. Anybody on another plane sets `FREELANCE_GRAPHQL_URL` once, in
 * the same JSON block where they set the token.
 *
 * ## Why the token is env-first, file-second
 *
 * Every MCP client can set environment variables per server in its config, and
 * that is the path the README documents. The file exists for the case the env
 * lane handles badly: a person driving several clients (Desktop, Code, Cursor)
 * who does not want the same secret pasted into three JSON files that sync to
 * three different places. Precedence is env THEN file, never the reverse - the
 * more specific, more deliberate declaration wins, and a stale file can never
 * silently override what the client just passed.
 *
 * ## What this file will not do
 *
 * It will not read the cdecli login token out of `~/.cdecli`, and that is a
 * decision rather than an omission. That credential is a signed-in PERSON's
 * session; borrowing it would give this server the operator's entire seat, with
 * no agent identity behind it and therefore no scopes - exactly the shape
 * `server/src/utils/agent-scope.ts` exists to stop being the default. The token
 * here is meant to be one somebody minted on purpose and registered on purpose.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * The freelance subgraph on the plane most installations mean.
 *
 * This is the host the freelance surface is built against, and the one an
 * account minted on the current platform authenticates to.
 *
 * KNOWN DISAGREEMENT, recorded so the next person does not have to rediscover
 * it: `~/.cdecli/connectors/yantra-job-freelancer/package.json` (v1.1.1) still
 * carries `cdmConnector.meta.baseUrl` = clockbook-app-v10, which this constant
 * used to mirror. That plane is live - it answers, and rejects a token from
 * another org with `Not a member of organization "<org>"` rather than a
 * transport error - so the two are genuinely separate databases and not a
 * typo. The surface package references yantra-app-v1 exclusively, so the
 * connector is believed to be the stale one; if you are on clockbook-app-v10,
 * set `FREELANCE_GRAPHQL_URL` and nothing here has to change.
 */
export const DEFAULT_GRAPHQL_URL = 'https://freelance-backend.yantra-app-v1.cdebase.dev/graphql';

/** `~/.freelance-mcp/config.json`, unless `FREELANCE_MCP_CONFIG` names another. */
const DEFAULT_CONFIG_PATH = join(homedir(), '.freelance-mcp', 'config.json');

export interface FreelanceMcpConfig {
    graphqlUrl: string;
    /**
     * Null when nobody supplied one. NOT a startup failure - see `index.ts` for
     * why an unconfigured server still lists its tools.
     */
    token: string | null;
    /** Which lane the token came from, quoted verbatim in the "no token" refusal. */
    tokenSource: 'env' | 'file' | 'none';
    /** The path consulted, whether or not anything was there. Quoted in refusals. */
    configPath: string;
}

interface ConfigFileShape {
    apiToken?: unknown;
    graphqlUrl?: unknown;
}

/**
 * Read the config file, or return nothing at all.
 *
 * A MISSING file is the normal case and says nothing. A file that exists and is
 * malformed is a different situation entirely - somebody edited it, believes
 * they configured this server, and is about to be told their token is missing.
 * So that one warns, on stderr.
 *
 * STDERR AND NEVER STDOUT. Stdout is the MCP transport: a single stray line
 * written there is parsed as a JSON-RPC frame and takes down the session. Every
 * diagnostic in this package goes to stderr for that reason, and it is the one
 * rule here worth checking before adding a `console.log` anywhere.
 */
function readConfigFile(path: string): ConfigFileShape {
    let raw: string;
    try {
        raw = readFileSync(path, 'utf8');
    } catch {
        return {};
    }
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            console.error(`[freelance-mcp] ${path} is not a JSON object; ignoring it.`);
            return {};
        }
        return parsed as ConfigFileShape;
    } catch (error) {
        console.error(
            `[freelance-mcp] ${path} is not valid JSON (); ignoring it. ` +
                `Expected {"apiToken": "...", "graphqlUrl": "..."}.`,
        );
        return {};
    }
}

const trimmed = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const out = value.trim();
    return out ? out : null;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): FreelanceMcpConfig {
    const configPath = trimmed(env.FREELANCE_MCP_CONFIG) || DEFAULT_CONFIG_PATH;
    const file = readConfigFile(configPath);

    const envToken = trimmed(env.FREELANCE_API_TOKEN);
    const fileToken = trimmed(file.apiToken);
    const token = envToken || fileToken;

    return {
        graphqlUrl: trimmed(env.FREELANCE_GRAPHQL_URL) || trimmed(file.graphqlUrl) || DEFAULT_GRAPHQL_URL,
        token,
        tokenSource: envToken ? 'env' : fileToken ? 'file' : 'none',
        configPath,
    };
}

/**
 * The message a caller gets when there is no token, written to be acted on.
 *
 * It names both lanes and the exact file it looked in, because the failure it
 * has to survive is somebody who DID configure a token, in the place the other
 * client wanted it. Telling them "no token" without saying where we looked
 * leaves them editing the file that was already correct.
 */
export function describeMissingToken(config: FreelanceMcpConfig): string {
    return (
        'No freelance API token is configured, so this server cannot call the marketplace.\n' +
        `Set FREELANCE_API_TOKEN in this MCP server's env block, or put {"apiToken": "..."} in ${config.configPath}.\n` +
        'Mint the token on the platform Account page (Secret API tokens), then register it as an agent ' +
        'identity with registerFreelanceAgentIdentity so it is confined to the scopes you choose. ' +
        'See this package\'s README for the digest one-liner.\n' +
        `Endpoint currently in use: ${config.graphqlUrl}`
    );
}
