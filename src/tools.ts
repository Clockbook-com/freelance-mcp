/**
 * The tool catalogue - one MCP tool per marketplace operation.
 *
 * ## Why the documents are copied here rather than imported
 *
 * `surface/src/api/operations.ts` is the flat catalogue this file is derived
 * from, and importing it would keep the two in step for free. It is not
 * importable: the surface is a browser package outside the yarn workspace with
 * its own lockfile, and pulling it in would drag React and the surface kit into
 * a stdio process. So these are copies, and copies drift. The mitigation is
 * below, and it is deliberate rather than resigned.
 *
 * ## The field lists are SLIMMER than the surface's, on purpose
 *
 * The obvious move is to paste `CONTRACT_FIELDS` and friends verbatim. Two
 * reasons not to. First, everything these tools return is read by a language
 * model, and the surface's lists exist to paint screens - `JOB_POSTING_FIELDS`
 * alone carries the AI-interview script, the auto-message table and the
 * evidence configuration, none of which help a model decide anything and all of
 * which cost context on every row of every search. The surface's own chat pane
 * reached the same conclusion and slims its rows by hand before showing them to
 * a model (`slimPosting` / `slimProfile` in `chat/freelanceAgent.ts`); doing it
 * in the DOCUMENT rather than after the fact means the bytes are never fetched.
 *
 * Second, a short list is a smaller drift surface. A GraphQL document fails
 * WHOLE when it names a field the schema does not have - "Cannot query field",
 * and the entire tool stops working, which is the trap
 * `POSTING_TEMPLATE_FIELDS` carries a warning about upstream. Every field named
 * below appears in a surface list that is known to validate against this
 * schema; adding one that does not is how this file breaks.
 *
 * ## What the scope lines in the descriptions mean
 *
 * Each description names the agent scope the operation belongs to, because the
 * model reading them is the thing that has to decide whether to try. Be precise
 * about what that means today:
 *
 *   - Scopes bite only on a REGISTERED agent identity. A platform token nobody
 *     registered reaches this subgraph holding its operator's whole seat, and
 *     `assertAgentScope` is a deliberate no-op for it (see
 *     `server/src/utils/agent-scope.ts` on why unregistered tokens are left
 *     alone). Registering is how a credential opts INTO being constrained.
 *   - As of this writing the server enforces SPEND, on five calls: fund,
 *     release (approve on a funded milestone), refund, deposit and cash out.
 *     The other scope names below are the model the agent identity declares,
 *     and are not yet checked in the services. Do not write a description that
 *     PROMISES a refusal the server will not produce - say which scope the act
 *     belongs to, which is true, rather than that it will be blocked without
 *     it, which is not yet.
 *
 * ## Naming
 *
 * `freelance_` prefix on every tool. MCP clients flatten every connected
 * server's tools into one namespace, and a bare `get_contract` next to three
 * other products' `get_contract` is a coin flip. The prefix also gives the
 * model a cheap way to know these tools are all one system.
 */

// ── Field lists ──────────────────────────────────────────────────────────────

/** A person as a buyer needs to see them. The directory projection's public half. */
const PROFILE_FIELDS = `
    id firstName lastName title username headline overview skills categories
    hourlyRate currency availability workMode city country
    identityVerified locationVerified lastActiveAt createdAt
`;

/**
 * YOUR OWN profile, which carries the owner-only fields the directory strips.
 * `email` and `listed` are the two that matter to an agent: the first is how it
 * confirms which account its token belongs to, the second whether that account
 * is visible to buyers at all.
 */
const OWN_PROFILE_FIELDS = `
    id firstName lastName email title username headline overview skills categories
    hourlyRate currency availability workMode city country listed
    identityVerified locationVerified enrolled createdAt updatedAt
`;

const JOB_POSTING_FIELDS = `
    id orgName postedBy postedByName title description category skills
    budgetType hourlyRateMin hourlyRateMax fixedBudget currency
    experienceLevel duration status visibility spotsTotal spotsFilled
    workMode location dueDate estimatedHours requirements
    proposalCount createdAt updatedAt
`;

const PROPOSAL_FIELDS = `
    id orgName jobTitle freelancerAccountId freelancerName
    coverLetter rateType rateAmount currency estimatedDuration
    status clientNote invitationNote acknowledged createdAt updatedAt
`;

