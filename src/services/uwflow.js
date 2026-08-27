const UWFLOW_GRAPHQL = "https://uwflow.com/graphql";
const REQUEST_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 2000;

/**
 * UWFlow stores course codes lowercase and unspaced.
 * @param {string} raw
 */
function uwflowCode(raw) {
  return String(raw ?? "").toLowerCase().replace(/\s+/g, "");
}

const COURSE_QUERY = `
  query CourseRating($code: String!) {
    course(where: { code: { _eq: $code } }) {
      code
      name
      rating {
        liked
        easy
        useful
        filled_count
      }
    }
  }
`;

/** @type {Map<string, {expires: number, value: any}>} */
const cache = new Map();

function readCache(code) {
  const entry = cache.get(code);
  if (!entry) return undefined;
  if (entry.expires < Date.now()) {
    cache.delete(code);
    return undefined;
  }
  return entry.value;
}

function writeCache(code, value) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    // Cheap bound: drop the oldest insertion.
    cache.delete(cache.keys().next().value);
  }
  cache.set(code, { expires: Date.now() + CACHE_TTL_MS, value });
}

/**
 * Fetch a course's UWFlow ratings.
 *
 * The code travels as a GraphQL **variable**. It used to be interpolated into
 * the query string, so a quote in the URL path could rewrite the query — and
 * the endpoint is reachable directly, not only from the tooltip UI.
 *
 * Results are cached per process so a results page full of courses does not
 * hammer UWFlow on every page load; failures are not cached, so a transient
 * error does not pin a course to "no data" for the life of the process.
 *
 * @param {string} rawCode
 * @returns {Promise<{code: string, name: string, liked: number|null, easy: number|null, useful: number|null, filledCount: number} | null>}
 */
export async function getCourseRating(rawCode) {
  const code = uwflowCode(rawCode);
  if (!code) return null;

  const cached = readCache(code);
  if (cached !== undefined) return cached;

  const response = await fetch(UWFLOW_GRAPHQL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: COURSE_QUERY, variables: { code } }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`UWFlow responded ${response.status}`);
  }

  const payload = await response.json();
  const course = payload?.data?.course?.[0] ?? null;

  const result = course
    ? {
        code: course.code,
        name: course.name,
        liked: course.rating?.liked ?? null,
        // `easy` was requested by the query but dropped by the route, so every
        // tooltip rendered "Easy: NaN%".
        easy: course.rating?.easy ?? null,
        useful: course.rating?.useful ?? null,
        filledCount: course.rating?.filled_count ?? 0,
      }
    : null;

  writeCache(code, result);
  return result;
}

/** Drop cached ratings. Used by tests. */
export function clearRatingCache() {
  cache.clear();
}
