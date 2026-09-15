import assert from 'node:assert/strict';
import { track, apply, applyImmutable, encoder, decoder, assertValidOp } from '/Users/ayu/Learn/pi/packages/chord/src/delta/index.ts';
import { encodeCbor, decodeCbor } from '/Users/ayu/Learn/pi/packages/protocol/src/cbor/index.ts';
import { encodeFrame, FrameDecoder } from '/Users/ayu/Learn/pi/packages/protocol/src/framing.ts';

const tracked = track({ text: 'abcdefgh', rows: [{ value: 1 }] });
const enc = encoder(); const batches = [enc.encode(tracked.flush())];
tracked.state.text = 'defghxyz'; tracked.state.rows.push({ value: 2 });
batches.push(enc.encode(tracked.flush()));
tracked.rebase(); batches.push(enc.encode(tracked.flush()));
tracked.state.text += '!'; batches.push(enc.encode(tracked.flush()));
const dec = decoder(); let replica;
for (const batch of batches.slice(2)) replica = apply(replica, dec.decode(batch));
assert.deepEqual(replica, tracked.target);
assert.deepEqual(tracked.flush(), []);
const wireEncoder = encoder();
assert.deepEqual(wireEncoder.encode([['a', ['s'], '1']]), [['a', ['s'], '1']]);
assert.deepEqual(wireEncoder.encode([['a', ['s'], '2']]), [['#', 0, ['s']], ['a', 0, '2']]);
assert.throws(() => decoder().decode([['a', 'missing-path']]), /unresolvable/);

assert.throws(() => apply({}, [['s', ['__proto__', 'polluted'], true]]), /unsafe/);
assert.equal({}.polluted, undefined);
assert.throws(() => apply({ xs: [] }, [['s', ['xs', 100000], 1]]), /unsafe/);
const adopted = { value: 1 }; assert.equal(apply(undefined, [['r', adopted]]), adopted);
const immutable = applyImmutable(undefined, [['r', adopted], ['s', ['value'], 2]]);
assert.equal(adopted.value, 1); assert.equal(immutable.value, 2);
assert.doesNotThrow(() => assertValidOp(['r', new Map()]));
assert.throws(() => encodeCbor(new Map()), /Unsupported/);

let seed = 0x1234;
const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0);
for (let round = 0; round < 30; round++) {
  const t = track({ rows: [{ text: 'a' }], n: 0 }); const e = encoder(); const d = decoder();
  let state = apply(undefined, d.decode(e.encode(t.flush())));
  for (let step = 0; step < 40; step++) {
    switch (random() % 4) {
      case 0: t.state.rows.push({ text: String(step) }); break;
      case 1: if (t.state.rows.length > 1) t.state.rows.shift(); break;
      case 2: t.state.rows[0].text += 'x'; break;
      default: t.state.n++;
    }
    state = apply(state, d.decode(e.encode(t.flush())));
    assert.deepEqual(state, t.target);
  }
}

const value = { text: '水', n: -0, bytes: new Uint8Array([1, 2]), empty: null };
assert.deepEqual(decodeCbor(encodeCbor(value)), value);
const special = JSON.parse('{"__proto__":{"safe":true}}');
assert.deepEqual(decodeCbor(encodeCbor(special)), special); assert.equal({}.safe, undefined);
for (const hex of ['a2616101616102', '61ff', '0000', '9f', 'c000', '1b0020000000000000']) {
  assert.throws(() => decodeCbor(Uint8Array.from(Buffer.from(hex, 'hex'))));
}
assert.throws(() => encodeCbor([1, 2], { maxContainerLength: 1 }), /limit/);
assert.throws(() => decodeCbor(encodeCbor([[0]]), { maxDepth: 1 }), /depth/);
const framed = encodeFrame(encodeCbor({ ok: true })); const framing = new FrameDecoder(); const out = [];
for (const byte of framed) out.push(...framing.push(Uint8Array.of(byte)));
framing.end(); assert.equal(out.length, 1); assert.deepEqual(decodeCbor(out[0]), { ok: true });
const truncated = new FrameDecoder(); truncated.push(framed.slice(0, -1)); assert.throws(() => truncated.end(), /Truncated/);
console.log('PASS: delta base recovery, path dictionary, ownership, safety, 1200 deterministic mutations; CBOR subset/bounds; bytewise framing and truncation');
