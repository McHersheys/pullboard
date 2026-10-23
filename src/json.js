/** Versioned command results and refusals for tools that drive the CLI (A1). */
import {
  nextStepFor,
  personRequestGuidance,
} from './next-step-words.js';

/** A shape's required top-level fields; optional fields may be added within this version. */
function shape(fields) {
  return { required: { version: 'number', ...fields } };
}

/** The CLI JSON v1 catalog, shared with API documentation and contract checks (A1). */
export const JSON_SHAPES = {
  version: 1,
  commands: {
    help: shape({ help: 'string' }),
    version: shape({ release: 'string' }),
    init: shape({ root: 'string', notes: 'array', proposedLanes: 'array', mcp: 'object' }),
    hooks: shape({ notes: 'array' }),
    join: shape({ agent: 'string', lane: 'string', route: 'string', path: 'string', model: 'string', displayName: 'string' }),
    takeover: shape({ agent: 'string', path: 'string' }),
    worktree: shape({ agent: 'string', lane: 'string', route: 'string', path: 'string', branch: 'string', prompt: 'string', model: 'string', displayName: 'string' }),
    resume: shape({ me: 'object', all: 'array', requests: 'array', holding: 'array', sentBack: 'array', awaiting: 'array', toVerify: 'array', toMerge: 'array', open: 'array', stale: 'array', doctrineNotes: 'array', holds: 'array', unread: 'number', newest: 'array', root: 'string', newWorktreeLocation: 'string', dirty: 'number', next: 'string' }),
    whoami: shape({ id: 'string', lane: 'string', path: 'string', model: 'string', displayName: 'string' }),
    agents: shape({ agents: 'array' }),
    lanes: shape({ lanes: 'object', shared: 'array', coordinator: 'string' }),
    'lane add': shape({ lane: 'string', owns: 'array' }),
    resources: shape({ resources: 'array' }),
    settings: shape({ settings: 'object' }),
    runner: shape({ runner: 'object' }),
    relay: shape({ linked: 'boolean', board: 'string', url: 'string', link: 'string', sequence: 'number', behind: 'number', recovery: 'object' }),
    list: shape({ items: 'array' }),
    queue: shape({ releases: 'array', unreleased: 'array', first: 'object' }),
    roadmap: shape({ milestones: 'array' }),
    'milestone add': shape({ milestone: 'object' }),
    'milestone items': shape({ milestone: 'object' }),
    'milestone order': shape({ milestone: 'object' }),
    'milestone move': shape({ milestone: 'object' }),
    'milestone edit': shape({ milestone: 'object' }),
    'milestone remove': shape({ milestone: 'object' }),
    'milestone ship': shape({ milestone: 'object', into: 'string|null', moved: 'array', notMoved: 'array' }),
    show: shape({ item_id: 'number', item_title: 'string', item_lane: 'string', item_status: 'string', verdicts: 'array', thread: 'array' }),
    stats: shape({ stats: 'object', gateWaits: 'array' }),
    badge: shape({ items: 'number', checked: 'number', percent: 'number|null', changed: 'array' }),
    status: shape({ me: 'object', mine: 'array', stats: 'object', reviewQueue: 'object', unread: 'number', relay: 'object' }),
    doctor: shape({ problems: 'array' }),
    health: shape({ asOf: 'string', thresholds: 'object', stuck: 'array', waiting: 'array' }),
    'sentinel propose': shape({ sentinel: 'object' }),
    'sentinel approve': shape({ sentinel: 'object' }),
    'sentinel decline': shape({ sentinel: 'object' }),
    sentinels: shape({ sentinels: 'array' }),
    loop: shape({ jobs: 'array' }),
    'loop declare': shape({ job: 'object' }),
    'loop ran': shape({ job: 'object' }),
    skills: shape({ updated: 'array', current: 'array', customized: 'array' }),
    inbox: shape({ shouts: 'array' }),
    decisions: shape({ decisions: 'array' }),
    ledger: shape({ items: 'array', stats: 'object' }),
    log: shape({ events: 'array' }),
    flakes: shape({ flakes: 'array', unclassified: 'array', regressions: 'array', stable: 'array' }),
    'flakes rerun': shape({ flakes: 'object', file: 'string' }),
    rigor: shape({ causes: 'array', uncaused: 'number' }),
    'rigor draft': shape({ key: 'string', reads: 'string', evidence: 'object', proof: 'object', drafts: 'array' }),
    add: shape({ item: 'object' }),
    edit: shape({ item: 'object' }),
    fact: shape({ item: 'number', fact: 'object' }),
    why: shape({ id: 'number', decisions: 'array' }),
    escalate: shape({ id: 'number', from: 'string', to: 'string' }),
    run: shape({ messages: 'array' }),
    sweep: shape({ messages: 'array' }),
    next: shape({ item: 'object', review: 'boolean', held: 'boolean', shared: 'array' }),
    check: shape({ id: 'number', green: 'boolean', seconds: 'number', check: 'string', receipt: 'object', report: 'string' }),
    'check accept': shape({ id: 'number', digest: 'string', check: 'string' }),
    claim: shape({ id: 'number', renewed: 'boolean', leaseUntil: 'string', digest: 'string' }),
    hold: shape({ lane: 'string', held: 'boolean' }),
    release: shape({ id: 'number' }),
    submit: shape({ id: 'number', commit: 'string', pin: 'string', gate: 'object' }),
    done: shape({ id: 'number', commit: 'string', pin: 'string', gate: 'object' }),
    verify: shape({ id: 'number', decision: 'string', reason: 'string' }),
    merged: shape({ id: 'number', commit: 'string' }),
    land: shape({ batch: 'object|null', landed: 'array', conflicts: 'array', blocked: 'array', culprits: 'array', flakes: 'array' }),
    withdraw: shape({ id: 'number', reason: 'string', milestones: 'array' }),
    refreeze: shape({ id: 'number', after: 'string' }),
    reopen: shape({ id: 'number', commit: 'string' }),
    shout: shape({ id: 'number', decision: 'boolean' }),
    answer: shape({ id: 'number', answers: 'number' }),
    pass: shape({ id: 'number', answers: 'number' }),
    tour: shape({ messages: 'array' }),
    lifecycle: shape({ markdown: 'string' }),
    view: shape({ url: 'string', port: 'number' }),
    'view export': shape({ path: 'string' }),
    serve: shape({ url: 'string', port: 'number' }),
    // watch --json prints one of these per line, for each event or work notice, and no end-of-command document.
    watch: shape({ sequence: 'number', kind: 'string', item: 'number|null', actor: 'string|null', detail: 'string' }),
    forget: shape({ root: 'string' }),
    prompt: shape({ role: 'string', text: 'string' }),
    gate: shape({ green: 'boolean', report: 'string' }),
    'gate set': shape({ gate: 'string', file: 'string' }),
    export: shape({ tables: 'object' }),
    digest: shape({ markdown: 'string', bytes: 'number', sequence: 'number', sections: 'array' }),
    import: shape({ tables: 'array' }),
    spec: shape({ rows: 'array' }),
    'spec check': shape({ rows: 'array' }),
    'spec view': shape({ path: 'string' }),
    'spec show': shape({ row: 'object', standing: 'object' }),
    'blueprint starters': shape({ blueprint: 'object', starters: 'array' }),
    'spec draft': shape({ id: 'string', row: 'object' }),
    'blueprint add': shape({ blueprint: 'object', section: 'string', rows: 'array', items: 'array', gate: 'string|null', proposedLanes: 'array' }),
    'blueprint fit': shape({ proposals: 'array' }),
    'spec fit': shape({ proposals: 'array' }),
    'spec unmet': shape({ rows: 'array' }),
    'spec signoff': shape({ count: 'number', by: 'string', ids: 'array', evidence: 'array' }),
    'spec signers': shape({ added: 'boolean', by: 'string', path: 'string', initial: 'boolean' }),
    'spec approve': shape({ decisions: 'array' }),
    'spec decline': shape({ decisions: 'array' }),
    'spec answer': shape({ decisions: 'array' }),
    'spec apply': shape({ applied: 'array', files: 'array' }),
    'doctrine check': shape({ rules: 'array' }),
    'hook pre-commit': shape({ messages: 'array' }),
    'hook pre-merge-commit': shape({ messages: 'array' }),
    'hook commit-msg': shape({ messages: 'array' }),
    'hook pre-push': shape({ messages: 'array' }),
  },
  http: {
    boards: shape({ boards: 'array' }),
    state: shape({ state: 'object' }),
    delta: shape({ since: 'number', sequence: 'number', delta: 'object|null' }),
    shout: shape({ shout: 'object' }),
    item: shape({ item: 'object' }),
    items: shape({ ids: 'array' }),
    events: shape({ events: 'array' }),
    move: shape({ event: 'object', result: 'object' }),
    request: shape({ event: 'object', result: 'object' }),
    stream: shape({ event: 'object' }),
  },
  error: shape({ error: 'object' }),
  errorFields: { code: 'string', message: 'string', next: 'string' },
};

