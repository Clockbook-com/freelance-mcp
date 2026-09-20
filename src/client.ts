/**
 * The GraphQL POST, and the translation of a refusal into something an agent can
 * act on.
 *
 * ## Why this is fifty lines and not an Apollo client
 *
 * `surface/src/api/client.ts` is the model for the request itself - one POST,
 * `Authorization: Bearer <token>`, no cookies - but it also carries a
 * re-minting retry, because a browser tab lives for hours and its JWT expires
 * under it. Nothing here needs that. The credential is a long-lived platform
 * API token supplied by the MCP client's config; there is no session to re-mint
 * from, and a 401 means the token is wrong or revoked, which is a thing to SAY
 * rather than a thing to retry. Adding a retry would turn a one-line fix into a
 * silent doubling of every failing call.
 *
 * ## The error text is the product
 *
 * This server's only consumer is a language model. It cannot open a dialog, it
 * cannot read a stack trace, and it will do whatever the last sentence it read
 * suggested. Two of the subgraph's refusals are DESIGNED to be answered by the
 * caller rather than escalated to a human:
 *
 *   FREELANCE_ACKNOWLEDGEMENT_REQUIRED - re-send with `acknowledge: true`, and
 *       the message already carries the amount and the payee so the agent can
 *       tell the person what they are confirming (see
 *       `server/src/utils/money-acknowledgement.ts`).
 *   FREELANCE_AGENT_SCOPE_REQUIRED - this credential is registered without the
 *       scope; the fix is a human granting it, not a retry (see
 *       `server/src/utils/agent-scope.ts`).
 *
 * Both codes ride on `extensions.code`, and whether the federation gateway in
 * front of `freelance-backend.<plane>` forwards `extensions` untouched is
 * UNVERIFIED from outside the cluster - which is exactly why the server writes
 * the facts into `message` as well. So this formatter prints the message first
 * and the code second, and a response that lost its extensions in transit still
 * reads correctly. Never the other way round.
 */

import type { FreelanceMcpConfig } from './config.js';

interface GraphqlErrorShape {
    message?: unknown;
    extensions?: { code?: unknown; [key: string]: unknown } | null;
    path?: unknown;
}

interface GraphqlResponse<T> {
    data?: T | null;
    errors?: GraphqlErrorShape[] | null;
}

/**
 * A refusal from the subgraph, with the machine code kept whole.
 *
 * `code` is the FIRST code found across the errors rather than a list: a single
 * GraphQL request here runs one operation, so a response carrying two different
 * codes is not a case worth modelling, and flattening it to the first keeps the
 * property a caller can branch on.
 */
export class FreelanceGraphqlError extends Error {
    constructor(
        message: string,
        public readonly code: string | null = null,
        public readonly httpStatus: number | null = null,
    ) {
        super(message);
        this.name = 'FreelanceGraphqlError';
    }
}

const asString = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/**
 * One GraphQL error as a line of text: what went wrong, then the code, then
 * where in the document it happened.
 *
 * The code goes in square brackets AFTER the message on purpose - a model
 * reading top to bottom gets the actionable sentence first, and the token it
 * can match on second. Leading with `[CODE]` reads as a log line and invites
 * the model to summarise it away.
 */
function formatOne(error: GraphqlErrorShape): string {
    const message = asString(error.message) || 'Unknown GraphQL error';
    const code = asString(error.extensions?.code);
    const path = Array.isArray(error.path) ? error.path.join('.') : null;
    let line = message;
    if (code) line += ` [${code}]`;
    if (path) line += ` (at ${path})`;
    return line;
}

/**
 * What the subgraph SAID, for a response we are about to refuse on.
 *
 * A 401/403 from this backend still carries a GraphQL error body, and that
 * sentence names the actual cause ("no bearer token was presented", `Not a
 * member of organization "<org>"`) where the status alone cannot. Returns an
 * empty string rather than throwing: this runs on a path that is already
 * failing, and a parse error here must not replace a useful refusal with a
 * confusing one.
 *
 * The body is consumed, so callers must not read it again.
 */
async function readGraphqlMessage(response: Response): Promise<string> {
    let raw: string;
    try {
        raw = await response.text();
    } catch {
        return '';
    }
    if (!raw) return '';
    try {
        const parsed = JSON.parse(raw) as { errors?: { message?: unknown }[]; message?: unknown };
        const fromErrors = (parsed.errors || [])
            .map((error) => (typeof error?.message === 'string' ? error.message : ''))
            .filter(Boolean)
            .join('; ');
        if (fromErrors) return fromErrors;
        if (typeof parsed.message === 'string' && parsed.message) return parsed.message;
    } catch {
        /* Not JSON - fall through to the raw text, which is still better than nothing. */
    }
    return raw.slice(0, 300);
}

