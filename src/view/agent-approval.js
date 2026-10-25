import { specRevisionScript } from './spec-revision.js';
/** Render core-projected agent approval calls without inferring who approved a row [S1,B26,P6,N26]. */

/** Embed a Needs-you row renderer that reuses the existing person decision pipeline. */
export function agentApprovalScript() {
  return `
/** Render literal core attribution, with only core-advertised person moves. */
function agentApprovalRow(row) {
  const person = !snapshot && (!readOnly || requests);
  const allowed = verb => person && Array.isArray(row.actions) && row.actions.some(action => action.verb === verb && action.args?.ids === row.id);
  const button = (decision, label) => '<button type="button" data-row-kind="spec" data-row-id="' + esc(row.id) + '" data-row-decision="' + decision + '">' + label + '</button>';
  const feedback = view.specFeedback?.root === view.root && view.specFeedback.kind === 'spec' && view.specFeedback.id === row.id ? view.specFeedback : null;
  const controls = (allowed('spec-approve') ? button('approve', 'Confirm') : '') + (allowed('spec-decline') ? button('decline', 'Decline') : '');
  return '<li class="row ask agent-approval" data-agent-approved="' + esc(row.id) + '"><span class="dot ask"></span><div><div class="t"><span>' + esc(row.ref ?? row.id) + '</span>agent-approved</div>'
    + '<p>' + esc(row.attribution ?? 'Attribution unavailable') + ': ' + esc(row.agent ?? 'unknown') + '</p><p>Commit: <code>' + esc(row.commit ?? 'unavailable') + '</code></p>'
    + (feedback ? specFeedback(feedback) : '')
    + '<div class="meta"><span class="why"><b>NEEDS YOU</b> confirm or decline this row</span></div></div>' + (controls ? '<div class="actions">' + controls + '</div>' : '') + '</li>';
}
${specRevisionScript()}
`;
}
