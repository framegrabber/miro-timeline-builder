import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchHolidays, fetchSubdivisions, BASE_URL } from '../src/openHolidays.js';

function recordingFetch(response) {
    const urls = [];
    const fetchFn = async (url) => {
        urls.push(url);
        return response;
    };
    return { urls, fetchFn };
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

test('one call per kind, for the whole country, bounded by the year', async () => {
    const { urls, fetchFn } = recordingFetch(ok([]));

    await fetchHolidays(2026, { fetchFn });

    assert.equal(urls.length, 2);
    for (const url of urls) {
        assert.ok(url.startsWith(BASE_URL), url);
        assert.match(url, /countryIsoCode=DE/);
        assert.match(url, /languageIsoCode=DE/);
        assert.match(url, /validFrom=2026-01-01/);
        assert.match(url, /validTo=2026-12-31/);
        // Filtering by state happens locally, so the request must not narrow
        // the answer - otherwise changing the selection would need a refetch.
        assert.doesNotMatch(url, /subdivisionCode/);
    }
    assert.match(urls[0], /PublicHolidays/);
    assert.match(urls[1], /SchoolHolidays/);
});

test('both kinds come back under their own name', async () => {
    const fetchFn = async (url) =>
        ok(url.includes('School') ? [{ kind: 'school' }] : [{ kind: 'public' }]);

    const result = await fetchHolidays(2026, { fetchFn });

    assert.deepEqual(result.publicHolidays, [{ kind: 'public' }]);
    assert.deepEqual(result.schoolHolidays, [{ kind: 'school' }]);
});

test('a non-2xx response names the service and the status', async () => {
    const fetchFn = async () => ({ ok: false, status: 503, json: async () => ({}) });

    await assert.rejects(fetchHolidays(2026, { fetchFn }), /OpenHolidays.*503/);
});

test('a network failure is passed on as a readable error', async () => {
    const fetchFn = async () => {
        throw new TypeError('Load failed');
    };

    await assert.rejects(fetchHolidays(2026, { fetchFn }), /OpenHolidays/);
});

test('a body that is not a list is refused rather than half-used', async () => {
    const fetchFn = async () => ok({ message: 'nope' });

    await assert.rejects(fetchHolidays(2026, { fetchFn }), /OpenHolidays/);
});

test('subdivisions are fetched without a date range', async () => {
    const { urls, fetchFn } = recordingFetch(ok([]));

    await fetchSubdivisions({ fetchFn });

    assert.equal(urls.length, 1);
    assert.match(urls[0], /Subdivisions\?countryIsoCode=DE/);
    assert.doesNotMatch(urls[0], /validFrom/);
});
