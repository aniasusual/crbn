/**
 * Subagent utilities for naming, session aggregation, and message translation.
 */

export const SUBAGENT_NAMES = [
  'task',
  'tester',
  'scout',
  'reviewer',
  'security_reviewer',
  'troubleshoot',
  'design',
];

export const SUBAGENT_MAP = {
  tester: 'tester',
  testing: 'tester',
  testing_agent: 'tester',
  ui_testing_agent: 'tester',

  design: 'design',
  design_agent: 'design',

  troubleshoot: 'troubleshoot',
  troubleshoot_agent: 'troubleshoot',

  reviewer: 'reviewer',
  reviewer_agent: 'reviewer',
  code_reviewer: 'reviewer',
  code_reviewer_agent: 'reviewer',

  security_reviewer: 'security_reviewer',
  security_reviewer_agent: 'security_reviewer',

  scout: 'scout',
  scout_agent: 'scout',

  task: 'task',
};

export const SUBAGENT_DISPLAY_NAMES = {
  task: 'Task Subagent',
  scout: 'Scout Subagent',
  reviewer: 'Code Reviewer Subagent',
  security_reviewer: 'Security Reviewer Subagent',
  troubleshoot: 'Troubleshoot Subagent',
  design: 'Design Subagent',
  tester: 'UI Testing Subagent',
};

export function normalizeSubagentName(rawName) {
  if (!rawName) return '';
  return SUBAGENT_MAP[rawName] || rawName;
}

export function isSubagentTool(name) {
  if (!name) return false;
  const normalized = normalizeSubagentName(name);
  return SUBAGENT_NAMES.includes(normalized);
}

export function getSubagentDisplayName(name, args = null) {
  if (name === 'task') {
    const agentKey = args?.agent || (Array.isArray(args?.tasks) ? 'batch' : 'task');
    if (agentKey === 'batch') {
      return `Batch Tasks (${args.tasks.length} agents)`;
    }
    return SUBAGENT_DISPLAY_NAMES[agentKey] || `Subagent (${agentKey})`;
  }
  const normalized = normalizeSubagentName(name);
  return SUBAGENT_DISPLAY_NAMES[normalized] || normalized || 'Subagent';
}

/**
 * Aggregates tool_call and tool_result pairing into a full subagent session object.
 */
export function getSubagentSessionData(message, allMessages = []) {
  if (!message || !isSubagentTool(message.name)) return null;
  const normName = normalizeSubagentName(message.name);
  let toolCallMsg = message.type === 'tool_call' ? message : null;
  let toolResultMsg = message.type === 'tool_result' ? message : null;

  if (!toolCallMsg && Array.isArray(allMessages)) {
    const msgIdx = allMessages.indexOf(message);
    const searchSlice = msgIdx >= 0 ? allMessages.slice(0, msgIdx) : allMessages;
    for (let i = searchSlice.length - 1; i >= 0; i--) {
      if (searchSlice[i].type === 'tool_call' && normalizeSubagentName(searchSlice[i].name) === normName) {
        toolCallMsg = searchSlice[i];
        break;
      }
    }
  }

  if (!toolResultMsg && Array.isArray(allMessages)) {
    const msgIdx = allMessages.indexOf(message);
    const searchSlice = msgIdx >= 0 ? allMessages.slice(msgIdx + 1) : [];
    for (let i = 0; i < searchSlice.length; i++) {
      if (searchSlice[i].type === 'tool_result' && normalizeSubagentName(searchSlice[i].name) === normName) {
        toolResultMsg = searchSlice[i];
        break;
      }
    }
  }

  const events = toolCallMsg?.subagentEvents || toolResultMsg?.subagentEvents || message.subagentEvents || [];
  const args = toolCallMsg?.arguments || message.arguments;
  const result = toolResultMsg?.result || message.result;
  const finishEvt = events.find((e) => e.event === 'finish');
  const status =
    (result || finishEvt || toolResultMsg || toolCallMsg?.subagentStatus === 'completed')
      ? 'completed'
      : (toolCallMsg?.subagentStatus || 'interrupted');

  // Extract or aggregate token metrics
  const rawMetrics = toolCallMsg?.subagentMetrics || toolResultMsg?.subagentMetrics || message.subagentMetrics;
  let metrics = rawMetrics || {};

  if (!metrics.total_tokens && finishEvt?.metrics) {
    metrics = { ...finishEvt.metrics };
  } else if (!metrics.total_tokens) {
    // Calculate from event loop if not present
    let promptTokens = 0;
    let completionTokens = 0;
    let durationMs = 0;
    for (const e of events) {
      if (e.metrics) {
        if (e.metrics.prompt_eval_count) promptTokens += e.metrics.prompt_eval_count;
        if (e.metrics.eval_count) completionTokens += e.metrics.eval_count;
        if (e.metrics.duration_ms) durationMs += e.metrics.duration_ms;
      }
    }
    if (promptTokens > 0 || completionTokens > 0) {
      metrics = {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
        total_duration_ms: Math.round(durationMs),
      };
    }
  }

  const model =
    events.find((e) => e.model)?.model ||
    toolCallMsg?.subagentMetrics?.model ||
    '';

  const lastIteration = events.reduce((max, e) => Math.max(max, e.iteration || 0), 0);
  const maxIterations = events.find((e) => e.max_iterations)?.max_iterations || 40;

  return {
    name: normName,
    arguments: args,
    result: result,
    events: events,
    status: status,
    metrics: metrics,
    model: model,
    iterations: lastIteration,
    maxIterations: maxIterations,
    timestamp: toolCallMsg?.timestamp || message.timestamp,
  };
}

