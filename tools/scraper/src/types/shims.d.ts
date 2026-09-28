/**
 * Ambient declarations for the two dependencies that ship without types.
 * @types/turndown covers Turndown itself; the GFM plugin has no @types package.
 */

declare module "turndown-plugin-gfm" {
  type Plugin = (service: unknown) => void;
  export const gfm: Plugin;
  export const tables: Plugin;
  export const strikethrough: Plugin;
  export const taskListItems: Plugin;
  export const highlightedCodeBlock: Plugin;
}
