import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BOFA_CAPACITY_METRICS,
  BOFA_CAPACITY_RESEARCH,
  capacityNetAddition,
} from '../src/pages/AIDashboard/bofaCapacityData.ts';

test('net additions use the observed endpoints, preserve zero and round to one decimal', () => {
  const values = Object.freeze([0, null, 1.26]);
  assert.equal(capacityNetAddition(values), 1.3);
  assert.equal(capacityNetAddition([2.3, 0]), -2.3);
  assert.deepEqual(values, [0, null, 1.26]);
});

test('a missing or non-finite endpoint cannot become zero capacity or an inferred baseline', () => {
  for (const values of [[], [null, 2.3], [0, null], [null, null], [NaN, 1], [0, Infinity]]) {
    assert.equal(capacityNetAddition(values), null);
  }
});

test('headline expansion compares the 2025 research baseline with the 2030 forecast', () => {
  assert.equal(BOFA_CAPACITY_METRICS.baseCapacity, 40.9);
  assert.equal(BOFA_CAPACITY_METRICS.forecastCapacity, 219.4);
  assert.equal(BOFA_CAPACITY_METRICS.netAddition, 178.5);
  assert.ok(Math.abs(BOFA_CAPACITY_METRICS.capacityMultiple - 5.364303178484108) < 1e-12);
});

test('2030 neocloud addition share uses published annual additions rather than forecast stocks', () => {
  assert.equal(BOFA_CAPACITY_METRICS.annual2030Total, 45.4);
  assert.equal(BOFA_CAPACITY_METRICS.annual2030Neocloud, 17.9);
  assert.ok(Math.abs(BOFA_CAPACITY_METRICS.annual2030NeocloudShare - 0.3942731277533039) < 1e-12);
  assert.ok(Math.abs(BOFA_CAPACITY_METRICS.stock2030NeocloudShare - 0.2237921604376) < 1e-12);
  assert.ok(BOFA_CAPACITY_METRICS.annual2030NeocloudShare > BOFA_CAPACITY_METRICS.stock2030NeocloudShare);
});

test('published rounded global totals remain independent from the displayed group sum', () => {
  const groupSum2026 = BOFA_CAPACITY_RESEARCH.groups.reduce((sum, group) => sum + group.totals[1]!, 0);
  assert.equal(Math.round(groupSum2026 * 10) / 10, 62.9);
  assert.equal(BOFA_CAPACITY_RESEARCH.totals[1], 62.8);
  assert.equal(BOFA_CAPACITY_RESEARCH.increments[0], null);
  assert.ok(BOFA_CAPACITY_RESEARCH.groups.every(group => group.increments[0] === null));
});

test('operator detail retains chart missing values and separates tweet claims from chart calculations', () => {
  const skTelecom = BOFA_CAPACITY_RESEARCH.operators.find(row => row.id === 'sk-telecom');
  const iren = BOFA_CAPACITY_RESEARCH.operators.find(row => row.id === 'iren');
  const spacex = BOFA_CAPACITY_RESEARCH.operators.find(row => row.id === 'spacex-xai');
  assert.ok(skTelecom);
  assert.deepEqual(skTelecom.values.slice(0, 3), [null, null, null]);
  assert.equal(capacityNetAddition(skTelecom.values), null);
  assert.ok(iren);
  assert.equal(iren.values[0], 0);
  assert.equal(capacityNetAddition(iren.values), 2.3);
  assert.equal(iren.tweetIncrement, 3);
  assert.ok(spacex);
  assert.equal(spacex.group, 'neocloud');
});
