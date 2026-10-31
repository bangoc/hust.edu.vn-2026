'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { HostGate } = require('../../adapters/outbound/network/host-gate');

function createClock(initialMs = 1_000_000) {
  let currentMs = initialMs;
  return {
    now: () => new Date(currentMs),
    advance(delayMs) {
      currentMs += delayMs;
    },
    get currentMs() {
      return currentMs;
    },
  };
}

test('giãn cách hai request cùng host theo delayMs', async () => {
  const clock = createClock();
  const sleeps = [];
  const gate = new HostGate({
    delayMs: 500,
    clock,
    sleepImpl: async (delayMs) => {
      sleeps.push(delayMs);
      clock.advance(delayMs);
    },
  });

  await gate.wait('hust.edu.vn');
  await gate.wait('HUST.edu.vn');

  assert.deepEqual(sleeps, [500]);
});

test('host khác không phải chờ host trước', async () => {
  const clock = createClock();
  const sleeps = [];
  const gate = new HostGate({
    delayMs: 500,
    clock,
    sleepImpl: async (delayMs) => {
      sleeps.push(delayMs);
      clock.advance(delayMs);
    },
  });

  await gate.wait('hust.edu.vn');
  await gate.wait('soict.hust.edu.vn');

  assert.deepEqual(sleeps, []);
});

test('delayMs bằng 0 không sleep nhưng vẫn ghi nhận host', async () => {
  const clock = createClock();
  const sleeps = [];
  const gate = new HostGate({
    delayMs: 0,
    clock,
    sleepImpl: async (delayMs) => {
      sleeps.push(delayMs);
    },
  });

  await gate.waitForUrl('https://hust.edu.vn/tin-tuc');
  await gate.waitForUrl('https://hust.edu.vn/thong-bao');

  assert.deepEqual(sleeps, []);
});

test('các request cùng host được xếp hàng, không chạy sleep song song', async () => {
  const clock = createClock();
  const events = [];
  const gate = new HostGate({
    delayMs: 100,
    clock,
    sleepImpl: async (delayMs) => {
      events.push(`sleep:${delayMs}`);
      clock.advance(delayMs);
    },
  });

  const first = gate.wait('hust.edu.vn').then(() => events.push('first'));
  const second = gate.wait('hust.edu.vn').then(() => events.push('second'));

  await Promise.all([first, second]);

  assert.deepEqual(events, ['first', 'sleep:100', 'second']);
});