/**
 * The milestone block is the reason contracts are asked for in full rather than
 * summarised: `escrowStatus` is what decides whether approving releases money,
 * and therefore whether `acknowledge: true` is required. An agent that cannot
 * see it has to discover the gate by tripping it.
 */
const CONTRACT_FIELDS = `
    id orgName title description freelancerAccountId freelancerName
    contractType hourlyRate fixedPrice currency weeklyLimit state
    startedAt endedAt totalEarned
    milestones {
        id title amount dueDate status submittedAt approvedAt
        escrowStatus escrowAmount fundedAt releasedAt refundedAt
    }
    createdAt updatedAt
`;

const CONVERSATION_FIELDS = `
    id title orgName jobPosting proposal contract
    lastMessage lastPostAt totalMsgCount unreadCount createdAt
`;

const MESSAGE_FIELDS = `id conversation author authorName message mine createdAt`;

const WALLET_ENTRY_FIELDS = `
    id ownerKind kind status amount currency title note counterparty contractId createdAt postedAt
`;

const NOTIFICATION_FIELDS = `id side at title body tone routeSection routeView routeId seenAt`;

// ── Enum vocabularies, as the schema spells them ─────────────────────────────
//
// Inlined into the JSON Schemas so a client that validates arguments rejects a
// bad value before it becomes a GraphQL validation error, and so a model
// reading the tool list can see the allowed words without guessing them from
// the prose. Every list here is copied from the schema's own `enum` blocks;
// a value invented at this layer is refused by the server, not coerced.

const GIG_CATEGORIES = ['COMPUTER', 'CREATIVE', 'CREW', 'DOMESTIC', 'EVENT', 'LABOR', 'TALENT', 'WRITING'];
const WORK_MODES = ['REMOTE', 'HYBRID', 'ONSITE'];
const AVAILABILITIES = ['FULL_TIME', 'PART_TIME', 'AS_NEEDED', 'NOT_AVAILABLE'];
const PROFILE_SORTS = ['RECENTLY_ACTIVE', 'RATE_ASC', 'RATE_DESC', 'RATING_DESC'];
const BUDGET_TYPES = ['HOURLY', 'FIXED_PRICE'];
const EXPERIENCE_LEVELS = ['ENTRY', 'INTERMEDIATE', 'EXPERT'];
const JOB_DURATIONS = ['SHORT_TERM', 'MEDIUM_TERM', 'LONG_TERM', 'ONGOING'];
const POSTING_STATUSES = ['OPEN', 'CLOSED', 'FILLED'];
const POSTING_SORTS = ['NEWEST', 'BUDGET_DESC', 'FEWEST_PROPOSALS'];
const POSTING_VISIBILITIES = ['PUBLIC', 'ORGANIZATION'];
const PROPOSAL_STATUSES = ['SUBMITTED', 'WITHDRAWN', 'ACCEPTED', 'DECLINED', 'INVITED'];
const CONTRACT_ROLES = ['FREELANCER', 'CLIENT'];
const CONTRACT_STATES = ['ACTIVE', 'PAUSED', 'ENDED', 'COMPLETED'];

// ── Schema helpers ───────────────────────────────────────────────────────────

type JsonSchema = Record<string, unknown>;

const str = (description: string): JsonSchema => ({ type: 'string', description });
const num = (description: string): JsonSchema => ({ type: 'number', description });
const bool = (description: string): JsonSchema => ({ type: 'boolean', description });
const strList = (description: string): JsonSchema => ({ type: 'array', items: { type: 'string' }, description });
const enumOf = (values: string[], description: string): JsonSchema => ({
    type: 'string',
    enum: values,
    description,
});

/**
 * An object schema. `additionalProperties: false` throughout, and that is not
 * pedantry: GraphQL input objects REJECT unknown fields at validation, so a
 * model that invents `filter.minRate` gets the whole call refused either way.
 * Refusing it here names the offending key; refusing it at the server names the
 * input type and leaves the model to work out which of its keys was wrong.
 */
const object = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
});

/** The tool that takes nothing. Spelled out so every inputSchema has the same shape. */
const noArgs = (): JsonSchema => ({ type: 'object', properties: {}, additionalProperties: false });

const PAGING = {
    offset: num('Rows to skip, for paging.'),
    limit: num('Maximum rows to return.'),
};

