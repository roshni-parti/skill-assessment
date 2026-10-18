// Template-based recommendations built from the matrix text. No external calls.
const bullets = (text) => (text ?? '').split('\n').map((l) => l.trim().replace(/^[-•]\s*/, '')).filter(Boolean);
const tidy = (s) => s.replace(/[.;]$/, '');

/**
 * For each of the top gaps: what the next level expects (from the sheet) versus where the
 * person is now, plus concrete next actions scaled to the size of the gap.
 */
export function recommend(role, questions, result, targetLevel, limit = 6) {
  const qById = Object.fromEntries(questions.map((q) => [q.id, q]));
  const skillById = Object.fromEntries(role.skills.map((s) => [s.id, s]));

  return result.gaps.slice(0, limit).map((g) => {
    const q = qById[g.id];
    const sheet = skillById[g.id];
    const currentStep = Math.floor(g.effective ?? 0);
    const currentProf = currentStep > 0 ? role.scale[currentStep - 1] : null;
    const targetLines = bullets(sheet.descriptors[g.targetProficiency]);
    const haveLines = new Set(currentProf ? bullets(sheet.descriptors[currentProf]).map((l) => l.toLowerCase()) : []);
    const toDemonstrate = targetLines.filter((l) => !haveLines.has(l.toLowerCase()));
    const stepsToClose = Math.ceil(g.gap);

    const actions = [];
    if (toDemonstrate[0]) actions.push({ type: 'Stretch assignment', text: `Take on work where you can show: ${tidy(toDemonstrate[0])}. Agree the scope with your manager.` });
    if (stepsToClose >= 2) actions.push({ type: 'Foundations', text: `Build ${currentProf ? 'beyond ' + currentProf : 'the basics'} in ${g.title}${q.details.length ? ' (' + q.details.slice(0, 3).map(tidy).join('; ') + ')' : ''} through structured learning before attempting stretch work.` });
    else if (q.details.length) actions.push({ type: 'Deepen', text: `Focus on the specifics: ${q.details.slice(0, 3).map(tidy).join('; ')}.` });
    actions.push({ type: 'Mentor', text: `Pair with someone already at ${targetLevel} on ${g.title} and ask for feedback on a real deliverable.` });
    if (g.gate === 'Must Have') actions.push({ type: 'Evidence', text: `This is a Must Have at ${targetLevel}. Capture a documented example of ${g.targetProficiency}-level work for your promotion discussion.` });
    if (g.perception === 'self-higher') actions.push({ type: 'Calibrate', text: 'Your manager rated you lower than you rated yourself. Walk through concrete examples together in your next 1:1.' });

    return {
      skillId: g.id, title: g.title, area: g.area, gate: g.gate, blocker: g.blocker,
      current: currentProf ?? 'Not yet demonstrating',
      target: g.targetProficiency,
      gap: Math.round(g.gap * 10) / 10,
      toDemonstrate: toDemonstrate.slice(0, 4),
      actions,
    };
  });
}
