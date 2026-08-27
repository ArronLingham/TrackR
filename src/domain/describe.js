/** How many course codes to list before falling back to a summary. */
const MAX_LISTED = 12;

function listCodes(requirement) {
  const codes = (requirement.courses ?? []).map((course) => course.code);
  if (codes.length === 0) return "";
  if (codes.length <= MAX_LISTED) return codes.join(", ");
  return `${codes.slice(0, MAX_LISTED).join(", ")} and ${codes.length - MAX_LISTED} more`;
}

/** Human phrasing for the selectors a block matches on. */
function listSelectors(requirement) {
  const parts = [];
  if (requirement.range?.length) parts.push(requirement.range.join(", "));

  const levels = [...(requirement.level_ranges ?? []), ...(requirement.patterns ?? [])];
  if (levels.length) {
    parts.push(
      levels
        .map((token) => {
          const match = /^([A-Za-z]+)(\d+)$/.exec(token);
          return match ? `${match[1].toUpperCase()} ${match[2]}00-level` : token;
        })
        .join(", "),
    );
  }

  if (requirement.category_ranges?.length) parts.push(`any ${requirement.category_ranges.join(", ")} course`);
  return parts.join(", or ");
}

/**
 * Description shown for a requirement block.
 *
 * An authored `description` always wins — the calendar's own wording is
 * clearer than anything generated. The fallbacks exist so a block without one
 * still renders something useful; previously `range_required` discarded its
 * generated fallback and rendered `undefined`.
 *
 * @param {any} requirement
 * @returns {string}
 */
export function describe(requirement) {
  if (requirement.description) return requirement.description;

  const codes = listCodes(requirement);
  const selectors = listSelectors(requirement);
  const from = [codes, selectors].filter(Boolean).join(", or ");

  switch (requirement.type) {
    case "all_required":
      return `Complete all of ${codes}`;
    case "one_required":
      return `Complete one of ${codes}`;
    case "n_required":
    case "range_required": {
      const extra = requirement.required?.length
        ? `, including ${requirement.required.join(", ")}`
        : "";
      return `Complete ${requirement.count} from ${from}${extra}`;
    }
    case "one_group_required": {
      const options = (requirement.groups ?? []).map(describe).filter(Boolean);
      return options.length ? options.join(" — or — ") : "Complete one of the following options";
    }
    default:
      return from ? `Complete ${from}` : "Requirement";
  }
}
