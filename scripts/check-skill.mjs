import { pathToFileURL } from 'node:url';

const ORIGIN = 'https://lolskills.io';
const SHA = /^[a-f0-9]{40}$/;
const pending = new Set(['queued', 'fetching', 'scanning', 'analyzing']);
const intentLabels = new Set(['likely_malicious', 'dual_use_security', 'likely_benign', 'uncertain']);
const incomplete = reason => ({ exitCode: 3, decision: 'incomplete', reason });
export const usage = `Usage: node scripts/check-skill.mjs --source https://github.com/OWNER/REPO --ref FULL_COMMIT_SHA --skill-path path/SKILL.md [--intent]

Check an immutable public GitHub skill with LOLSkills before installation.

Options:
  --source URL       Canonical public GitHub repository URL
  --ref SHA          Full 40-character commit SHA
  --skill-path PATH  Repository-relative SKILL.md path
  --intent           Request optional advisory AI analysis
  --help, -h         Show this help without contacting LOLSkills

Environment:
  LOLSKILLS_API_KEY  Optional trusted integration key; never printed

Exit codes:
  0  Complete scan with no findings
  2  Findings detected or advisory review required; pause installation
  3  Incomplete, invalid, or unavailable scan; do not install`;

function completeAnalysisCoverage(coverage, skill, target) {
  if (coverage?.schemaVersion !== 1 || coverage.complete !== true ||
      !Array.isArray(coverage.files) || coverage.files.length < 1 || coverage.files.length > 1000 ||
      coverage.files.length !== skill.fileCount || !Array.isArray(coverage.analyzers)) return false;
  const paths = new Set();
  const root = target.skillPath === 'SKILL.md' ? '' : target.skillPath.slice(0, -8);
  let bytes = 0;
  for (const file of coverage.files) {
    if (file?.status !== 'complete' || typeof file.path !== 'string' || !file.path || file.path.length > 1024 ||
        /[\\\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069:%?#]/u.test(file.path) ||
        file.path.split('/').some(part => !part || part === '.' || part === '..') ||
        (root && !file.path.startsWith(root)) || paths.has(file.path) ||
        !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0 || file.sizeBytes > 50 * 1024 * 1024 ||
        file.analyzedBytes !== file.sizeBytes) return false;
    paths.add(file.path); bytes += file.sizeBytes;
  }
  const required = skill.intent?.status === 'complete' ? ['nova', 'yara', 'intent'] : ['nova', 'yara'];
  if (target.intent && skill.intent?.status !== 'complete') return false;
  const ids = new Set();
  for (const analyzer of coverage.analyzers) {
    if (analyzer?.status !== 'complete' || !required.includes(analyzer.id) || ids.has(analyzer.id)) return false;
    ids.add(analyzer.id);
  }
  return paths.has(target.skillPath) && bytes <= 50 * 1024 * 1024 && bytes === skill.totalBytes && ids.size === required.length;
}

export function parseArguments(args) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!['--source', '--ref', '--skill-path', '--intent'].includes(flag) || flag in values) throw new Error('arguments');
    values[flag] = flag === '--intent' ? true : args[++i];
  }
  const match = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+)\/?$/.exec(values['--source'] || '');
  const ref = values['--ref']?.toLowerCase();
  const skillPath = values['--skill-path'];
  if (!match || !SHA.test(ref || '') || typeof skillPath !== 'string' || skillPath.length > 500 ||
      !/^(?:[^/]+\/)*SKILL\.md$/.test(skillPath) || /[\\\x00-\x1f\x7f%?#]/.test(skillPath) ||
      skillPath.split('/').some(part => part === '.' || part === '..') || /\/(?:\.|\.\.)$/.test(match[1])) throw new Error('arguments');
  return { source: `https://github.com/${match[1]}`, repository: match[1], ref, skillPath, intent: values['--intent'] === true };
}

