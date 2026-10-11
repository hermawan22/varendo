/** Shared command-line flag parsing for release tooling. */

export function flagValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}
