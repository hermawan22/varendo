declare global {
  var litNonce: string | undefined;
}

// Lit uses this documented hook for generated shadow-root style elements.
globalThis.litNonce = 't02nonce';

export {};