export function evaluateReport(scan, target) {
  const report = scan?.report;
  const skill = report?.skills?.[0];
  const expectedSkillRoot = target.skillPath === 'SKILL.md' ? '.' : target.skillPath.slice(0, -9);
  const scanTarget = scan?.target;
  if (scan?.status !== 'complete' || !report || report.isDemo !== false ||
      !scanTarget || typeof scanTarget.repository !== 'string' || scanTarget.repository.toLowerCase() !== target.repository.toLowerCase() ||
      scanTarget.ref !== target.ref || scanTarget.skillPath !== expectedSkillRoot || scanTarget.upload !== undefined ||
      typeof report.repository !== 'string' || report.repository.toLowerCase() !== target.repository.toLowerCase() ||
      report.commitSha !== target.ref || report.skillPath !== target.skillPath ||
      !Array.isArray(report.skills) || report.skills.length !== 1 || skill?.path !== target.skillPath) return incomplete('The result did not verify the requested repository, commit, and skill.');
  const coverage = report.coverage;
  if (coverage?.complete !== 1 || coverage.incomplete !== 0 || !Array.isArray(coverage.gaps) || coverage.gaps.length ||
      report.verdict === 'incomplete' || skill.verdict === 'incomplete') return incomplete('The requested scan has incomplete coverage.');
  if (skill.analysisCoverage !== undefined && !completeAnalysisCoverage(skill.analysisCoverage, skill, target)) return incomplete('The file or analyzer coverage is incomplete or invalid.');
  if (!['no_findings', 'signals_detected', 'needs_review'].includes(report.verdict) ||
      !['no_findings', 'signals_detected', 'needs_review'].includes(skill.verdict) ||
      !Array.isArray(skill.findings) || !Array.isArray(skill.rawMatches) ||
      !Number.isSafeInteger(skill.rawMatchCount) || skill.rawMatchCount < skill.rawMatches.length ||
      typeof skill.rawMatchesTruncated !== 'boolean' ||
      !['complete', 'not_requested', 'not_applicable'].includes(skill.intent?.status) ||
      (skill.intent.status === 'complete' && !intentLabels.has(skill.intent.label)) ||
      (skill.intent.status !== 'complete' && skill.intent.label !== undefined) ||
      (target.intent && skill.intent.status !== 'complete')) return incomplete('The result is missing required checks.');
  const advisoryReview = skill.intent.status === 'complete' && ['likely_malicious', 'uncertain'].includes(skill.intent.label);
  const detected = report.verdict !== 'no_findings' || skill.verdict !== 'no_findings' ||
    skill.findings.length > 0 || skill.rawMatchCount > 0 || skill.rawMatchesTruncated;
  return {
    exitCode: detected || advisoryReview ? 2 : 0, decision: detected ? 'findings_detected' : advisoryReview ? 'review_required' : 'no_findings',
    repository: target.repository, commitSha: target.ref, skillPath: target.skillPath,
    sourceUrl: `${target.source}/blob/${target.ref}/${target.skillPath.split('/').map(encodeURIComponent).join('/')}`,
    correlatedFindingCount: skill.findings.length, rawMatchCount: skill.rawMatchCount, advisoryReview,
    reason: detected ? (advisoryReview ? 'Findings detected. Stop the install workflow. The advisory AI assessment also raises concerns.' : 'Findings detected. Stop the install workflow.') : advisoryReview ? 'Pause installation and review the advisory AI assessment with the user.' : 'Complete scan with no findings. Applies only to this version; not a guarantee of safety.'
  };
}

export async function runScan(target, { apiKey = '', fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, timeoutMs = 25 * 60 * 1000 } = {}) {
  if (typeof apiKey !== 'string' || (apiKey && !/^[A-Za-z0-9_-]{32,256}$/.test(apiKey))) return incomplete('The optional LOLSKILLS_API_KEY is not valid. Check the trusted environment.');
  const deadline = now() + timeoutMs;
  async function request(path, init = {}) {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error('timeout');
    const response = await fetchImpl(`${ORIGIN}${path}`, { ...init, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(Math.min(30000, remaining)) });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('response');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('response');
    const chunks = []; let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('response'); }
      chunks.push(value);
    }
    return { status: response.status, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  }
  try {
    const { source, ref, skillPath, intent } = target;
    const submission = await request('/api/v1/scans', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) }, body: JSON.stringify({ source, ref, skillPath, intent }) });
    // Read capabilities stay in memory. Never follow arbitrary response URLs or
    // carry the submission credential into report requests.
    const statusPath = submission.body?.statusUrl;
    if (submission.status !== 202 || typeof statusPath !== 'string' || !/^\/api\/v1\/scans\/[a-f0-9]{64}$/.test(statusPath)) return incomplete('The service returned an invalid scan receipt.');
    while (now() < deadline) {
      const { body: scan } = await request(statusPath);
      if (scan?.status === 'complete') return evaluateReport(scan, target);
      if (scan?.status === 'incomplete') return incomplete('The service could not complete the requested scan.');
      if (!pending.has(scan?.status)) return incomplete('The service returned an unknown scan state.');
      await sleep(Math.min(5000, Math.max(0, deadline - now())));
    }
    return incomplete('Timed out waiting for the scan. Installation remains paused.');
  } catch {
    // Provider bodies and exceptions can contain capabilities or credentials.
    return incomplete('The scan request failed or timed out. Check API access and service availability; do not assume the skill passed.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let result;
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    process.stdout.write(`${usage}\n`);
  } else {
    try { result = await runScan(parseArguments(args), { apiKey: process.env.LOLSKILLS_API_KEY }); }
    catch { result = incomplete(`Invalid arguments. Run with --help for usage.\n${usage.split('\n')[0]}`); }
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.exitCode;
  }
}
