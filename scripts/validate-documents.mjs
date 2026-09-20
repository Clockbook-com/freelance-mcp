#!/usr/bin/env node
/**
 * THE DRIFT GUARD.
 *
 * This package deliberately does NOT share its GraphQL documents with
 * `surface/src/api/operations.ts`. The surface's field lists exist to paint
 * screens - JOB_POSTING_FIELDS alone carries the AI-interview script and the
 * auto-message table - and every field a tool asks for is read by a MODEL, so
 * the tool documents are deliberately slimmer. Sharing them would make every
 * agent response several times larger for no gain.
 *
 * The cost of that choice is drift: a field renamed in the subgraph fails the
 * WHOLE document at validation ("Cannot query field"), taking the tool down
 * with it, and nothing would notice until an agent called it. So instead of
 * sharing the documents, this validates them against the real SDL - which
 * catches both drift AND any schema change, which sharing would not.
 *
 * Run in CI. It needs no server and no credential: it builds the schema from
 * the .graphql files on disk and asks graphql-js whether each document is
 * legal against it.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The subgraph SDL, which lives in the MONOREPO beside this package and not in
 * this repository. Absent here, and that is the normal case: this repo is the
 * distributable server, and the schema it is checked against is the freelance
 * module's. When it is missing the check SKIPS rather than fails - see below.
 *
 * `FREELANCE_SCHEMA_DIR` overrides it, which is how you run this check from a
 * clone that sits somewhere other than `<monorepo>/freelance/mcp`.
 */
const SCHEMA_DIR = process.env.FREELANCE_SCHEMA_DIR || join(HERE, '..', '..', 'server', 'src', 'graphql', 'schema');

if (!existsSync(SCHEMA_DIR)) {
    console.log(
        `No subgraph SDL at ${SCHEMA_DIR} - skipping document validation.\n` +
            'This check runs in the monorepo, where freelance/server sits beside this package. ' +
            'Point FREELANCE_SCHEMA_DIR at that schema directory to run it from elsewhere.',
    );
    process.exit(0);
}

/*
 * `graphql` is resolved rather than declared as a devDependency: a published
 * MCP server has no business carrying a compiler-sized dep for a check that
 * only ever runs in the repo. Resolution walks up from THIS FILE, so it finds
 * the monorepo's copy when this package sits inside it - and says what to do
 * when it does not, instead of dying on a stack trace.
 */
const require_ = createRequire(import.meta.url);
let buildSchema;
let parse;
let validate;
let specifiedRules;
try {
    ({ buildSchema, parse, validate, specifiedRules } = require_('graphql'));
} catch {
    console.log(
        'The `graphql` package is not resolvable from here - skipping document validation.\n' +
            'It is intentionally not a dependency of this server; the check runs in the monorepo, ' +
            'or after `npm i --no-save graphql`.',
    );
    process.exit(0);
}

/**
 * The SDL as written is a FEDERATION SUBGRAPH fragment: it `extend`s Query and
 * Mutation, leans on types the gateway owns, and carries mesh directives. None
 * of that parses standalone, so the missing half is stubbed. The stubs only
 * have to make the schema buildable - every type a tool actually selects from
 * is defined for real in the files below.
 */
const STUBS = `
directive @entity(embedded: Boolean) on OBJECT
directive @column(overrideType: String) on FIELD_DEFINITION
directive @id on FIELD_DEFINITION
directive @link(overrideType: String) on FIELD_DEFINITION
directive @embedded on OBJECT
directive @map(path: String) on FIELD_DEFINITION
scalar DateTime
scalar JSON
type Organization { id: ID name: String }
enum PermissionType { Allow Deny }
enum PermissionResource { Freelance }
type OrganizationPermissions { id: ID }
type Query { _root: String }
type Mutation { _root: String }
`;

