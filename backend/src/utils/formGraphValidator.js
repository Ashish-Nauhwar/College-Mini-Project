/**
 * FeedbackHub Form Question Graph & Conditional Validator
 * Implements full dependency graph cycle detection (A->B->A, A->B->C->A, etc.),
 * strict operator validation (no silent fallbacks), and numeric comparison checks.
 */

const ALLOWED_OPERATORS = ['equals', 'not_equals', 'in', 'greater_than', 'less_than', 'contains'];
const ALLOWED_QUESTION_TYPES = [
  'rating', 'nps', 'text', 'multiline', 'choice', 'select',
  'checkbox', 'yesno', 'email', 'phone', 'number', 'date'
];

/**
 * Validates question list and detects circular conditional dependencies using DFS.
 * 
 * @param {Array<Object>} rawQuestions 
 * @returns {{ error: string | null, questions: Array<Object> }}
 */
function validateQuestionGraph(rawQuestions) {
  if (!Array.isArray(rawQuestions)) {
    return { error: null, questions: [] };
  }

  const idSet = new Set();
  const sanitized = [];

  // Pass 1: Validate question schema, types, and assign IDs
  for (let idx = 0; idx < rawQuestions.length; idx++) {
    const q = rawQuestions[idx];
    if (!q || typeof q !== 'object') {
      return { error: `Invalid question format at position ${idx + 1}` };
    }

    const text = q.text ? String(q.text).trim() : '';
    if (!text) {
      return { error: `Question label cannot be empty (question #${idx + 1})` };
    }

    const type = q.type && ALLOWED_QUESTION_TYPES.includes(q.type) ? q.type : null;
    if (!type) {
      return { error: `Invalid question type "${q.type}" for question #${idx + 1}` };
    }

    let qId = q.id && typeof q.id === 'string' ? q.id.trim() : '';
    const safeIdRegex = /^[a-zA-Z0-9_-]{1,64}$/;
    if (!qId || !safeIdRegex.test(qId) || idSet.has(qId)) {
      qId = `q_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`;
    }
    idSet.add(qId);

    let options = [];
    if (['choice', 'select', 'checkbox'].includes(type)) {
      options = Array.isArray(q.options)
        ? q.options.map(opt => String(opt).trim()).filter(Boolean)
        : [];
      if (options.length === 0) {
        return { error: `Question "${text}" of type "${type}" must have at least one valid option` };
      }
    }

    sanitized.push({
      id: qId,
      type,
      text,
      description: q.description ? String(q.description).trim() : '',
      placeholder: q.placeholder ? String(q.placeholder).trim() : '',
      required: Boolean(q.required),
      min: typeof q.min === 'number' ? q.min : (type === 'nps' ? 0 : 1),
      max: typeof q.max === 'number' ? q.max : (type === 'nps' ? 10 : 5),
      options,
      multiline: Boolean(q.multiline),
      order: typeof q.order === 'number' ? q.order : idx,
      rawConditional: q.conditional || null
    });
  }

  // Pass 2: Validate conditional dependencies and operators strictly
  const questionsById = new Map();
  sanitized.forEach(q => questionsById.set(q.id, q));

  for (const q of sanitized) {
    if (q.rawConditional && q.rawConditional.dependsOn) {
      const dependsOn = String(q.rawConditional.dependsOn).trim();
      const op = q.rawConditional.operator !== undefined && q.rawConditional.operator !== null
        ? String(q.rawConditional.operator).trim()
        : 'equals';

      // 1. Check self dependency
      if (dependsOn === q.id) {
        return { error: `Question "${q.text}" (${q.id}) cannot depend on itself` };
      }

      // 2. Check existence of parent question
      if (!questionsById.has(dependsOn)) {
        return { error: `Question "${q.text}" depends on non-existent question "${dependsOn}"` };
      }

      // 3. Strict operator validation (NO silent fallback to 'equals')
      if (!ALLOWED_OPERATORS.includes(op)) {
        return {
          error: `Invalid conditional operator "${op}" for question "${q.text}". Must be one of: ${ALLOWED_OPERATORS.join(', ')}`
        };
      }

      // 4. Validate numeric comparison operators
      if (op === 'greater_than' || op === 'less_than') {
        const val = q.rawConditional.value;
        const numVal = Number(val);
        if (val === undefined || val === null || val === '' || !Number.isFinite(numVal)) {
          return {
            error: `Conditional operator "${op}" for question "${q.text}" requires a valid numeric comparison value`
          };
        }
      }

      // 5. Validate 'in' operator
      if (op === 'in') {
        const val = q.rawConditional.value;
        if (!Array.isArray(val) || val.length === 0) {
          return {
            error: `Conditional operator "in" for question "${q.text}" requires a non-empty array of candidate values`
          };
        }
      }

      q.conditional = {
        dependsOn,
        operator: op,
        value: q.rawConditional.value
      };
    } else {
      q.conditional = null;
    }
    delete q.rawConditional;
  }

  // Pass 3: Full Dependency Graph Cycle Detection (A->B->A, A->B->C->A, etc.)
  // We represent graph edges where edge child -> parent indicates child depends on parent.
  const state = new Map(); // id -> 0: UNVISITED, 1: VISITING, 2: VISITED
  sanitized.forEach(q => state.set(q.id, 0));

  function dfs(currId, path) {
    state.set(currId, 1);
    path.push(currId);

    const currQ = questionsById.get(currId);
    if (currQ && currQ.conditional && currQ.conditional.dependsOn) {
      const parentId = currQ.conditional.dependsOn;
      const parentState = state.get(parentId);

      if (parentState === 1) {
        // Cycle found
        const cycleStartIndex = path.indexOf(parentId);
        const cyclePath = path.slice(cycleStartIndex).concat(parentId);
        const cycleDisplay = cyclePath.map(id => {
          const item = questionsById.get(id);
          return item ? `${item.id}` : id;
        }).join(' -> ');
        return `Conditional dependency cycle detected: ${cycleDisplay}`;
      }

      if (parentState === 0) {
        const cycleErr = dfs(parentId, path);
        if (cycleErr) return cycleErr;
      }
    }

    path.pop();
    state.set(currId, 2);
    return null;
  }

  for (const q of sanitized) {
    if (state.get(q.id) === 0) {
      const cycleError = dfs(q.id, []);
      if (cycleError) {
        return { error: cycleError };
      }
    }
  }

  return { error: null, questions: sanitized };
}

module.exports = {
  validateQuestionGraph,
  ALLOWED_OPERATORS,
  ALLOWED_QUESTION_TYPES
};
