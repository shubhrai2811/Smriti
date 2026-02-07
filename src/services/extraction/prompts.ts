import type { PendingMessageRow, ObservationRow } from '../../shared/types.js';

/**
 * Build a concise extraction prompt for a batch of tool uses.
 * Target: ~300 tokens for the prompt itself (excluding tool data).
 */
export function buildExtractionPrompt(messages: PendingMessageRow[]): string {
  const toolOutputs = messages.map((msg, i) => {
    const input = truncate(msg.tool_input || '', 2000);
    const output = truncate(msg.tool_response || '', 3000);
    return `<tool_use index="${i + 1}">
<tool>${msg.tool_name || 'unknown'}</tool>
<input>${input}</input>
<output>${output}</output>
</tool_use>`;
  }).join('\n\n');

  return `Extract structured observations from these tool uses in a coding session.
For each significant action, create an observation. Skip trivial actions (simple file reads with no discoveries, ls commands, etc.).

${toolOutputs}

Respond with XML observations. Each observation must include:
- type: one of bugfix, feature, refactor, discovery, decision, pattern, config, dependency
- title: concise one-line description (max 80 chars)
- facts: key facts as individual <fact> elements inside <facts>
- concepts: comma-separated related technologies/concepts
- files_affected: comma-separated file paths involved
- importance: 1-10 score (10 = critical bug fix or architectural decision, 1 = trivial)

<examples>
<observation>
<type>bugfix</type>
<title>Fixed null pointer in user auth middleware</title>
<facts>
<fact>req.user was undefined when JWT expired</fact>
<fact>Added null check before accessing req.user.id</fact>
</facts>
<concepts>authentication, middleware, JWT</concepts>
<files_affected>src/middleware/auth.ts</files_affected>
<importance>7</importance>
</observation>
</examples>

Output zero or more <observation> elements. If all tool uses are trivial, output nothing.`;
}

/**
 * Build a summary prompt for end-of-session summarization.
 */
export function buildSummaryPrompt(
  firstPrompt: string,
  observations: ObservationRow[],
  lastAssistantMessage: string,
): string {
  const obsDigest = observations.map(o =>
    `- [${o.type}] ${o.title} (importance: ${o.importance})`
  ).join('\n');

  return `Summarize this coding session concisely.

User's initial request: ${truncate(firstPrompt, 500)}

Observations from the session:
${obsDigest || '(no observations extracted)'}

Last assistant response (excerpt):
${truncate(lastAssistantMessage, 2000)}

Respond with a structured summary in XML:
<summary>
<request>What the user asked for (1-2 sentences)</request>
<learned>Key discoveries and things learned (1-3 sentences)</learned>
<completed>What was accomplished (1-3 sentences)</completed>
<next_steps>Unfinished work or follow-ups (1-3 sentences, or "None")</next_steps>
</summary>`;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '... [truncated]';
}