export interface FreelanceTool {
    name: string;
    description: string;
    /**
     * Every property here is named EXACTLY as the operation declares its
     * GraphQL variable, because the arguments are sent as the variables
     * untouched - there is no mapping layer. The surface's chat pane made the
     * same call for the same reason: one naming authority, and nothing in the
     * middle that can drift out of step with either side.
     */
    inputSchema: JsonSchema;
    /** The GraphQL document run when this tool is called. */
    document: string;
}

// ── Profile and directory ────────────────────────────────────────────────────

const PROFILE_TOOLS: FreelanceTool[] = [
    {
        name: 'freelance_get_my_profile',
        description:
            'The freelancer profile belonging to the account this API token authenticates as, including the ' +
            'owner-only fields (email, whether the profile is listed in the directory). Requires READ_OWN. ' +
            'Use this first to confirm which account and organization the token is acting for - every other ' +
            'tool acts as this identity, and there is no argument anywhere that can aim one at somebody else.',
        inputSchema: noArgs(),
        document: `query GetMyFreelanceProfile { getMyFreelanceProfile { ${OWN_PROFILE_FIELDS} } }`,
    },
    {
        name: 'freelance_search_talent',
        description:
            'Search the talent directory for listed freelancers - the people available to hire. Requires ' +
            'READ_DIRECTORY. Returns the public half of each profile only; contact details and verification ' +
            'documents are never in this projection. Omit `filter` entirely to see who is listed at all, then ' +
            'narrow: a search that returns nothing on the first try usually over-constrained `city` or `skills`.',
        inputSchema: object({
            filter: object({
                search: str('Free text over name, title, headline, overview and skills.'),
                skills: strList('Skill names, matched whole. "react" does not match "react-native".'),
                categories: { type: 'array', items: { type: 'string', enum: GIG_CATEGORIES }, description: 'Gig categories.' },
                workMode: enumOf(WORK_MODES, 'Remote, hybrid or on-site.'),
                city: str('City name as written on the profile.'),
                country: str('Country name as written on the profile.'),
                availability: enumOf(AVAILABILITIES, 'How much time the freelancer has.'),
                maxHourlyRate: num('Upper bound on the advertised hourly rate.'),
                sort: enumOf(PROFILE_SORTS, 'Result ordering.'),
                ...PAGING,
            }),
        }),
        document: `
query SearchFreelanceProfiles($filter: FreelanceProfileFilter) {
    searchFreelanceProfiles(filter: $filter) {
        totalCount
        data { ${PROFILE_FIELDS} }
    }
}`,
    },
    {
        name: 'freelance_get_profile',
        description:
            'One freelancer from the directory by id, as the public projection shows them. Requires ' +
            'READ_DIRECTORY. Ids come from freelance_search_talent - a name is not an id, and there is no ' +
            'lookup by name.',
        inputSchema: object({ id: str('The freelance profile id.') }, ['id']),
        document: `query GetFreelanceProfile($id: ID!) { getFreelanceProfile(id: $id) { ${PROFILE_FIELDS} } }`,
    },
];

// ── Job postings ─────────────────────────────────────────────────────────────

