#!/usr/bin/env node

const axios = require('axios');
const extract = require('extract-zip');
const { createWriteStream } = require('fs');
const { mkdir, rm, readdir } = require('fs/promises');
const { join } = require('path');
const dotenv = require('dotenv');
dotenv.config();
const NOTION_API = 'https://www.notion.so/api/v3';
const { NOTION_TOKEN, NOTION_FILE_TOKEN, NOTION_SPACE_ID } = process.env;

if (!NOTION_TOKEN || !NOTION_FILE_TOKEN || !NOTION_SPACE_ID) {
  console.error('❌ Missing required environment variables: NOTION_TOKEN, NOTION_FILE_TOKEN, NOTION_SPACE_ID');
  process.exit(1);
}

const client = axios.create({
  baseURL: NOTION_API,
  headers: {
    Cookie: `token_v2=${NOTION_TOKEN}; file_token=${NOTION_FILE_TOKEN}`,
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
    'Notion-Client-Version': '23.13.0.1773',
    'Notion-Audit-Log-Platform': 'web'
  }
});

async function post(endpoint, data) {
  try {
    console.log(`📡 Sending request to ${endpoint} with data:`, JSON.stringify(data, null, 2));
    const response = await client.post(endpoint, data);
    console.log(`✅ Response from ${endpoint}:`, response.data);
    return response;
  } catch (error) {
    console.error(`🚨 API request to ${endpoint} failed:`, error.response?.data || error.message);
    throw error;
  }
}

async function sleep(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

async function getExportURL(startTime) {
  while (true) {
    await sleep(10);
    const payload = {
      spaceId: NOTION_SPACE_ID,
      size: 20,
      type: "unread_and_read",
      variant: "no_grouping"
    };

    let { data } = await post('getNotificationLogV2', payload);
    const activities = Object.values(data.recordMap.activity || {});

    console.log(`🔍 Found ${activities.length} activities. Logging timestamps:`);
    activities.forEach(activity => {
      const timestamp = activity.value?.value?.start_time;
      if (timestamp) {
        const elapsedTime = (timestamp - startTime) / 1000;
        console.log(`🔹 Activity type: ${activity.value?.value?.type}, Timestamp: ${timestamp}, Time since start: ${elapsedTime}s`);
      }
    });

    const exportActivity = activities.find(activity =>
      activity.value?.value?.type === 'export-completed' &&
      activity.value?.value?.start_time >= startTime
    );

    if (exportActivity) {
      const timestamp = exportActivity.value.value.start_time;
      const exportURL = exportActivity.value.value.edits[0].link;
      console.warn(`✅ Export URL found: ${exportURL}`);
      console.warn(`🕒 Export timestamp: ${timestamp}, Time since start: ${(timestamp - startTime) / 1000}s`);
      return exportURL;
    }
    console.warn('⏳ Waiting for export to complete...');
  }
}

async function exportFromNotion(format) {
  try {
    console.log(`📤 Initiating export for format: ${format}`);
    const startTime = Date.now();
    await post('enqueueTask', {
      task: {
        eventName: 'exportSpace',
        request: {
          spaceId: NOTION_SPACE_ID,
          exportOptions: {
            exportType: format,
            timeZone: 'America/New_York',
            locale: 'en',
          },
          shouldExportComments: false,
        },
      },
    });

    const exportURL = await getExportURL(startTime);
    console.log(`📥 Downloading export from ${exportURL}`);
    const res = await client({
      method: 'GET',
      url: exportURL,
      responseType: 'stream',
      headers: {
        Cookie: `token_v2=${NOTION_TOKEN}; file_token=${NOTION_FILE_TOKEN}`,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty'
      }
    });
    const filePath = join(process.cwd(), `${format}.zip`);
    const stream = res.data.pipe(createWriteStream(filePath));

    await new Promise((resolve, reject) => {
      stream.on('close', resolve);
      stream.on('error', reject);
    });
  } catch (err) {
    console.error('🚨 Error during export:', err);
    throw err;
  }
}

async function run() {
  const cwd = process.cwd();
  const mdDir = join(cwd, 'markdown');
  const mdFile = join(cwd, 'markdown.zip');
  const htmlDir = join(cwd, 'html');
  const htmlFile = join(cwd, 'html.zip');

  console.log('🗑️ Removing old backups...');
  await rm(mdDir, { recursive: true, force: true });
  await rm(htmlDir, { recursive: true, force: true });

  try {
    await exportFromNotion('markdown');
    await mkdir(mdDir, { recursive: true });
    await extract(mdFile, { dir: mdDir });
    await extractInnerZip(mdDir);
  } catch (err) {
    console.error('🚨 Markdown export failed. Skipping cleanup to retain old backups.');
    return;
  }
  
  try {
    await exportFromNotion('html');
    await mkdir(htmlDir, { recursive: true });
    await extract(htmlFile, { dir: htmlDir });
    await extractInnerZip(htmlDir);
  } catch (err) {
    console.error('🚨 HTML export failed. Skipping cleanup to retain old backups.');
  }
}

async function extractInnerZip(dir) {
  const files = (await readdir(dir)).filter(fn => /Part-\d+\.zip$/i.test(fn));
  for (const file of files) {
    await extract(join(dir, file), { dir });
  }
}

run();