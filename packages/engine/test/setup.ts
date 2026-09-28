import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Every test file gets its own Leuria home: nothing ever touches the real ~/.leuria.
process.env.LEURIA_HOME = mkdtempSync(join(tmpdir(), "leuria-test-home-"));