const POSTING_TOOLS: FreelanceTool[] = [
    {
        name: 'freelance_search_jobs',
        description:
            'Search open, publicly visible job postings across the whole marketplace - the work available to ' +
            'bid on. Requires READ_DIRECTORY. This is the FIND WORK side; for your own organization\'s ' +
            'requisitions in any status, including closed and organization-only ones, use ' +
            'freelance_list_org_jobs instead.',
        inputSchema: object({
            filter: object({
                search: str('Free text over title, description and skills.'),
                skills: strList('Skill names, matched whole.'),
                category: enumOf(GIG_CATEGORIES, 'Gig category.'),
                sort: enumOf(POSTING_SORTS, 'Result ordering. FEWEST_PROPOSALS finds the least contested work.'),
                workMode: enumOf(WORK_MODES, 'Remote, hybrid or on-site.'),
                remoteOnly: bool('Remote postings only.'),
                location: str('Place name, matched against the posting\'s location text.'),
                budgetType: enumOf(BUDGET_TYPES, 'Hourly or fixed price.'),
                experienceLevel: enumOf(EXPERIENCE_LEVELS, 'Experience the poster is asking for.'),
                duration: enumOf(JOB_DURATIONS, 'How long the engagement runs.'),
                status: enumOf(POSTING_STATUSES, 'Defaults to OPEN on this search.'),
                ...PAGING,
            }),
        }),
        document: `
query SearchFreelanceJobPostings($filter: FreelanceJobPostingFilter) {
    searchFreelanceJobPostings(filter: $filter) {
        totalCount
        data { ${JOB_POSTING_FIELDS} }
    }
}`,
    },
    {
        name: 'freelance_list_org_jobs',
        description:
            'Your own organization\'s job postings, in any status and including ORGANIZATION-visibility ones ' +
            'the public search never returns. Requires READ_OWN. This is the hiring side\'s list - use it to ' +
            'find the posting id you need before reading its proposals.',
        inputSchema: object({
            filter: object({
                search: str('Free text over title, description and skills.'),
                category: enumOf(GIG_CATEGORIES, 'Gig category.'),
                status: enumOf(POSTING_STATUSES, 'Narrow to open, closed or filled requisitions.'),
                sort: enumOf(POSTING_SORTS, 'Result ordering.'),
                ...PAGING,
            }),
        }),
        document: `
query ListOrgFreelanceJobPostings($filter: FreelanceJobPostingFilter) {
    listOrgFreelanceJobPostings(filter: $filter) {
        totalCount
        data { ${JOB_POSTING_FIELDS} }
    }
}`,
    },
    {
        name: 'freelance_get_job',
        description:
            'One job posting in full by id. Requires READ_DIRECTORY. Re-authorized on the server rather than ' +
            'trusted: your own organization sees any of its postings, everybody else sees PUBLIC ones only, ' +
            'and an ORGANIZATION-visibility posting you have no claim to comes back empty rather than ' +
            'refusing - that is the privacy boundary working, not a broken id.',
        inputSchema: object({ id: str('The job posting id.') }, ['id']),
        document: `query GetFreelanceJobPosting($id: ID!) { getFreelanceJobPosting(id: $id) { ${JOB_POSTING_FIELDS} } }`,
    },
    {
        name: 'freelance_create_job',
        description:
            'Publish a job posting to the marketplace under your organization\'s name. Belongs to the HIRE ' +
            'scope, and requires an organization context on the token - a personal token with no organization ' +
            'has nothing to post as. THIS IS VISIBLE TO REAL PEOPLE THE MOMENT IT LANDS: freelancers see it ' +
            'in search and can bid on it, so confirm the title, the budget and the description with the ' +
            'person you are acting for before calling this, never off your own reasoning. Set ' +
            '`visibility: ORGANIZATION` to keep it inside your organization while it is being worked on.',
        inputSchema: object(
            {
                input: object(
                    {
                        title: str('The headline. Required.'),
                        description: str('What the work is, in full.'),
                        category: enumOf(GIG_CATEGORIES, 'Gig category.'),
                        skills: strList('Skills a bidder should have.'),
                        budgetType: enumOf(BUDGET_TYPES, 'Hourly or fixed price.'),
                        hourlyRateMin: num('Bottom of the hourly range, when budgetType is HOURLY.'),
                        hourlyRateMax: num('Top of the hourly range, when budgetType is HOURLY.'),
                        fixedBudget: num('The whole budget, when budgetType is FIXED_PRICE.'),
                        currency: str('ISO currency code. Defaults to the organization\'s own.'),
                        experienceLevel: enumOf(EXPERIENCE_LEVELS, 'Experience being asked for.'),
                        duration: enumOf(JOB_DURATIONS, 'How long the engagement runs.'),
                        spotsTotal: num('How many people to hire. Defaults to one.'),
                        workMode: enumOf(WORK_MODES, 'Remote, hybrid or on-site.'),
                        location: str('Where the work happens, for hybrid and on-site postings.'),
                        dueDate: str('ISO 8601 date-time the work is needed by.'),
                        estimatedHours: num('Rough size of the job in hours.'),
                        requirements: strList('Hard requirements a bidder must meet.'),
                        startInstructions: str('What the hire should do first, shown after they are hired.'),
                        completionCriteria: str('What finished looks like.'),
                        applicantQuestions: strList(
                            'Questions every bidder must answer. A bid that leaves one blank is refused.',
                        ),
                        visibility: enumOf(
                            POSTING_VISIBILITIES,
                            'PUBLIC puts it in the marketplace search; ORGANIZATION keeps it internal.',
                        ),
                    },
                    ['title'],
                ),
            },
            ['input'],
        ),
        document: `
mutation CreateFreelanceJobPosting($input: CreateFreelanceJobPostingInput!) {
    createFreelanceJobPosting(input: $input) { ${JOB_POSTING_FIELDS} }
}`,
    },
];

