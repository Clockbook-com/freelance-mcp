# Freelance MCP server

> **Where this lives.** This repository is the distributable copy of the
> freelance MCP server. It is split out of the Clockbook enterprise monorepo
> (`packages-enterprise/freelance/mcp`), which remains the source of truth -
> changes land there and are mirrored here with `git subtree`. Two things are
> monorepo-only and deliberately absent: the live e2e harness, which boots the
> subgraph against a local Mongo, and the docs-catalogue generator, which writes
> into the freelance surface package.
>
> `npm run build` validates all 23 tool documents against the subgraph SDL when
> it can reach it. Outside the monorepo it says so and skips, rather than
> failing a build it cannot perform. Point `FREELANCE_SCHEMA_DIR` at
> `freelance/server/src/graphql/schema` (and `npm i --no-save graphql`) to run
> that check from a standalone clone.

Point any MCP-capable AI at the Clockbook freelance marketplace: the talent
directory, job postings, proposals, contracts with milestones and escrow, the
wallet, messages and notifications. Twenty-three tools over the same GraphQL
subgraph the freelance surface itself calls.

Works with Claude Desktop, Claude Code, Cursor, or anything else that speaks
MCP over stdio.

---

## What you need first

**A platform API token.** This module issues no credentials of its own. The
platform does: mint a Secret API token from your Account page. Such a token
already authenticates against the freelance subgraph with no further setup.

**An agent identity registered against it — strongly recommended.** An
unregistered token arrives holding your entire seat, because the platform token
has no notion of scopes and `defineAbilityFor` grants Manage to every org
member. Registering the token as an agent identity is how you *narrow* it: the
agent gets only the scopes you list, and you can switch it off later. It can
never do more than your seat could; scopes only take away.

---

## Setup

### 1. Mint a token

Account page → Secret API tokens → create one. Copy it; you will not see it
again.

### 2. Compute its digest

**The raw token is never sent to the server during registration.** You register
the SHA-256 digest, and you compute it yourself:

```bash
node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" <TOKEN>
```

That prints 64 lowercase hex characters. Nothing is lost by hashing client-side
— whoever can register a token already holds it — and it means the bearer is
never a mutation argument, never reaches a resolver, and cannot land in a trace
or an error message.

### 3. Register the agent

Run this against your plane's freelance subgraph, signed in **as a person** —
an agent may not register another agent, or the narrowest credential on the
system could mint itself a wider sibling:

```graphql
mutation {
    registerFreelanceAgentIdentity(
        input: {
            label: "Claude Desktop — my laptop"
            tokenDigest: "<the 64 hex characters from step 2>"
            scopes: [READ_DIRECTORY, READ_OWN]
        }
    ) {
        agentId
        label
        tokenHint
        scopes
    }
}
```

The scopes, and what each actually unlocks:

| Scope | What it allows |
| --- | --- |
| `READ_DIRECTORY` | Read the talent directory and job postings. |
| `READ_OWN` | Read your own contracts, proposals, wallet and notifications. |
| `DRAFT` | Create and edit draft postings and templates. Nothing that reaches a person. |
| `MESSAGE` | Send messages in existing threads. |
| `PROPOSE` | Submit and withdraw bids. |
| `HIRE` | Publish a requisition, invite, accept a bid, end a contract. Commitments, not money. |
| `SPEND` | Fund, release, refund, cash out. **The one nobody should grant casually.** |

Omit `scopes` entirely and you get `READ_DIRECTORY` and `READ_OWN` — read-only,
which is the right shape to start with. Add more once you have watched it work.

Revoke at any time with `revokeFreelanceAgentIdentity(agentId: "agent_…")`. It
bites on the agent's very next request, because liveness is part of the
per-request lookup and not a nightly sweep.

### 4. Build the server

Clone this repository and build it. There is nothing to install from a
registry — the server runs from `dist/`, which is gitignored, so the build is
not optional:

```bash
git clone https://github.com/Clockbook-com/freelance-mcp.git
cd freelance-mcp
npm install
npm run build
```

`npm run build` also validates all 23 tool documents against the freelance
subgraph SDL when it can reach it. From a standalone clone it cannot, so it
says so and skips rather than failing a check it has no way to perform — see
the note at the top of this file for how to run it anyway.

Note the absolute path of `dist/index.js` when this finishes; the next step
needs it:

```bash
echo "$PWD/dist/index.js"
```

### 5. Wire it into your client

**Claude Desktop** — `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
    "mcpServers": {
        "freelance": {
            "command": "node",
            "args": ["/absolute/path/to/freelance-mcp/dist/index.js"],
            "env": {
                "FREELANCE_API_TOKEN": "<your platform API token>",
                "FREELANCE_GRAPHQL_URL": "https://freelance-backend.clockbook-app-v10.cdebase.dev/graphql"
            }
        }
    }
}
```

Restart the client. The absolute path is not optional — the client does not run
this from your shell's working directory.

**Claude Code** — same JSON under `mcpServers`, or:

```bash
claude mcp add freelance \
  --env FREELANCE_API_TOKEN=<your platform API token> \
  --env FREELANCE_GRAPHQL_URL=https://freelance-backend.clockbook-app-v10.cdebase.dev/graphql \
  -- node /absolute/path/to/freelance-mcp/dist/index.js
```

**Cursor** — `.cursor/mcp.json` in the project, or `~/.cursor/mcp.json`
globally. Same `mcpServers` shape as Claude Desktop.

### 6. First test call

Ask the assistant:

> Using the freelance tools, who am I?

It should call `freelance_get_my_profile` and come back with your name, your
email and whether your profile is listed in the directory. That one call proves
all three things at once: the server started, the endpoint is right, and the
token authenticates.

Then try a read that touches the marketplace:

