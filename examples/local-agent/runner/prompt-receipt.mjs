/** Browser-visible evidence excludes tool inputs, raw provider data, and credentials. */
export function publicPromptReceipt(value) {
  return {
    stop: value.stop,
    modelRequests: value.modelRequests,
    toolCalls: value.toolCalls,
    ...(value.textDraft === undefined ? {} : { message: value.textDraft }),
    usage: { inputTokens: value.inputTokens, outputTokens: value.outputTokens },
  };
}