// ── Proposals ────────────────────────────────────────────────────────────────

const PROPOSAL_TOOLS: FreelanceTool[] = [
    {
        name: 'freelance_list_my_proposals',
        description:
            'The bids this account has placed, and the invitations it has received. Requires READ_OWN. ' +
            'Status INVITED means a client pulled this account into a posting and nobody has bid yet.',
        inputSchema: object({
            filter: object({
                status: enumOf(PROPOSAL_STATUSES, 'Narrow to one status.'),
                jobPosting: str('Only bids against this job posting id.'),
                ...PAGING,
            }),
        }),
        document: `
query ListMyFreelanceProposals($filter: FreelanceProposalFilter) {
    listMyFreelanceProposals(filter: $filter) { ${PROPOSAL_FIELDS} }
}`,
    },
    {
        name: 'freelance_list_proposals_for_job',
        description:
            'Every bid on one of your organization\'s job postings - the hiring side\'s applicant list. ' +
            'Requires READ_OWN, and the posting must belong to your organization; asking about somebody ' +
            'else\'s requisition is refused, not filtered.',
        inputSchema: object({ jobPostingId: str('The job posting id.') }, ['jobPostingId']),
        document: `
query ListFreelanceProposalsForJob($jobPostingId: ID!) {
    listFreelanceProposalsForJob(jobPostingId: $jobPostingId) { ${PROPOSAL_FIELDS} }
}`,
    },
    {
        name: 'freelance_submit_proposal',
        description:
            'Bid on a job posting in this account\'s name. Belongs to the PROPOSE scope. THIS REACHES A REAL ' +
            'PERSON: the cover letter is read by the client as words this account wrote, so get the person ' +
            'you are acting for to approve the text and the rate before calling - never bid off your own ' +
            'reasoning about a good match. Read the posting with freelance_get_job first: if it carries ' +
            '`applicantQuestions` every one must be answered here, and if it carries acknowledgments you ' +
            'must send `acknowledged: true`, or the bid is refused.',
        inputSchema: object(
            {
                input: object(
                    {
                        jobPostingId: str('The posting being bid on. Required.'),
                        coverLetter: str('The pitch the client reads. Required.'),
                        rateType: enumOf(BUDGET_TYPES, 'How you are pricing it.'),
                        rateAmount: num('Your rate - per hour for HOURLY, the whole job for FIXED_PRICE.'),
                        currency: str('ISO currency code.'),
                        estimatedDuration: str('How long you expect to take, in words.'),
                        answers: {
                            type: 'array',
                            description:
                                'One entry per applicantQuestion on the posting. Required, and complete, when ' +
                                'the posting has any.',
                            items: object({ question: str('The question, copied exactly.'), answer: str('Your answer.') }, [
                                'question',
                                'answer',
                            ]),
                        },
                        links: {
                            type: 'array',
                            description: 'One http(s) URL per label, when the posting names requiredLinks.',
                            items: object({ label: str('The label from the posting.'), url: str('An http(s) URL.') }, [
                                'label',
                                'url',
                            ]),
                        },
                        acknowledged: bool(
                            'That the bidder has read and accepted every statement the posting attached. ' +
                                'Required true when the posting carries acknowledgments.',
                        ),
                    },
                    ['jobPostingId', 'coverLetter'],
                ),
            },
            ['input'],
        ),
        document: `
mutation SubmitFreelanceProposal($input: SubmitFreelanceProposalInput!) {
    submitFreelanceProposal(input: $input) { ${PROPOSAL_FIELDS} }
}`,
    },
    {
        name: 'freelance_accept_proposal',
        description:
            'Hire a bidder: accepting a proposal MINTS A CONTRACT and returns it. Belongs to the HIRE scope, ' +
            'and the posting must be your organization\'s. This is a commitment to a person, not a draft - ' +
            'confirm with whoever you are acting for first. It commits no money on its own; funding happens ' +
            'later, per milestone, through freelance_fund_milestone.',
        inputSchema: object(
            {
                id: str('The proposal id being accepted.'),
                weeklyLimit: num('Optional cap on billable hours per week, for hourly contracts.'),
            },
            ['id'],
        ),
        document: `
mutation AcceptFreelanceProposal($id: ID!, $weeklyLimit: Float) {
    acceptFreelanceProposal(id: $id, weeklyLimit: $weeklyLimit) { ${CONTRACT_FIELDS} }
}`,
    },
];