> Find me three people on the freelance marketplace who can do video editing.

---

## Configuration

| Setting | Environment variable | Config file key | Default |
| --- | --- | --- | --- |
| API token | `FREELANCE_API_TOKEN` | `apiToken` | *(none — calls refuse)* |
| Endpoint | `FREELANCE_GRAPHQL_URL` | `graphqlUrl` | `https://freelance-backend.clockbook-app-v10.cdebase.dev/graphql` |

**Environment wins over the file, always.** The config file exists for the case
the env lane handles badly — driving three clients without pasting the same
secret into three JSON files that sync to three different places:

```jsonc
// ~/.freelance-mcp/config.json
{
    "apiToken": "…",
    "graphqlUrl": "https://freelance-backend.clockbook-app-v10.cdebase.dev/graphql"
}
```

Point `FREELANCE_MCP_CONFIG` elsewhere if you want the file somewhere else.

**Set the endpoint if you are not on clockbook-app-v10.** A deployment plane is
a whole separate database, so a request that lands on the wrong one does not
fail — it silently addresses an organization you do not have. The host is
`freelance-backend.<your-plane>`.

---

## The tools

Reads first, then the writes — which is also the order to use them in, because
an id comes from a list and a title is never an id.

**Directory and profile:** `freelance_get_my_profile`,
`freelance_search_talent`, `freelance_get_profile`

**Job postings:** `freelance_search_jobs` (the whole marketplace),
`freelance_list_org_jobs` (your organization's own, any status),
`freelance_get_job`, `freelance_create_job`

**Proposals:** `freelance_list_my_proposals`,
`freelance_list_proposals_for_job`, `freelance_submit_proposal`,
`freelance_accept_proposal`

**Contracts and milestones:** `freelance_list_contracts`,
`freelance_get_contract`, `freelance_add_milestone`,
`freelance_submit_milestone`, `freelance_fund_milestone`,
`freelance_refund_milestone`, `freelance_approve_milestone`

**Wallet:** `freelance_get_wallet`

**Messaging:** `freelance_list_conversations`, `freelance_get_conversation`,
`freelance_send_message`

**Notifications:** `freelance_list_notifications`

Two tools have side effects that are easy to miss:
`freelance_get_conversation` **marks the thread read**, which clears the other
side's unread signal — so do not sweep an inbox to summarise it. And
`freelance_send_message` cannot be undone: there is no edit and no delete.

---

## Money: the acknowledgement gate

Three tools move real money, and all three need the `SPEND` scope, which the
server enforces:

- `freelance_fund_milestone` — commit a milestone's amount to escrow. Reversible.
- `freelance_refund_milestone` — take it back out. Reversible.
- `freelance_approve_milestone` — on a **funded** milestone, this *releases* the
  escrow to the freelancer. **Not reversible by anything in this product.**

That last one requires `acknowledge: true`, and the flag means one specific
thing: the person the agent is acting for was told the amount and the payee and
said yes to *that* release. Omit it on a funded milestone and the call is
refused — usefully:

```
This will release $1,250.00 USD to Dana Okafor, and it cannot be undone from
here. Re-send approveFreelanceContractMilestone with acknowledge: true to
release the escrow. [FREELANCE_ACKNOWLEDGEMENT_REQUIRED]
```

That sentence is the one to put in front of a person. The refusal is designed
to be read, not logged — which is why the amount and the payee are written into
the message itself and not only into `extensions`.

The gate is per call and never per session. A milestone's amount is editable
until it is funded, so an acknowledgement carried over from an earlier call is
consent to a different number.

---

## When something is refused

| What you see | What it means |
| --- | --- |
| `[FREELANCE_ACKNOWLEDGEMENT_REQUIRED]` | Confirm with the person, then re-send with `acknowledge: true`. |
| `[FREELANCE_AGENT_SCOPE_REQUIRED]` | The agent identity lacks the scope. A human grants it; retrying will not help. |
| `HTTP 401` / `HTTP 403` | The platform token expired, or its agent identity was revoked. Mint a fresh token, register its digest again, update `FREELANCE_API_TOKEN`. |
| `Could not reach the freelance backend at …` | Wrong plane, or nothing listening. Check `FREELANCE_GRAPHQL_URL`. |
| `No freelance API token is configured` | Neither the env var nor the config file had one. The message names the exact file it looked in. |

To see what the server thinks its configuration is, check your client's MCP
log. On startup it writes one line to stderr naming the endpoint, where the
token came from (`env`, `file` or `none`) and the tool count. It never prints
the token or its digest.

---

## Notes for maintainers

The GraphQL documents in `src/tools.ts` are **copies** of the ones in
`freelance/surface/src/api/operations.ts`, because the surface is a browser
package with its own lockfile and importing it would drag React into a stdio
process. Copies drift, and a document that names a field the schema does not
have fails *whole* — "Cannot query field", and that tool stops working.

Two things keep the drift survivable. The field lists here are deliberately
**slimmer** than the surface's: everything these tools return is read by a
language model, and the surface's lists exist to paint screens. Fewer fields is
both less context burned per row and a smaller drift surface. And every field
named here appears in a surface list already known to validate against this
schema.

All 23 documents were validated against the subgraph SDL in
`freelance/server/src/graphql/schema/*.graphql`, and every tool `inputSchema`
was checked against the corresponding GraphQL input type — argument names,
nested input-object field names and enum vocabularies. Worth redoing after any
schema change.

One deliberate divergence: `freelance_list_notifications` declares `side` as an
enum of `FIND_WORK | HIRE_TALENT`, while the schema types it as a plain
`String`. A model left to guess sends `"find_work"` and gets an empty feed,
which reads as "no notifications" rather than as an error. If the schema ever
gains a real enum, use it and delete the list.
