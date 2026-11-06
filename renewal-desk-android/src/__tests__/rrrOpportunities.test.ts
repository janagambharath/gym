import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dismissOpportunityRequest,
  filterOpportunities,
  opportunitiesUrl,
  updateOpportunityRequest,
  type RrrOpportunity,
} from '../services/rrrOpportunities';

// PWA parity: renewal-desk-pwa/src/screens/rrr-list.js fetches
// GET /api/mobile/v1/rrr/opportunities?pillar=<pillar> and PATCHes
// /api/mobile/v1/rrr/opportunities/:id with { status }.
// Backend: app/mobile_api/rrr.py (rrr_opportunities / update_rrr_opportunity).

const sample: RrrOpportunity[] = [
  { id: 1, pillar: 'revenue', status: 'open', priority: 'high', reason: 'Expired plan, still visiting', potential_revenue: '2500', member: { name: 'Asha' } },
  { id: 2, pillar: 'revenue', status: 'open', priority: 'low', reason: 'Trial ended', potential_revenue: '1500', member: { name: 'Ravi' } },
  { id: 3, pillar: 'retain', status: 'open', priority: 'high', reason: 'Attendance down 60%', potential_revenue: '2000', member: { name: 'Kiran' } },
  { id: 4, pillar: 'recover', status: 'actioned', priority: 'medium', reason: 'Expired 30 days ago', potential_revenue: '3000', member: { name: 'Meena' } },
];

test('list renders all pillars: "all" returns every opportunity', () => {
  assert.equal(filterOpportunities(sample, 'all').length, 4);
  assert.deepEqual(
    filterOpportunities(sample, 'all').map((item) => item.id),
    [1, 2, 3, 4],
  );
});

test('pillar filter works: one pillar returns only its opportunities', () => {
  assert.deepEqual(filterOpportunities(sample, 'revenue').map((item) => item.id), [1, 2]);
  assert.deepEqual(filterOpportunities(sample, 'retain').map((item) => item.id), [3]);
  assert.deepEqual(filterOpportunities(sample, 'recover').map((item) => item.id), [4]);
  assert.deepEqual(filterOpportunities([], 'revenue'), []);
});

test('list URL matches the PWA: per-pillar query, no pillar for all', () => {
  assert.equal(opportunitiesUrl('revenue'), '/api/mobile/v1/rrr/opportunities?pillar=revenue');
  assert.equal(opportunitiesUrl('retain'), '/api/mobile/v1/rrr/opportunities?pillar=retain');
  assert.equal(opportunitiesUrl('recover'), '/api/mobile/v1/rrr/opportunities?pillar=recover');
  assert.equal(opportunitiesUrl('all'), '/api/mobile/v1/rrr/opportunities');
});

test('dismiss calls the right endpoint: PATCH /rrr/opportunities/:id with status dismissed', () => {
  const request = dismissOpportunityRequest(42);
  assert.equal(request.method, 'PATCH');
  assert.equal(request.path, '/api/mobile/v1/rrr/opportunities/42');
  assert.deepEqual(request.body, { status: 'dismissed' });
});

test('mark actioned uses the same endpoint with status actioned', () => {
  const request = updateOpportunityRequest(7, 'actioned');
  assert.equal(request.method, 'PATCH');
  assert.equal(request.path, '/api/mobile/v1/rrr/opportunities/7');
  assert.deepEqual(request.body, { status: 'actioned' });
});

test('close as recovered carries the owner-confirmed outcome_revenue', () => {
  const request = updateOpportunityRequest(9, 'closed', '2500');
  assert.equal(request.method, 'PATCH');
  assert.equal(request.path, '/api/mobile/v1/rrr/opportunities/9');
  assert.deepEqual(request.body, { status: 'closed', outcome_revenue: '2500' });
});

test('invalid status and missing outcome_revenue are rejected before any request', () => {
  assert.throws(() => updateOpportunityRequest(1, 'bogus' as never), /Invalid opportunity status/);
  assert.throws(() => updateOpportunityRequest(1, 'closed'), /outcome_revenue is required/);
});
