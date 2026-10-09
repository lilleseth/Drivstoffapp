// Kjør med: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReceipt, parseNumber } from '../docs/js/receipt-parser.js';
import { computeStats, monthlyCost } from '../docs/js/stats.js';
import { mergeData } from '../docs/js/merge.js';

test('Circle K diesel', () => {
  const r = parseReceipt(`Circle K Lillestrøm
Org.nr 123 456 789 MVA
Pumpe 4  Miles Diesel
42,31 l x 21,49 kr/l   909,24
Total NOK   909,24
MVA 25%   181,85
05.10.2026 14:32`);
  assert.deepEqual(r, { liters: 42.31, totalPrice: 909.24, pricePerLiter: 21.49, fuelType: 'diesel',
    date: '2026-10-05T14:32', station: 'Circle K' });
});

test('beløp på linjen under nøkkelordet', () => {
  const r = parseReceipt(`UNO-X 7-ELEVEN
KVITTERING
Dato: 03/09/26 Kl: 08.15
Produkt: Blyfri 95
Liter: 35,50
Pris pr. liter: 22,19
Å BETALE
787,75`);
  assert.equal(r.liters, 35.5);
  assert.equal(r.pricePerLiter, 22.19);
  assert.equal(r.totalPrice, 787.75);
  assert.equal(r.fuelType, 'bensin');
  assert.equal(r.station, 'Uno-X');
  assert.equal(r.date, '2026-09-03T08:15');
});

test('tusenskille og ISO-dato', () => {
  const r = parseReceipt(`Esso Express Sandvika
Bensin 95 E10
Antall 40,12 ltr
Sum kr 1.002,60
Herav mva 200,52
2026-08-15 18:05`);
  assert.equal(r.liters, 40.12);
  assert.equal(r.totalPrice, 1002.6);
  assert.equal(r.pricePerLiter, 24.99);
  assert.equal(r.fuelType, 'bensin');
  assert.equal(r.station, 'Esso');
  assert.equal(r.date, '2026-08-15T18:05');
});

test('betalingsterminal-format', () => {
  const r = parseReceipt(`Shell Ski
V-Power 98
Volum 31,07 L
Pris/l 24,59
BELØP NOK 764,01
Kortnr ************1234
Ref 123456  09.10.26 07:44`);
  assert.equal(r.liters, 31.07);
  assert.equal(r.pricePerLiter, 24.59);
  assert.equal(r.totalPrice, 764.01);
  assert.equal(r.fuelType, 'bensin');
  assert.equal(r.date, '2026-10-09T07:44');
});

test('delsum og rabatt', () => {
  const r = parseReceipt(`YX Molde
Diesel
51,20 ltr @ 20,90
Subtotal 1 070,08
Rabatt 0,00
Totalt 1 070,08
Dato 01.02.2026`);
  assert.equal(r.liters, 51.2);
  assert.equal(r.pricePerLiter, 20.9);
  assert.equal(r.totalPrice, 1070.08);
  assert.equal(r.fuelType, 'diesel');
  assert.equal(r.date, '2026-02-01T12:00');
});

test('totalen regnes ut når den mangler', () => {
  const r = parseReceipt('Tanken Vinstra\nDiesel 50,00 l x 20,00 kr/l');
  assert.equal(r.totalPrice, 1000);
});

test('æøå etter tall gir ikke falske liter', () => {
  const r = parseReceipt('Circle K\n12,50 lørdag\nTotal 500,00');
  assert.equal(r.liters, null);
  assert.equal(r.totalPrice, 500);
});

test('ugyldig dato ignoreres', () => {
  assert.equal(parseReceipt('Dato 31.02.2026').date, null);
});

test('irrelevant tekst gir ingen verdier', () => {
  const r = parseReceipt('Hei og velkommen\nTakk for handelen');
  assert.equal(r.liters, null);
  assert.equal(r.totalPrice, null);
  assert.equal(r.fuelType, null);
  assert.equal(r.date, null);
});

test('parseNumber', () => {
  assert.equal(parseNumber('42,31'), 42.31);
  assert.equal(parseNumber('42.31'), 42.31);
  assert.equal(parseNumber('1 234,50'), 1234.5);
  assert.equal(parseNumber('1.234,50'), 1234.5);
  assert.equal(parseNumber('1,234.50'), 1234.5);
  assert.equal(parseNumber(' 900 '), 900);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('abc'), null);
  assert.equal(parseNumber('12abc'), null);
});

test('forbruk ignorerer første fylling', () => {
  const s = computeStats([
    { date: '2026-01-01T12:00', odometer: 1000, liters: 40, total: 800 },
    { date: '2026-01-10T12:00', odometer: 1500, liters: 35, total: 700 },
    { date: '2026-01-20T12:00', odometer: 2000, liters: 30, total: 600 },
  ]);
  assert.equal(s.count, 3);
  assert.equal(s.totalCost, 2100);
  assert.equal(s.averagePricePerLiter, 20);
  assert.equal(s.distance, 1000);
  assert.ok(Math.abs(s.litersPerMil - 0.65) < 1e-9);
  assert.ok(Math.abs(s.costPerKm - 1.3) < 1e-9);
});

test('én fylling gir ikke forbruk', () => {
  const s = computeStats([{ date: '2026-01-01T12:00', odometer: 1000, liters: 40, total: 800 }]);
  assert.equal(s.litersPerMil, null);
});

test('månedskostnad', () => {
  const m = monthlyCost([
    { date: '2026-10-02T12:00', total: 500 },
    { date: '2026-10-20T12:00', total: 300 },
    { date: '2026-08-01T12:00', total: 100 },
  ], 3, new Date(2026, 9, 9));
  assert.deepEqual(m.map((x) => [x.key, x.cost]), [['2026-08', 100], ['2026-09', 0], ['2026-10', 800]]);
});

test('sammenslåing velger nyeste versjon og beholder slettinger', () => {
  const local = { cars: [{ id: 'a', name: 'Golf', updatedAt: 5 }], fillUps: [
    { id: 'f1', total: 100, updatedAt: 10 },
    { id: 'f2', total: 200, updatedAt: 3, deleted: true },
  ] };
  const remote = { cars: [{ id: 'a', name: 'Golf GTI', updatedAt: 7 }, { id: 'b', name: 'Hilux', updatedAt: 1 }],
    fillUps: [
      { id: 'f1', total: 90, updatedAt: 8 },
      { id: 'f2', total: 200, updatedAt: 2 },
      { id: 'f3', total: 300, updatedAt: 4 },
    ] };
  const m = mergeData(local, remote);
  assert.deepEqual(m.cars.map((c) => c.name).sort(), ['Golf GTI', 'Hilux']);
  const byId = Object.fromEntries(m.fillUps.map((f) => [f.id, f]));
  assert.equal(byId.f1.total, 100);
  assert.equal(byId.f2.deleted, true);
  assert.equal(byId.f3.total, 300);
});
