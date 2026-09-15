/**
 * The mode of a QA seed script: exactly one positional argument, "seed" or
 * "clean". Flags (and the value after --reason) are skipped, so a reason that
 * happens to contain the word "clean" can never turn a seed into a clean.
 */
export function qaSeedMode(argv) {
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--reason") {
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) continue;
    positional.push(arg);
  }
  if (positional.length !== 1 || (positional[0] !== "seed" && positional[0] !== "clean")) {
    throw new Error('usage: node <script> --reason "..." seed|clean');
  }
  return positional[0];
}