// ── Contracts and milestones ─────────────────────────────────────────────────

const CONTRACT_TOOLS: FreelanceTool[] = [
    {
        name: 'freelance_list_contracts',
        description:
            'Contracts where this account is either the freelancer or the client organization. Requires ' +
            'READ_OWN. Pass `filter.role` to pick a side: FREELANCER is work this account is doing, CLIENT ' +
            'is work it is paying for. Without it you get both, which is rarely what a question means.',
        inputSchema: object({
            filter: object({
                role: enumOf(CONTRACT_ROLES, 'Which side of the contract this account is on.'),
                state: enumOf(CONTRACT_STATES, 'Narrow to one contract state.'),
                jobPostingId: str('Only contracts minted from this requisition.'),
                ...PAGING,
            }),
        }),
        document: `
query ListMyFreelanceContracts($filter: FreelanceContractFilter) {
    listMyFreelanceContracts(filter: $filter) { ${CONTRACT_FIELDS} }
}`,
    },
    {
        name: 'freelance_get_contract',
        description:
            'One contract by id, with its milestones and their escrow state. Requires READ_OWN and ' +
            'membership of the contract. READ THIS BEFORE APPROVING ANYTHING: a milestone whose ' +
            '`escrowStatus` is FUNDED releases real money when approved, and that is the case where ' +
            'freelance_approve_milestone requires `acknowledge: true`.',
        inputSchema: object({ id: str('The contract id.') }, ['id']),
        document: `query GetFreelanceContract($id: ID!) { getFreelanceContract(id: $id) { ${CONTRACT_FIELDS} } }`,
    },
    {
        name: 'freelance_add_milestone',
        description:
            'Add a milestone to a contract - a named piece of work with an amount and a due date. Client ' +
            'lane: the contract must be your organization\'s. Belongs to the HIRE scope. Adding one commits ' +
            'no money; it only describes what a later payment would be for.',
        inputSchema: object(
            {
                id: str('The contract id.'),
                input: object(
                    {
                        title: str('What this milestone covers. Required.'),
                        amount: num('What it is worth, in the contract\'s currency.'),
                        dueDate: str('ISO 8601 date-time it is due.'),
                    },
                    ['title'],
                ),
            },
            ['id', 'input'],
        ),
        document: `
mutation AddFreelanceContractMilestone($id: ID!, $input: AddFreelanceMilestoneInput!) {
    addFreelanceContractMilestone(id: $id, input: $input) { ${CONTRACT_FIELDS} }
}`,
    },
    {
        name: 'freelance_submit_milestone',
        description:
            'Hand a milestone in for review, moving it PENDING -> SUBMITTED. Freelancer lane: this account ' +
            'must be the contract\'s freelancer. It claims the work is done and puts the client on the spot, ' +
            'so do not call it on the freelancer\'s behalf without their say-so.',
        inputSchema: object({ id: str('The contract id.'), milestoneId: str('The milestone id.') }, [
            'id',
            'milestoneId',
        ]),
        document: `
mutation SubmitFreelanceContractMilestone($id: ID!, $milestoneId: String!) {
    submitFreelanceContractMilestone(id: $id, milestoneId: $milestoneId) { ${CONTRACT_FIELDS} }
}`,
    },
    {
        name: 'freelance_fund_milestone',
        description:
            'MOVES MONEY. Commit a milestone\'s amount to escrow before the work starts. Requires the SPEND ' +
            'scope, which the server enforces - an agent identity without it is refused with ' +
            'FREELANCE_AGENT_SCOPE_REQUIRED, and the fix is a human granting the scope, not a retry. The ' +
            'money leaves the organization\'s spendable balance and is HELD: still the organization\'s, no ' +
            'longer spendable, not yet the freelancer\'s. No acknowledgement flag is needed because this is ' +
            'reversible - freelance_refund_milestone takes it straight back while the work is unapproved.',
        inputSchema: object({ id: str('The contract id.'), milestoneId: str('The milestone id.') }, [
            'id',
            'milestoneId',
        ]),
        document: `
mutation FundFreelanceContractMilestone($id: ID!, $milestoneId: String!) {
    fundFreelanceContractMilestone(id: $id, milestoneId: $milestoneId) { ${CONTRACT_FIELDS} }
}`,
    },
    {
        name: 'freelance_refund_milestone',
        description:
            'MOVES MONEY. Take escrowed money back out of a milestone and return it to the organization\'s ' +
            'spendable balance, while nothing has been handed over. Requires the SPEND scope, enforced by ' +
            'the server. Reversible - funding again restores it - which is why it carries no acknowledgement ' +
            'flag. It is still a decision about somebody\'s pay: confirm it before calling.',
        inputSchema: object({ id: str('The contract id.'), milestoneId: str('The milestone id.') }, [
            'id',
            'milestoneId',
        ]),
        document: `
mutation RefundFreelanceContractMilestone($id: ID!, $milestoneId: String!) {
    refundFreelanceContractMilestone(id: $id, milestoneId: $milestoneId) { ${CONTRACT_FIELDS} }
}`,
    },
    {
        name: 'freelance_approve_milestone',
        description:
            'MOVES MONEY, AND CANNOT BE UNDONE. Approve submitted work, moving the milestone SUBMITTED -> ' +
            'APPROVED -> PAID. On a milestone whose escrowStatus is FUNDED this is the call that RELEASES ' +
            'the escrow: the held money becomes the freelancer\'s cash-out balance, and nothing in this ' +
            'product can pull it back. Requires the SPEND scope, enforced by the server.\n' +
            'ON A FUNDED MILESTONE YOU MUST SEND `acknowledge: true`, and that flag means one specific ' +
            'thing: the person you are acting for has been told the amount and the payee and has said yes ' +
            'to THIS release. It is not a formality to set by default. Call it without the flag first if ' +
            'you are unsure - the refusal comes back as FREELANCE_ACKNOWLEDGEMENT_REQUIRED and carries the ' +
            'exact amount, currency and payee, which is the sentence to put in front of the person before ' +
            'you re-send with the flag. The flag is per call and never per session: a milestone\'s amount ' +
            'can change between two calls, so consent to an earlier one is consent to a different number. ' +
            'On a milestone nobody funded, the flag is ignored and this only moves the status.',
        inputSchema: object(
            {
                id: str('The contract id.'),
                milestoneId: str('The milestone id.'),
                acknowledge: bool(
                    'Confirmation that the person you are acting for has approved THIS release, after being ' +
                        'told the amount and who receives it. Required when the milestone is FUNDED.',
                ),
            },
            ['id', 'milestoneId'],
        ),
        document: `
mutation ApproveFreelanceContractMilestone($id: ID!, $milestoneId: String!, $acknowledge: Boolean) {
    approveFreelanceContractMilestone(id: $id, milestoneId: $milestoneId, acknowledge: $acknowledge) {
        ${CONTRACT_FIELDS}
    }
}`,
    },
];

