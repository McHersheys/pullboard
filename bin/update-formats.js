/** Refresh the source-discovered format table without changing any format/version declaration [A5,C7]. */
import { fileURLToPath } from 'node:url';
import { writeFormatTable } from '../src/format-registry.js';

writeFormatTable(fileURLToPath(new URL('../', import.meta.url)));