export class FreelanceClient {
    constructor(private readonly config: FreelanceMcpConfig) {}

    /**
     * Run one document. Throws `FreelanceGraphqlError` for anything the caller
     * should report rather than crash on.
     *
     * `variables` is passed through untouched. The tool catalogue names its
     * arguments EXACTLY as the operations declare their variables (the same
     * choice `surface/src/chat/freelanceAgent.ts` made for its own tool params),
     * so there is no mapping layer here to drift out of step with either side.
     */
    async request<T = unknown>(document: string, variables: Record<string, unknown> = {}): Promise<T> {
        if (!this.config.token) {
            // Callers check this first and never reach here; the guard stays so
            // that a future tool added without the check fails loudly rather
            // than sending an unauthenticated request that 401s confusingly.
            throw new FreelanceGraphqlError('No freelance API token is configured.');
        }

        let response: Response;
        try {
            response = await fetch(this.config.graphqlUrl, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    authorization: `Bearer ${this.config.token}`,
                },
                body: JSON.stringify({ query: document, variables }),
            });
        } catch (error) {
            // DNS, TLS, or nothing listening. Name the URL: the single most
            // common cause is a deployment on a plane other than the default,
            // and the address is the thing the reader has to change.
            throw new FreelanceGraphqlError(
                `Could not reach the freelance backend at ${this.config.graphqlUrl}: ${(error as Error).message}. ` +
                    'Check FREELANCE_GRAPHQL_URL names the freelance-backend host on your deployment plane.',
            );
        }

        if (response.status === 401 || response.status === 403) {
            /*
             * Deliberately NOT retried - see the header.
             *
             * THE SERVER'S OWN SENTENCE COMES FIRST, and that is a fix rather
             * than a flourish. This branch used to discard the body and print
             * one guess ("the token may have expired, or the agent identity may
             * have been revoked"), which is right for 401 and actively
             * misleading for the commonest 403: a token that is perfectly valid
             * but belongs to an organization that does not exist on the plane
             * `FREELANCE_GRAPHQL_URL` names. The subgraph says exactly that -
             * `Not a member of organization "<org>"` - and swallowing it sent
             * the reader off to mint a replacement token, which cannot help,
             * instead of at the endpoint, which is the thing to change.
             *
             * Observed live against clockbook-app-v10 with an adminide-v13
             * token: precisely the cross-plane mix-up `config.ts` warns about,
             * and the failure a wrong endpoint actually produces.
             */
            const detail = await readGraphqlMessage(response);
            const remedy =
                response.status === 403
                    ? 'A 403 usually means the token is valid but its organization is not on the plane ' +
                      `FREELANCE_GRAPHQL_URL names (currently ${this.config.graphqlUrl}) - check that host before ` +
                      'replacing the token. Otherwise the agent identity registered against it may have been revoked.'
                    : 'The platform API token is missing, malformed or expired. Mint a fresh one, register its ' +
                      "SHA-256 digest again, and update this server's FREELANCE_API_TOKEN.";
            // The subgraph's messages do not end in a full stop, so one is added
            // here rather than run straight into the remedy sentence.
            const said = detail ? `: ${detail}${/[.!?]$/.test(detail) ? '' : '.'}` : '.';
            throw new FreelanceGraphqlError(
                `The freelance backend rejected this request (HTTP ${response.status})${said} ${remedy}`,
                null,
                response.status,
            );
        }

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new FreelanceGraphqlError(
                `Freelance backend returned HTTP ${response.status}${body ? `: ${body.slice(0, 500)}` : ''}`,
                null,
                response.status,
            );
        }

        let payload: GraphqlResponse<T>;
        try {
            payload = (await response.json()) as GraphqlResponse<T>;
        } catch (error) {
            throw new FreelanceGraphqlError(
                `Freelance backend returned a non-JSON body: ${(error as Error).message}`,
                null,
                response.status,
            );
        }

        if (payload.errors?.length) {
            const code = payload.errors.map((e) => asString(e.extensions?.code)).find(Boolean) || null;
            throw new FreelanceGraphqlError(payload.errors.map(formatOne).join('\n'), code, response.status);
        }

        // A 200 with neither `data` nor `errors` is not a shape the spec allows,
        // but a proxy that swallowed the body produces it. Say so rather than
        // handing the caller `undefined` to destructure.
        if (payload.data == null) {
            throw new FreelanceGraphqlError(
                'Freelance backend returned no data and no errors. Something between this server and the subgraph ' +
                    'is rewriting responses.',
                null,
                response.status,
            );
        }

        return payload.data;
    }
}
