#!/usr/bin/env node

let { program } = require('commander');
let { writeFileSync, mkdirSync } = require('fs');
let { join, isAbsolute, dirname } = require('path');
let { NotionAPI } = require('notion-client');
let { parsePageId } = require('notion-utils');
let { NOTION_TOKEN } = process.env;
const nc = new NotionAPI({ authToken: NOTION_TOKEN });
const die = (str) => {
  console.error(str);
  process.exit(1);
};

// --version
program.version(require('./package.json').version);

program
  .option('-i, --id <id>', 'ID of the Notion document')
  .option('-c, --collection <collection>', 'ID of the Notion collection')
  .option('-v, --view <view>', 'ID of the Notion collection view')
  .option('-o, --out <file>', 'File to write to')
;

// now do something
program.parse(process.argv);

async function run () {
  let { id, collection, view, out } = program.opts();
  let refPage;
  if (collection) {
    if (!view) die('The --collection option requires --view to also be specified.');
    if (id) console.warn('Warning: --id will be ignored.');
    refPage = await nc.getCollectionData(parsePageId(collection), parsePageId(view));
  }
  else if (id) {
    if (view) console.warn('Warning: --view will be ignored.');
    refPage = await nc.getPage(parsePageId(id));
  }
  else die('Must specify one of --id or --collection/--view.');
  const json = JSON.stringify(refPage, null, 2);
  if (out) {
    const file = isAbsolute(out) ? out : join(process.cwd(), out);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, json);
    return;
  }
  process.stdout.write(json);
}
run();
