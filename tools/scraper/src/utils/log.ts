/** Tiny zero-dependency logger with colour, so the CLI output stays readable. */

const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;

const wrap = (code: number, text: string) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);

export const c = {
  bold: (text: string) => wrap(1, text),
  dim: (text: string) => wrap(2, text),
  red: (text: string) => wrap(31, text),
  green: (text: string) => wrap(32, text),
  yellow: (text: string) => wrap(33, text),
  blue: (text: string) => wrap(34, text),
  magenta: (text: string) => wrap(35, text),
  cyan: (text: string) => wrap(36, text),
};

export interface Logger {
  step(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  success(message: string): void;
  /** Detail line, indented and dimmed. */
  detail(message: string): void;
}

export function createLogger(verbose = false): Logger {
  return {
    step: (message) => console.log(`\n${c.bold(c.cyan("▸"))} ${c.bold(message)}`),
    info: (message) => console.log(`  ${message}`),
    warn: (message) => console.log(`  ${c.yellow("!")} ${message}`),
    error: (message) => console.error(`  ${c.red("✗")} ${message}`),
    success: (message) => console.log(`  ${c.green("✓")} ${message}`),
    detail: (message) => {
      if (verbose) console.log(`    ${c.dim(message)}`);
    },
  };
}
