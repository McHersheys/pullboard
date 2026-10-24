/** Ordered outside facts and the explicitly declared outside submission transition. */
import { createHash } from 'node:crypto';
import { logEvent } from './board-event-log.js';
import { itemById } from './board-query.js';
import { Refused } from './refused.js';
import {
  outsideSource,
  saveOutsideSource,
} from './outside-source.js';

/** Validate exact immutable identifiers before recording an outside source. */
function validate(source, frozen) {
  if (!source || !['pull-request', 'issue'].includes(source.kind) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(source.repository ?? '') ||
      !Number.isSafeInteger(source.number) || source.number < 1 || !/^[A-Za-z0-9-]{1,39}$/u.test(source.author ?? '') || !['open', 'closed'].includes(source.state) || typeof source.maintainerReplied !== 'boolean') {
    throw new Refused('OUTSIDE_SOURCE', 'intake needs GitHub source metadata; fetch the exact issue or pull request again');
  }
  if (source.kind === 'pull-request' && (!/^[a-f0-9]{40}$/u.test(source.commit ?? '') || !/^[a-f0-9]{40}$/u.test(source.tree ?? '') || !frozen ||
      createHash('sha256').update(frozen.text).digest('hex') !== frozen.digest)) throw new Refused('OUTSIDE_SOURCE', 'fetch the exact pull request commit and freeze its trusted criterion before intake');
}

/** Apply one replayable source refresh; refresh never silently replaces a submitted commit. */
export function applyOutsideIntake(board, options, { atomic, addItem, moveItem }) {
  return atomic(board, () => {
    const { agentId, source, item, frozen } = options;
    validate(source, frozen);
    const existing = board.db.prepare("SELECT meta_key,meta_value FROM board_meta WHERE meta_key LIKE 'outside:%'").all()
      .find(row => { const old = JSON.parse(row.meta_value); return old.repository === source.repository && old.kind === source.kind && old.number === source.number; });
    if (existing) {
      const id = Number(existing.meta_key.slice('outside:'.length));
      const old = outsideSource(board, id);
      if (source.kind === 'pull-request' && old.commit !== source.commit) throw new Refused('OUTSIDE_HEAD_CHANGED', 'the pull request head changed; ask the coordinator to reopen its recorded submission before intaking the new head');
      saveOutsideSource(board, id, { ...old, state: source.state, maintainerReplied: source.maintainerReplied, updatedAt: source.updatedAt });
      logEvent(board, agentId, 'outside-refresh', id, { source });
      return id;
    }
    const id = addItem(board, { ...item, by: agentId });
    saveOutsideSource(board, id, { ...source, ownerApproval: null, sandbox: null });
    if (source.kind === 'pull-request') moveItem(board, id, 'intake', {
      checks: { joined: null, itemExists: null, inState: () => new Refused('NOT_CLAIMABLE', 'intake files a new outside item'), outsideSubmission: null },
      set: () => ({ item_built_by: `outside:github:${source.author}`, item_commit: source.commit, item_tree: source.tree,
        item_claim_head: source.base, item_frozen: frozen.text, item_frozen_digest: frozen.digest, item_files: source.files.join('\n') }),
    });
    logEvent(board, agentId, 'outside-intake', id, { source, frozen });
    return id;
  });
}

/** Person authority is separate from native agent/parent identity and binds one exact commit. */
export function approveOutside(board, id, { agentId }, atomic) {
  return atomic(board, () => {
    const item = itemById(board, id);
    const source = outsideSource(board, id);
    if (agentId !== 'person' || board.verifierStanding && !board.verifierStanding.person) throw new Refused('B26_PERSON_CHANNEL', 'only the owner approves outside sensitive changes through the person channel');
    if (!source || source.kind !== 'pull-request') throw new Refused('OUTSIDE_SOURCE', 'choose an intaken pull request');
    const ownerApproval = { by: 'person', commit: item.item_commit, at: board.clock.now().toISOString() };
    saveOutsideSource(board, id, { ...source, ownerApproval });
    logEvent(board, agentId, 'outside-owner-approval', id, { ownerApproval });
    return ownerApproval;
  });
}
