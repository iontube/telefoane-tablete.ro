#!/usr/bin/env node
/**
 * Auto-generate articles script for telefoane-tablete.ro
 * - Reads keywords from keywords.json
 * - Generates 1 article per run (rotates categories daily)
 * - Runs build and deploy to Cloudflare Pages
 * - Git commit handled by GitHub Actions workflow
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectDir = path.join(__dirname, '..');

// Load .env file manually
async function loadEnv() {
  try {
    const envPath = path.join(projectDir, '.env');
    const content = await fs.readFile(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          process.env[key.trim()] = valueParts.join('=').trim();
        }
      }
    }
  } catch (e) {
    // .env file is optional
  }
}

await loadEnv();

// Config
const ARTICLES_PER_RUN = parseInt(process.env.ARTICLES_PER_RUN) || 1;
const KEYWORDS_FILE = path.join(projectDir, 'keywords.json');
const LOG_FILE = path.join(projectDir, 'generation.log');

// Logging
async function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(message);
  await fs.appendFile(LOG_FILE, logMessage);
}

// Get the full paths to node/npm/npx
const NODE_PATH = process.execPath;
const NODE_BIN_DIR = path.dirname(NODE_PATH);
const NPM_PATH = path.join(NODE_BIN_DIR, 'npm');
const NPX_PATH = path.join(NODE_BIN_DIR, 'npx');

// Run command and return promise
function runCommand(command, args, cwd) {
  let actualCommand = command;
  if (command === 'node') actualCommand = NODE_PATH;
  else if (command === 'npm') actualCommand = NPM_PATH;
  else if (command === 'npx') actualCommand = NPX_PATH;

  return new Promise((resolve, reject) => {
    const proc = spawn(actualCommand, args, {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        PATH: `${NODE_BIN_DIR}:${process.env.PATH || ''}`
      }
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
    proc.on('error', reject);
  });
}

// Check if enough time passed since last generation
async function shouldRunToday() {
  try {
    const keywordsData = JSON.parse(await fs.readFile(KEYWORDS_FILE, 'utf-8'));
    const completed = keywordsData.completed || [];
    if (completed.length === 0) return true;

    const lastDate = completed
      .map(c => new Date(c.modifiedDate || c.date).getTime())
      .reduce((a, b) => Math.max(a, b), 0);

    const daysSinceLast = (Date.now() - lastDate) / (1000 * 60 * 60 * 24);
    // Skip only if already posted today (use 0.5 days to avoid timing issues with daily cron)
    if (daysSinceLast < 0.5) return false;
    return true;
  } catch {
    return true;
  }
}

// Generate stats.json
async function generateStats() {
  const pagesDir = path.join(projectDir, 'src', 'pages');
  const publicDir = path.join(projectDir, 'public');
  const excludePages = new Set(['index', 'contact', 'cookies', 'privacy-policy', 'privacy', 'gdpr', 'sitemap', '404', 'about', 'terms']);

  const files = await fs.readdir(pagesDir);
  const articles = files.filter(f => {
    if (!f.endsWith('.astro')) return false;
    const name = f.replace('.astro', '');
    if (name.startsWith('[')) return false;
    if (excludePages.has(name)) return false;
    return true;
  });

  const stats = { articlesCount: articles.length, lastUpdated: new Date().toISOString() };
  await fs.mkdir(publicDir, { recursive: true });
  await fs.writeFile(path.join(publicDir, 'stats.json'), JSON.stringify(stats, null, 2));
  await log(`Stats generated: ${articles.length} articles`);
}

// Main
async function main() {
  if (!await shouldRunToday()) {
    console.log(`[${new Date().toISOString()}] Skipping - last article was less than 12 hours ago`);
    process.exit(0);
  }

  await log('='.repeat(60));
  await log('AUTO-GENERATE STARTED - telefoane-tablete.ro');
  await log('='.repeat(60));

  // Random delay 0-20 minutes to avoid patterns
  const delayMs = Math.floor(Math.random() * 20 * 60 * 1000);
  const delayMin = Math.round(delayMs / 60000);
  await log(`Random delay: ${delayMin} minutes`);
  await new Promise(r => setTimeout(r, delayMs));

  // Read keywords
  let keywordsData;
  try {
    const content = await fs.readFile(KEYWORDS_FILE, 'utf-8');
    keywordsData = JSON.parse(content);
  } catch (error) {
    await log(`ERROR: Could not read keywords.json: ${error.message}`);
    process.exit(1);
  }

  const pendingKeywords = keywordsData.pending || [];

  if (pendingKeywords.length === 0) {
    await log('No more keywords to process. Stopping.');
    process.exit(0);
  }

  await log(`Pending keywords: ${pendingKeywords.length}`);
  await log(`Will generate: ${Math.min(ARTICLES_PER_RUN, pendingKeywords.length)} article(s)`);

  // Count completed before generation
  const completedBefore = (keywordsData.completed || []).length;

  // Run generate-article.js (it handles keywords.json internally)
  await log('Generating articles...');
  try {
    await runCommand('node', ['scripts/generate-article.js', `--limit=${ARTICLES_PER_RUN}`], projectDir);
    await log('Article generation completed');
  } catch (error) {
    await log(`ERROR generating articles: ${error.message}`);
    process.exit(1);
  }

  // Re-read keywords.json to check what was generated
  const updatedData = JSON.parse(await fs.readFile(KEYWORDS_FILE, 'utf-8'));
  const completedAfter = (updatedData.completed || []).length;
  const newArticles = completedAfter - completedBefore;

  await log(`Generated: ${newArticles}, Remaining: ${(updatedData.pending || []).length}`);

  if (newArticles === 0) {
    await log('No articles generated successfully. Skipping build and deploy.');
    await log('='.repeat(60));
    await log('AUTO-GENERATE COMPLETED (NO NEW ARTICLES)');
    await log('='.repeat(60));
    return;
  }

  // Generate stats.json before build
  await generateStats();

  // Build
  await log('Building site...');
  try {
    await runCommand('npm', ['run', 'build'], projectDir);
    await log('Build completed');
  } catch (error) {
    await log(`ERROR building: ${error.message}`);
    process.exit(1);
  }

  // Deploy to Cloudflare Pages (with retry)
  const projectName = process.env.CLOUDFLARE_PROJECT_NAME || 'telefoane-tablete-ro';
  const MAX_DEPLOY_RETRIES = 3;
  let deploySuccess = false;
  for (let attempt = 1; attempt <= MAX_DEPLOY_RETRIES; attempt++) {
    await log(`Deploying to Cloudflare (project: ${projectName})... attempt ${attempt}/${MAX_DEPLOY_RETRIES}`);
    try {
      await runCommand('npx', ['wrangler', 'pages', 'deploy', 'dist', '--project-name', projectName, '--branch', 'main'], projectDir);
      await log('Deploy completed');
      deploySuccess = true;
      break;
    } catch (error) {
      await log(`Deploy attempt ${attempt} failed: ${error.message}`);
      if (attempt < MAX_DEPLOY_RETRIES) {
        const waitSec = attempt * 30;
        await log(`Waiting ${waitSec}s before retry...`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
      }
    }
  }
  if (!deploySuccess) {
    await log('ERROR: All deploy attempts failed');
    process.exit(1);
  }

  await log('='.repeat(60));
  await log('AUTO-GENERATE COMPLETED SUCCESSFULLY');
  await log(`Remaining keywords: ${(updatedData.pending || []).length}`);
  if ((updatedData.pending || []).length === 0) {
    await log('All keywords processed! Consider removing the cron job.');
  }
  await log('='.repeat(60));
}

main().catch(async (error) => {
  await log(`FATAL ERROR: ${error.message}`);
  process.exit(1);
});