/**
 * Converts subagent events and activity into standard chat message objects
 * so the Subagent Panel UI is 100% identical and reusable with the main chat UI.
 */
export function convertSubagentEventsToMessages(subagentData) {
  if (!subagentData) return [];
  const messages = [];

  // 1. Initial user task/instruction
  const rawArgs = subagentData.arguments;
  const task =
    subagentData.task ||
    (rawArgs
      ? typeof rawArgs === 'string'
        ? rawArgs
        : rawArgs.task ||
          rawArgs.problem_statement ||
          rawArgs.error_log ||
          rawArgs.instructions ||
          rawArgs.target_files ||
          // Only use JSON stringify if not raw file/process tool parameters
          (rawArgs.file_path || rawArgs.content || rawArgs.command ? '' : JSON.stringify(rawArgs, null, 2))
      : '');
  const firstDebug = subagentData.events?.find((e) => e.debug)?.debug;

  if (task) {
    messages.push({
      role: 'user',
      type: 'user',
      content: task,
      timestamp: subagentData.timestamp,
      debug: firstDebug,
    });
  }

  // 2. Map subagent loop events into standard chat messages
  const events = subagentData.events || [];
  for (let i = 0; i < events.length; i++) {
    const evt = events[i];

    if (evt.event === 'thought' && evt.content) {
      messages.push({
        type: 'thinking',
        content: evt.content,
        timestamp: evt.timestamp,
        collapsed: false,
        debug: evt.debug,
      });
    } else if (evt.event === 'tool_call') {
      messages.push({
        type: 'tool_call',
        name: evt.tool,
        arguments: evt.arguments,
        timestamp: evt.timestamp,
        collapsed: false,
        debug: evt.debug,
      });
    } else if (evt.event === 'tool_executed' || evt.event === 'action_executed') {
      messages.push({
        type: 'tool_result',
        name: evt.tool || evt.action || 'browser_action',
        result: evt.result || (evt.action ? `Action '${evt.action}' on ${evt.target || 'element'}` : 'Executed'),
        timestamp: evt.timestamp,
        collapsed: false,
        debug: evt.debug,
      });
    }
  }

  // 3. Final report / response from subagent
  const finishEvt = events.find((e) => e.event === 'finish');
  const report = subagentData.result || finishEvt?.report;
  if (report) {
    const lastMsg = messages[messages.length - 1];
    // If the final report isn't already the last thought's exact content, add as assistant token
    if (!lastMsg || lastMsg.content !== report) {
      messages.push({
        type: 'token',
        content: report,
        timestamp: subagentData.timestamp,
        debug: finishEvt?.debug || subagentData.events?.slice().reverse().find((e) => e.debug)?.debug,
      });
    }
  }

  return messages;
}
