import assert from 'node:assert/strict';
import { createModels, calculateCost } from '/Users/ayu/Learn/pi/packages/ai/src/models.ts';
import { InMemoryCredentialStore } from '/Users/ayu/Learn/pi/packages/ai/src/auth/credential-store.ts';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '/Users/ayu/Learn/pi/packages/ai/src/providers/faux.ts';
import { EventStream } from '/Users/ayu/Learn/pi/packages/ai/src/utils/event-stream.ts';
import { lazyStream } from '/Users/ayu/Learn/pi/packages/ai/src/api/lazy.ts';
import { transformMessages } from '/Users/ayu/Learn/pi/packages/ai/src/api/transform-messages.ts';
import { InMemoryTelemetryContext, createTypedSpanStarter } from '/Users/ayu/Learn/pi/packages/telemetry/src/index.ts';
import { summarizeHarnessComparisons } from '/Users/ayu/Learn/pi/packages/evals/src/vitest-evals/summary.ts';

const stream = new EventStream(x => x === 3, x => x);
for (const n of [1, 2, 3, 4]) stream.push(n);
const events = []; for await (const n of stream) events.push(n);
assert.deepEqual(events, [1, 2, 3]); assert.equal(await stream.result(), 3);

const faux = fauxProvider({ deferred: { pendingFetches: 1 } });
const model = faux.getModel(); const models = createModels(); models.setProvider(faux.provider);
let started = false;
const lazy = lazyStream(model, async () => { started = true; throw Error('setup failed'); });
assert.equal(started, true); assert.equal((await lazy.result()).stopReason, 'error');
faux.setResponses([fauxAssistantMessage('ready')]);
const submitted = await models.completeSimple(model, { messages: [] }, { deferred: true });
assert.equal(submitted.stopReason, 'deferred');
assert.equal((await models.fetchDeferred(model, submitted.deferred)).stopReason, 'deferred');
assert.equal((await models.fetchDeferred(model, submitted.deferred)).content[0].text, 'ready');
assert.equal(faux.state.callCount, 1);

const history = [fauxAssistantMessage(fauxToolCall('read', { path: 'a' }, { id: 'call-1' }), { stopReason: 'toolUse' })];
const transformed = transformMessages(history, model);
assert.equal(history.length, 1); assert.equal(transformed.length, 2);
assert.equal(transformed[1].isError, true); assert.equal(transformed[1].content[0].text, 'No result provided');

const credentials = new InMemoryCredentialStore();
await credentials.modify('account', async () => ({ type: 'oauth', access: 'old', refresh: 'r', expires: 0 }));
let refreshes = 0;
const authModels = createModels({ credentials });
authModels.setProvider({ ...faux.provider, id: 'account', auth: { oauth: {
  name: 'offline', login: async () => { throw Error('unused'); },
  refresh: async () => { refreshes++; await Promise.resolve(); return { type: 'oauth', access: 'new', refresh: 'r2', expires: Date.now() + 3600000 }; },
  toAuth: async c => ({ apiKey: c.access }),
} } });
const auth = await Promise.all([authModels.getAuth('account'), authModels.getAuth('account')]);
assert.equal(refreshes, 1); assert.ok(auth.every(x => x.auth.apiKey === 'new'));

let releaseOld; let startedOld;
const oldStarted = new Promise(r => { startedOld = r; });
const oldGate = new Promise(r => { releaseOld = r; });
let phase = 0; let published;
const catalog = createModels();
catalog.setProvider({ ...faux.provider, refreshModels: async ctx => {
  if (!ctx.allowNetwork) return;
  const version = ++phase;
  if (version === 1) { startedOld(); await oldGate; }
  await ctx.publish({ update: () => { published = version; } });
} });
const oldRefresh = catalog.refresh(); await oldStarted;
await catalog.refresh(); releaseOld(); await oldRefresh; await new Promise(r => setImmediate(r));
assert.equal(published, 2);

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: {} };
calculateCost({ ...model, cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, tiers: [{ inputTokensAbove: 0, input: 3, output: 4, cacheRead: 0, cacheWrite: 0 }] } }, usage);
assert.equal(usage.cost.total, 0.000007);

const telemetry = new InMemoryTelemetryContext(); let saved;
const expected = { ok: true };
assert.equal(await telemetry.startSpan({ name: 'parent' }, async span => { saved = span; return span.startSpan({ name: 'child' }, () => expected); }), expected);
saved.setAttributes({ late: true }); await saved.startSpan({ name: 'late-child' }, () => 1);
assert.equal(telemetry.getSpans().length, 2); assert.equal(telemetry.getSpans()[0].attributes.late, undefined);
const sentinel = Error('business failure');
await assert.rejects(telemetry.startSpan({ name: 'failed' }, () => { throw sentinel; }), e => e === sentinel);
const typed = createTypedSpanStarter(telemetry, [{ version: 1, spans: {} }]);
assert.equal(await typed('runtime-unchecked-name', {}, () => 9), 9);

const common = { evalSet: 'e', groupKey: 'g', testName: 't', file: 'f', repetition: 1, baseline: 'a', candidates: ['b'] };
const report = summarizeHarnessComparisons([{ ...common, harness: 'a', outcome: 'scored', score: 1, totalTokens: 5 }, { ...common, harness: 'b', outcome: 'errored' }]);
assert.equal(report.evalSets[0].comparisons[0].correctness.eligiblePairs, 0);
assert.equal(report.evalSets[0].comparisons[0].totalTokens.candidateMean, null);
assert.equal(report.diagnostics[0].reason, 'harness-error');
console.log('PASS: 9 offline groups: event order, eager setup, faux deferred, message repair, OAuth serialization, generation guard, tier cost, telemetry passivity, paired eval exclusion');
