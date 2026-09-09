import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const value = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : ''; };
const stepId = value('--step');
const runId = value('--run-id');
const requestedPlanDigest = value('--plan-digest');
const manifest = JSON.parse(fs.readFileSync('C:\\harness\\config\\runs\\audep-speed.json', 'utf8'));
const planDigest = manifest.planDigest;
const verifierProfile = value('--verifier-profile');
const appRoot = manifest.projects?.['main-app']?.profile || 'C:\\retry-harness-run';
const qwenRoot = manifest.projects?.['qwen-asr']?.profile || 'C:\\Users\\rhyse\\Qwen3-ASR';
const appVerifier = `${appRoot}\\mgmt\\dev\\260906\\verify-upload-987-browser.mjs`;
const source = manifest.adapters?.['main-app']?.source || `${appRoot}\\src\\backend\\data\\media\\1788683394546-ebc52030-3330-4ddb-92dc-b95d9c76a26d-987-mtmo3aqe-c4b8b6ddfda248.mp3`;
const checks = {
  A0: [process.execPath, [`${appRoot}\\mgmt\\dev\\260905\\verify-audep-source-identity.mjs`], appRoot],
  A1: [process.execPath, [`${appRoot}\\mgmt\\dev\\260905\\verify-audep-12_5-5-plan.mjs`], appRoot],
  A2A: [process.execPath, [`${appRoot}\\mgmt\\dev\\260905\\verify-fake-qwen-audep-remote.mjs`], appRoot],
  A2B: [process.execPath, [`${appRoot}\\mgmt\\dev\\260905\\verify-live-qwen-transport.mjs`], appRoot],
  A3: [process.execPath, [`${appRoot}\\mgmt\\dev\\260905\\verify-qwen-audep-client.mjs`], appRoot],
  A4: [process.execPath, [appVerifier], appRoot],
  A5: [process.execPath, [`${appRoot}\\mgmt\\dev\\260829\\verify-audep-semantic-quality-gate.mjs`], appRoot],
  A6: [process.execPath, [appVerifier], appRoot],
  A7: [process.execPath, [appVerifier], appRoot],
  Q0: [process.env.QWEN_PYTHON || 'python', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_audep*.py', '-v'], qwenRoot],
  Q1: [process.env.QWEN_PYTHON || 'python', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_audep*.py', '-v'], qwenRoot],
  Q2: [process.env.QWEN_PYTHON || 'python', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_audep*.py', '-v'], qwenRoot],
  Q3: [process.env.QWEN_PYTHON || 'python', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_audep*.py', '-v'], qwenRoot],
  Q4: [process.env.QWEN_PYTHON || 'python', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_audep*.py', '-v'], qwenRoot],
  Q5: [process.env.QWEN_PYTHON || 'python', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_audep*.py', '-v'], qwenRoot],
  Q6: [process.env.QWEN_PYTHON || 'python', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_audep*.py', '-v'], qwenRoot],
  Q7: [process.env.QWEN_PYTHON || 'python', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py', '-v'], qwenRoot],
};

if (requestedPlanDigest !== planDigest) { console.error(`phase_command_plan_digest_mismatch:${requestedPlanDigest}:${planDigest}`); process.exitCode = 2; }
else if (!checks[stepId]) { console.error(`phase_command_unknown:${stepId}`); process.exitCode = 2; }
else {
  const [command, args, cwd] = checks[stepId];
  const child = spawn(command, args, { cwd, env: { ...process.env, AUDEP_APP_URL: process.env.AUDEP_APP_URL || manifest.adapters?.['main-app']?.appUrl || 'http://127.0.0.1:3102', AUDEP_987_SOURCE: source }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; process.stdout.write(chunk); });
  child.stderr.on('data', (chunk) => { output += chunk; process.stderr.write(chunk); });
  child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
  child.on('close', (code, signal) => {
    if (code !== 0) { process.exitCode = code || 1; return; }
    const artifactId = crypto.createHash('sha256').update(output).digest('hex');
    const outputTypes = ['Q2', 'Q3', 'Q4', 'Q5'].includes(stepId) ? ['benchmark', 'acceptance'] : stepId === 'A7' ? ['acceptance', 'benchmark'] : stepId === 'Q7' ? ['release', 'acceptance'] : stepId === 'Q6' ? ['contract', 'acceptance'] : ['acceptance'];
    console.log(JSON.stringify({ runId, stepId, planDigest, verdict: 'pass', outputTypes, artifactId, verifier: { profile: verifierProfile, exitCode: 0, command, args, cwd } }));
  });
}
