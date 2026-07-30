/**
 * The only place in this project that talks to the network.
 *
 * https://www.openholidaysapi.org/ - no key, CORS open to any origin, so the
 * panel iframe can call it directly. Public holidays are computed and reach
 * arbitrarily far into the future; school holidays are maintained and reached
 * to 2030 when this was written.
 *
 * Every request asks for the whole country and leaves the filtering to
 * holidays.js. That keeps the number of round trips at two no matter how many
 * federal states are selected, and changing the selection needs no refetch.
 */
export const BASE_URL = 'https://openholidaysapi.org';

const COUNTRY = 'DE';
const LANGUAGE = 'DE';

function url(path, params) {
    const query = new URLSearchParams({
        countryIsoCode: COUNTRY,
        languageIsoCode: LANGUAGE,
        ...params,
    });
    return `${BASE_URL}/${path}?${query}`;
}

/**
 * `fetchFn` is injected so the tests never touch the network. Everything that
 * can go wrong here - offline, DNS, a 5xx, a body that is not a list - comes
 * out as one Error whose message names the service, because that message is
 * what the panel shows the user.
 */
async function getList(target, fetchFn) {
    let response;
    try {
        response = await fetchFn(target);
    } catch (error) {
        throw new Error(`OpenHolidays is not reachable: ${error?.message ?? error}`);
    }

    if (!response.ok) {
        throw new Error(`OpenHolidays answered ${response.status}.`);
    }

    const body = await response.json();
    if (!Array.isArray(body)) {
        throw new Error('OpenHolidays sent something that is not a list of entries.');
    }
    return body;
}

export async function fetchHolidays(year, { fetchFn = fetch } = {}) {
    const range = { validFrom: `${year}-01-01`, validTo: `${year}-12-31` };

    // Sequential, not parallel: two calls are not worth the concurrency, and a
    // failing first one should not leave a second request in flight against a
    // service that is evidently unwell.
    const publicHolidays = await getList(url('PublicHolidays', range), fetchFn);
    const schoolHolidays = await getList(url('SchoolHolidays', range), fetchFn);

    return { publicHolidays, schoolHolidays };
}

export async function fetchSubdivisions({ fetchFn = fetch } = {}) {
    return getList(url('Subdivisions', {}), fetchFn);
}