// ── Wallet ───────────────────────────────────────────────────────────────────

const WALLET_TOOLS: FreelanceTool[] = [
    {
        name: 'freelance_get_wallet',
        description:
            'The account\'s wallet: money available to hire with (`toSpend`), earnings available to cash out ' +
            '(`toCashOut`), money committed to milestones (`inEscrow`), and recent ledger entries. Requires ' +
            'READ_OWN. A READ - it moves nothing. Check `toSpend` against a milestone\'s amount BEFORE ' +
            'calling freelance_fund_milestone: funding more than the wallet covers is refused outright and ' +
            'leaves the milestone unfunded rather than half-funded.',
        inputSchema: noArgs(),
        document: `
query GetFreelanceWallet {
    getFreelanceWallet {
        currency balance toSpend toCashOut inEscrow clearing pending
        cashoutMinimum depositMinimum depositMaximum depositsEnabled
        entries { ${WALLET_ENTRY_FIELDS} }
    }
}`,
    },
];

// ── Messaging and notifications ──────────────────────────────────────────────

const MESSAGING_TOOLS: FreelanceTool[] = [
    {
        name: 'freelance_list_conversations',
        description:
            'Message threads this account takes part in, with unread counts. Requires READ_OWN. A thread is ' +
            'anchored to a posting, a proposal or a contract - that anchor is how you tell two threads with ' +
            'the same person apart.',
        inputSchema: noArgs(),
        document: `query ListFreelanceConversations { listFreelanceConversations { ${CONVERSATION_FIELDS} } }`,
    },
    {
        name: 'freelance_get_conversation',
        description:
            'One thread and its messages. Requires READ_OWN. NOTE A SIDE EFFECT: reading a conversation ' +
            'MARKS IT READ for this account, which clears the other side\'s "unread" signal. Do not sweep ' +
            'every thread to summarise an inbox unless the person asked you to - use the unread counts from ' +
            'freelance_list_conversations for that, which change nothing.',
        inputSchema: object(
            { id: str('The conversation id.'), limit: num('How many messages to return, newest first.') },
            ['id'],
        ),
        document: `
query GetFreelanceConversation($id: ID!, $limit: Int) {
    getFreelanceConversation(id: $id, limit: $limit) {
        conversation { ${CONVERSATION_FIELDS} }
        messages { ${MESSAGE_FIELDS} }
    }
}`,
    },
    {
        name: 'freelance_send_message',
        description:
            'Send a message to a real person, under this account\'s name. Belongs to the MESSAGE scope. ' +
            'NOTHING UNDOES THIS - there is no edit and no delete, and the recipient is notified. Show the ' +
            'person you are acting for the exact wording and get a yes before calling; drafting a message is ' +
            'always fine, sending it is what waits. Address it EITHER with `conversationId` for an existing ' +
            'thread, OR with exactly one of jobPostingId / proposalId / contractId / freelanceProfileId, ' +
            'which finds or opens the thread anchored to that object.',
        inputSchema: object(
            {
                input: object(
                    {
                        message: str('The message text. Required.'),
                        conversationId: str('An existing thread, from freelance_list_conversations.'),
                        jobPostingId: str('Open or find the thread anchored to this posting.'),
                        proposalId: str('Open or find the thread anchored to this bid.'),
                        contractId: str('Open or find the thread anchored to this contract.'),
                        freelanceProfileId: str('Reach a listed freelancer directly from the directory.'),
                    },
                    ['message'],
                ),
            },
            ['input'],
        ),
        document: `
mutation SendFreelanceMessage($input: SendFreelanceMessageInput!) {
    sendFreelanceMessage(input: $input) { ${MESSAGE_FIELDS} }
}`,
    },
    {
        name: 'freelance_list_notifications',
        description:
            'This account\'s own notification feed, newest first. Requires READ_OWN. The recipient is taken ' +
            'from the token and can never be passed in. `side` picks the lane and is effectively required - ' +
            'FIND_WORK is "things happening to my bids", HIRE_TALENT is "things happening to my ' +
            'requisitions" - because the two are different jobs and a merged feed answers neither.',
        /*
         * `side` is the ONE argument here declared narrower than the schema
         * declares it. `FreelanceNotificationFilter.side` is a String, not an
         * enum - the two legal values live in a comment on the input rather
         * than in the type - so a model left to its own devices sends
         * "find_work" or "client" and gets an empty feed rather than an error,
         * which reads as "you have no notifications". Pinning the vocabulary
         * here turns that into a refusal the model can fix. If the schema ever
         * gains a real enum for this, delete the list and use it.
         */
        inputSchema: object({
            filter: object({
                side: enumOf(['FIND_WORK', 'HIRE_TALENT'], 'Which lane\'s feed to read.'),
                limit: num('How many to return. Defaults to 40 and is capped there.'),
            }),
        }),
        document: `
query ListFreelanceNotifications($filter: FreelanceNotificationFilter) {
    listFreelanceNotifications(filter: $filter) { ${NOTIFICATION_FIELDS} }
}`,
    },
];

/**
 * The catalogue, reads before writes within each group - the order a turn
 * should use them in, because an id comes from a list and a title is not an id.
 */
export const TOOLS: FreelanceTool[] = [
    ...PROFILE_TOOLS,
    ...POSTING_TOOLS,
    ...PROPOSAL_TOOLS,
    ...CONTRACT_TOOLS,
    ...WALLET_TOOLS,
    ...MESSAGING_TOOLS,
];

export const TOOLS_BY_NAME = new Map<string, FreelanceTool>(TOOLS.map((tool) => [tool.name, tool]));
