// The page model runs here, off the page's main thread, so the page stays
// responsive while it downloads and embeds. Plain JavaScript: bundlers pick
// it up through `new URL("./worker.js", import.meta.url)`, from source or
// from dist.
import { env, pipeline } from "@huggingface/transformers";
import { listen } from "./listen.js";

listen(env, pipeline);
