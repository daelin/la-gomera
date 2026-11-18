import { test } from 'node:test';
import assert from 'node:assert/strict';
import { status, dayLabel, parseOH } from '../js/hours.js';

const at = (iso) => new Date(iso);

test('weekday rules with siesta break', () => {
  const oh = 'Mo-Fr 08:00-14:00,17:00-20:00; Sa 09:00-13:00; Su off';
  assert.equal(status(oh, at('2026-11-23T15:00:00')).label, 'Zu – öffnet 17:00');
  assert.equal(status(oh, at('2026-11-23T18:00:00')).state, 'open');
  assert.equal(dayLabel(oh, at('2026-11-22T12:00:00')), 'geschlossen'); // Sunday
});

test('Sunday short hours and next opening on following day', () => {
  const oh = 'Mo-Sa 09:00-21:00; Su 09:00-15:00';
  assert.equal(status(oh, at('2026-11-22T12:00:00')).label, 'Offen bis 15:00');
  assert.equal(status(oh, at('2026-11-22T16:00:00')).label, 'Zu – öffnet morgen 09:00');
});

test('public holiday 8 Dec overrides weekday rule', () => {
  assert.equal(status('Mo-Sa 08:30-20:30; PH off', at('2026-12-08T10:00:00')).state, 'closed');
  assert.equal(status('Mo-Su,PH 06:45-21:00', at('2026-12-08T10:00:00')).state, 'open');
});

test('intervals past midnight and 24/7', () => {
  assert.equal(status('Mo-Sa 08:30-01:00', at('2026-11-24T00:30:00')).state, 'open');
  assert.equal(dayLabel('24/7', at('2026-11-23T12:00:00')), 'durchgehend geöffnet');
});

test('tolerates spaces after commas, rejects free text', () => {
  assert.ok(parseOH('Mo-Sa 07:30-21:00; Su, PH off'));
  assert.equal(parseOH('"der Inhaber entscheidet flexibel"'), null);
  assert.equal(status('De Gusto: Tu-Sa 12:30-21:30').state, 'unknown');
});