/** A refusal shared by the CLI and API, presenting guidance for a known caller without changing its receipt (A1, A2, B26). */
export function refusalDocument(error, options = {}) {
  const message = String(error.message).replace(/^\[[A-Z][A-Z0-9_]*\] /, '');
  const code = error.code ?? 'INTERNAL';
  return { version: JSON_SHAPES.version, error: { code, message: personRequestGuidance(message, options), next: nextStepFor({ code, next: error.next }, message, options) } };
}

/**
 * Collect one command's output; text mode writes immediately and JSON mode writes one document.
 * Long-running view explicitly flushes its address before waiting for a shutdown signal.
 */
export function commandOutput(argv, streams) {
  let enabled = argv.slice(0, argv.indexOf('--') < 0 ? argv.length : argv.indexOf('--')).includes('--json');
  let result;
  let refusal;
  let remote;
  let caller = 'unknown';
  let callerRoot;
  let written = false;
  const messages = [];
  const diagnostics = [];
  const emit = (target, lines, line) => {
    if (enabled) lines.push(String(line));
    else target.write(`${line}\n`);
  };
  const flush = (code) => {
    if (!enabled || written) return;
    written = true;
    let document;
    if (refusal || (code && result === undefined)) {
      const text = refusal?.message ?? [...diagnostics, ...messages].join('\n');
      const match = /\[([A-Z][A-Z0-9_]*)\]\s*([\s\S]*)/.exec(text);
      const message = refusal ? text.replace(/^\[[A-Z][A-Z0-9_]*\] /, '') : match?.[2] ?? text;
      document = refusalDocument({ code: refusal?.code ?? match?.[1] ?? (code === 2 ? 'USAGE' : 'COMMAND_FAILED'), message, next: refusal?.next }, { caller });
    } else if (result !== undefined) {
      document = { version: JSON_SHAPES.version, ...result, ...(diagnostics.length ? { diagnostics } : {}) };
    } else {
      // A native versioned document, such as export, already owns its public shape.
      let native;
      if (messages.length === 1) {
        try { native = JSON.parse(messages[0]); } catch { /* Ordinary command prose is kept as messages. */ }
      }
      document = native && !Array.isArray(native) && typeof native.version === 'number'
        ? { ...native, ...(diagnostics.length ? { diagnostics } : {}) } : { version: JSON_SHAPES.version, messages, ...(diagnostics.length ? { diagnostics } : {}) };
    }
    if (remote) document.remote = remote;
    streams.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
  };
  return {
    ...streams,
    physicalStdoutIsTTY: Boolean(streams.stdout.isTTY),
    stdout: { get isTTY() { return enabled ? false : streams.stdout.isTTY; }, write: (text) => streams.stdout.write(text) },
    say: (line) => emit(streams.stdout, messages, line),
    err: (line) => emit(streams.stderr, diagnostics, line),
    result: (value) => { result = value; },
    refusal: (error) => { refusal = error; },
    // A successfully checked person channel stays the display caller for this command.
    caller: (value, root) => { if (caller !== 'person') { caller = value; callerRoot = root; } },
    callerKnown: (root) => caller === 'person' || caller !== 'unknown' && callerRoot === root,
    callerRole: () => caller,
    guidance: (message, options = {}) => personRequestGuidance(message, { ...options, caller }),
    refusalDocument: (error) => refusalDocument(error, { caller }),
    remote: (value) => { remote = value; },
    exitCode: (code) => code || (remote ? 1 : 0),
    jsonMode: (value) => { enabled = Boolean(value); },
    flush,
  };
}
