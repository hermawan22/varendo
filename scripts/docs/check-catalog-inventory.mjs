#!/usr/bin/env node
import { resolve } from 'node:path';
import { loadCanonicalExamples } from './build-public-docs.mjs';
import {
  auditCatalogInventory,
  formatCatalogInventoryReport,
  readCatalogInventoryInputs,
} from './catalog-inventory.mjs';

const root = resolve(import.meta.dirname, '../..');
const inputs = await readCatalogInventoryInputs(root);
const examples = await loadCanonicalExamples();
const audit = auditCatalogInventory({ ...inputs, examples });
process.stdout.write(formatCatalogInventoryReport(audit));
if (!audit.ok) process.exitCode = 1;
