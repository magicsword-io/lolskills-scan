import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateReport, parseArguments, runScan } from '../scripts/check-skill.mjs';

const target = parseArguments(['--source', 'https://github.com/example/skills', '--ref', 'a'.repeat(40), '--skill-path', 'skills/demo/SKILL.md']);
const capability = 'b'.repeat(64);
function complete() {
  return { status: 'complete', target: { repository: target.repository, ref: target.ref, skillPath: 'skills/demo' }, report: {
    repository: target.repository, commitSha: target.ref, skillPath: target.skillPath, isDemo: false,
    verdict: 'no_findings', coverage: { complete: 1, incomplete: 0, gaps: [] },
    skills: [{ path: target.skillPath, verdict: 'no_findings', findings: [], rawMatches: [], rawMatchCount: 0, rawMatchesTruncated: false, intent: { status: 'not_requested' } }],
  } };
}
const receipt = () => Response.json({ statusUrl: `/api/v1/scans/${capability}` }, { status: 202 });

test('CLI help is offline and malformed invocation fails closed', () => {
  const script = fileURLToPath(new URL('../scripts/check-skill.mjs', import.meta.url));
  for (const flag of ['--help', '-h']) {
    const result = spawnSync(process.execPath, [script, flag], { encoding: 'utf8', env: {}, timeout: 5000 });
    assert.equal(result.status, 0); assert.match(result.stdout, /--skill-path/); assert.equal(result.stderr, '');
  }
  const invalid = spawnSync(process.execPath, [script, '--ref', 'main'], { encoding: 'utf8', env: {}, timeout: 5000 });
  assert.equal(invalid.status, 3); assert.equal(JSON.parse(invalid.stdout).decision, 'incomplete');
});

test('only the exact complete source clears the check', () => {
  assert.equal(evaluateReport(complete(), target).exitCode, 0);
  for (const key of ['repository', 'commitSha', 'skillPath', 'isDemo']) {
    const scan = complete(); scan.report[key] = 'wrong';
    assert.equal(evaluateReport(scan, target).exitCode, 3);
  }
  const scan = complete(); scan.target.skillPath = 'other';
  assert.equal(evaluateReport(scan, target).exitCode, 3);
});

test('raw signals and independent AI concerns pause installation', () => {
  const scan = complete(); scan.report.skills[0].rawMatchCount = 1;
  assert.equal(evaluateReport(scan, target).decision, 'findings_detected');
  for (const label of ['uncertain', 'likely_malicious']) {
    const ai = complete(); ai.report.skills[0].intent = { status: 'complete', label };
    assert.equal(evaluateReport(ai, target).decision, 'review_required');
    ai.report.skills[0].rawMatchCount = 1;
    assert.equal(evaluateReport(ai, target).decision, 'findings_detected');
  }
});

test('missing coverage and requested AI never clear an install', () => {
  const scan = complete(); scan.report.coverage.gaps.push('file omitted');
  assert.equal(evaluateReport(scan, target).exitCode, 3);
  assert.equal(evaluateReport(complete(), { ...target, intent: true }).exitCode, 3);
  for (const value of [null, {}, { status: 'complete' }, { status: 'incomplete' }]) {
    assert.equal(evaluateReport(value, target).exitCode, 3);
  }
});

test('file ledger requires complete bytes and every required analyzer', () => {
  const scan = complete(); const skill = scan.report.skills[0];
  skill.fileCount = 1; skill.totalBytes = 100;
  skill.analysisCoverage = { schemaVersion: 1, complete: true, files: [{ path: target.skillPath, sizeBytes: 100, analyzedBytes: 100, status: 'complete' }], analyzers: [{ id: 'nova', status: 'complete' }, { id: 'yara', status: 'complete' }] };
  assert.equal(evaluateReport(scan, target).exitCode, 0);
  skill.analysisCoverage.files[0].analyzedBytes = 99;
  assert.equal(evaluateReport(scan, target).exitCode, 3);
  skill.analysisCoverage.files[0].analyzedBytes = 100;
  skill.analysisCoverage.analyzers.pop();
  assert.equal(evaluateReport(scan, target).exitCode, 3);
});

test('submits once and polls without exposing capability or sending a key on reads', async () => {
  const responses = [receipt(), Response.json({ status: 'queued' }), Response.json(complete())];
  const calls = []; const key = 'test_' + 'k'.repeat(40);
  const result = await runScan(target, { apiKey: key, fetchImpl: async (url, init) => { calls.push({ url, init }); return responses.shift(); }, sleep: async () => {} });
  assert.equal(result.exitCode, 0); assert.equal(calls.length, 3);
  assert.equal(calls[0].url, 'https://lolskills.io/api/v1/scans');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${key}`);
  assert.equal(JSON.parse(calls[0].init.body).intent, false);
  for (const call of calls.slice(1)) { assert.equal(call.init.headers, undefined); assert.equal(call.init.redirect, 'error'); }
  assert.ok(!JSON.stringify(result).includes(capability)); assert.ok(!JSON.stringify(result).includes(key));
});

test('service failures are sanitized and never automatically resubmitted', async () => {
  for (const response of [Response.json({ message: capability }, { status: 429 }), Response.json({ statusUrl: `https://evil.test/${capability}` }, { status: 202 }), new Response('not json')]) {
    let calls = 0;
    const result = await runScan(target, { fetchImpl: async () => { calls++; return response; } });
    assert.equal(result.exitCode, 3); assert.equal(calls, 1); assert.ok(!JSON.stringify(result).includes(capability));
  }
});

test('polling stops at the deadline', async () => {
  let time = 0; let calls = 0;
  const result = await runScan(target, { fetchImpl: async () => ++calls === 1 ? receipt() : Response.json({ status: 'queued' }), now: () => time, sleep: async ms => { time += ms; }, timeoutMs: 50 });
  assert.equal(result.exitCode, 3); assert.equal(time, 50); assert.equal(calls, 2);
});
