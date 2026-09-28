declare const __LEURIA_VERSION__: string | undefined;

/** Injected by tsup at build time; `dev` when run from source. */
export const VERSION = typeof __LEURIA_VERSION__ === "string" ? __LEURIA_VERSION__ : "0.0.0-dev";
