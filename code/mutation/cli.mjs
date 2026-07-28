#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { applyMutationPlan, MUTATION_OPERATORS } from './operators.mjs';

function usage(exitCode = 0) {
  const rows = Object.values(MUTATION_OPERATORS)
    .map(item => `  ${item.id}  ${item.name}: ${item.effect}`)
    .join('\n');
  console.log(`WorldCoder-Bench mutation generator\n\n` +
    `Usage:\n` +
    `  node code/mutation/cli.mjs --input reference.html --plan mutation-plan.json --output-dir /tmp/mutants\n\n` +
    `Options:\n` +
    `  --input FILE       Validated reference HTML supplied by the user\n` +
    `  --plan FILE        JSON array, or { "mutations": [...] }\n` +
    `  --output-dir DIR   Destination for generated mutant HTML\n` +
    `  --manifest FILE    Output manifest (default: OUTPUT-DIR/manifest.json)\n` +
    `  --help             Show this help\n\n` +
    `Operators:\n${rows}\n\n` +
    `Each plan row requires operator, case_id, search, replacement, and optional expected_matches.`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const options = { input: null, plan: null, outputDir: null, manifest: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = () => {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === '--help' || arg === '-h') usage(0);
    else if (arg === '--input') options.input = resolve(take());
    else if (arg.startsWith('--input=')) options.input = resolve(arg.slice(8));
    else if (arg === '--plan') options.plan = resolve(take());
    else if (arg.startsWith('--plan=')) options.plan = resolve(arg.slice(7));
    else if (arg === '--output-dir') options.outputDir = resolve(take());
    else if (arg.startsWith('--output-dir=')) options.outputDir = resolve(arg.slice(13));
    else if (arg === '--manifest') options.manifest = resolve(take());
    else if (arg.startsWith('--manifest=')) options.manifest = resolve(arg.slice(11));
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.input || !options.plan || !options.outputDir) {
    throw new Error('--input, --plan, and --output-dir are required');
  }
  options.manifest ||= join(options.outputDir, 'manifest.json');
  return options;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const [source, rawPlan] = await Promise.all([
    readFile(options.input, 'utf8'),
    readFile(options.plan, 'utf8'),
  ]);
  const parsedPlan = JSON.parse(rawPlan);
  const plan = Array.isArray(parsedPlan) ? parsedPlan : parsedPlan?.mutations;
  const mutants = applyMutationPlan(source, plan);
  await mkdir(options.outputDir, { recursive: true });
  await mkdir(dirname(options.manifest), { recursive: true });

  const extension = extname(options.input).toLowerCase() || '.html';
  const rows = [];
  for (const mutant of mutants) {
    const filename = `${mutant.caseId}${extension}`;
    const output = join(options.outputDir, filename);
    await writeFile(output, mutant.source);
    rows.push({
      case_id: mutant.caseId,
      operator: mutant.operator,
      operator_name: mutant.operatorName,
      matches: mutant.matches,
      output: filename,
      sha256: sha256(mutant.source),
      status: 'generated_not_evaluated',
    });
  }

  const manifest = {
    schema_version: '1.0',
    source_file: basename(options.input),
    source_sha256: sha256(source),
    mutants: rows,
    note: 'Generation records only. Run each output through the pinned evaluator to classify killed or survived.',
  };
  await writeFile(options.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ mutants: rows.length, manifest: options.manifest }, null, 2));
}

main().catch(error => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
