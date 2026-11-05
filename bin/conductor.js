#!/usr/bin/env node

// The 6.x command name, kept through 7.x (removed in 8.0). Same CLI, one notice.
import { main } from "../src/main.js";

process.stderr.write("Note: `conductor` is now `carja`. This alias is removed in 8.0.\n");
main(process.argv.slice(2));