const sdl =
    STUBS +
    readdirSync(SCHEMA_DIR)
        .filter((f) => f.endsWith('.graphql'))
        .map((f) => readFileSync(join(SCHEMA_DIR, f), 'utf8'))
        .join('\n');

let schema;
try {
    schema = buildSchema(sdl, { assumeValidSDL: true });
} catch (err) {
    console.error('Could not build the schema from', SCHEMA_DIR);
    console.error(err.message);
    process.exit(2);
}

const { TOOLS } = await import(pathToFileURL(join(HERE, '..', 'dist', 'tools.js')).href);

let failed = 0;
for (const tool of TOOLS) {
    let doc;
    try {
        doc = parse(tool.document);
    } catch (err) {
        console.error(`✗ ${tool.name}: unparseable document - ${err.message}`);
        failed++;
        continue;
    }
    const errors = validate(schema, doc, specifiedRules);
    if (errors.length) {
        console.error(`✗ ${tool.name}`);
        for (const e of errors.slice(0, 3)) console.error(`    ${e.message}`);
        failed++;
        continue;
    }
    /*
     * Second check, and the one a pure `validate` misses: `index.ts` passes the
     * tool's arguments straight through as GraphQL variables, so a JSON Schema
     * property name that is not a declared variable is silently dropped and the
     * call goes out missing an argument. Property name MUST equal variable name.
     */
    const declared = new Set(
        (doc.definitions[0].variableDefinitions || []).map((v) => v.variable.name.value),
    );
    const props = Object.keys(tool.inputSchema?.properties || {});
    const orphans = props.filter((p) => !declared.has(p));
    if (orphans.length) {
        console.error(`✗ ${tool.name}: input properties with no matching $variable: ${orphans.join(', ')}`);
        failed++;
    }
}

/*
 * THIRD CHECK: enum VALUES in the JSON Schema.
 *
 * `validate` above proves the document is legal, and the variable check proves
 * the argument names line up - but neither looks inside `inputSchema`. A tool
 * that offers a model `budgetType: ["HOURLY", "FIXED"]` when the SDL says
 * FIXED_PRICE passes both and still fails at runtime with BAD_USER_INPUT, and
 * the model has no way to know: it picked from the list it was given. A live
 * call is what surfaced that class of bug, so it is worth catching in the build.
 *
 * Matched by value rather than by path: mapping each JSON Schema property back
 * to its GraphQL input field would mean re-implementing type inference. Asking
 * "is this set of values a subset of SOME enum in the schema" is cruder but
 * catches the typo, which is the failure that actually happens.
 */
const sdlEnums = Object.values(schema.getTypeMap())
    .filter((t) => typeof t.getValues === 'function' && !t.name.startsWith('__'))
    .map((t) => ({ name: t.name, values: new Set(t.getValues().map((v) => v.name)) }));

const collectEnums = (node, path, out) => {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node.enum)) out.push({ path, values: node.enum });
    for (const [k, v] of Object.entries(node.properties || {})) collectEnums(v, `${path}.${k}`, out);
    if (node.items) collectEnums(node.items, `${path}[]`, out);
    return out;
};

for (const tool of TOOLS) {
    for (const { path, values } of collectEnums(tool.inputSchema, tool.name, [])) {
        const host = sdlEnums.find((e) => values.every((v) => e.values.has(v)));
        if (!host) {
            const near = sdlEnums
                .map((e) => ({ name: e.name, missing: values.filter((v) => !e.values.has(v)) }))
                .sort((a, b) => a.missing.length - b.missing.length)[0];
            console.error(`\u2717 ${path}: [${values.join(', ')}] is not a subset of any schema enum`);
            if (near) console.error(`    closest ${near.name} is missing: ${near.missing.join(', ')}`);
            failed++;
        }
    }
}

console.log(failed ? `${failed} problem(s)` : `${TOOLS.length}/${TOOLS.length} tool documents valid against the subgraph SDL, and every inputSchema enum is a subset of a real one`);
process.exit(failed ? 1 : 0);
