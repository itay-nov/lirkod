/**
 * Local ESLint rule: flags physical (left/right) CSS in favor of RTL-safe
 * logical properties. See AGENTS.md §7 — this app is Hebrew-first and RTL,
 * and `margin-left` / `right: 0` / `ml-4` style code silently breaks in RTL.
 *
 * What it catches:
 *   - Tailwind utility classes in a `className`/`class` JSX attribute whose
 *     base utility (after stripping any number of variant prefixes, e.g.
 *     `sm:`, `hover:`, `rtl:`, `dark:hover:sm:`, or an arbitrary variant like
 *     `[&:hover]:`) starts with ml-, mr-, pl-, pr-, left-, right- (with an
 *     optional leading "-" for negative values), in string literals and
 *     template literals written directly in the attribute.
 *   - Object properties named marginLeft, marginRight, paddingLeft,
 *     paddingRight, left, right inside an object literal passed to a JSX
 *     `style` attribute.
 *
 * What it will NOT catch (known gaps — flagged deliberately rather than
 * papered over):
 *   - Classes built dynamically: clsx(...), cn(...), template literals with
 *     interpolated variables, classnames stored in a separate variable/const
 *     and referenced by identifier.
 *   - Physical properties written in .css/.module.css files — that's handled
 *     separately by Stylelint (see .stylelintrc.json), not this ESLint rule.
 *   - Other physical utilities/properties this rule doesn't enumerate:
 *     border-l/border-r, rounded-l/rounded-r, text-left/text-right, float,
 *     inset (non-left/right forms). Only the properties named in the task
 *     (margin-left/right, padding-left/right, left, right) are covered.
 *   - `left`/`right` object keys that aren't CSS at all (e.g. tree-node
 *     pointers, drag coordinates) will false-positive if they appear inside
 *     a `style={{ ... }}` object — scoped to `style` attributes specifically
 *     to keep this rare.
 *   - The Tailwind v4 trailing `!important` marker (`ml-4!`) — stripped
 *     variants leave `ml-4!`, and the base-utility regex still matches
 *     `ml-4` at the start of that string, so this case is in fact caught;
 *     documented here because it's easy to assume otherwise.
 */

const PHYSICAL_CLASS_TOKEN = /^-?(ml|mr|pl|pr|left|right)-/;
const PHYSICAL_STYLE_PROPS = new Set([
  "marginLeft",
  "marginRight",
  "paddingLeft",
  "paddingRight",
  "left",
  "right",
]);

// Tailwind variants are colon-separated segments before the base utility
// (`sm:`, `hover:`, `rtl:`, stacked as `dark:hover:sm:ml-4`). Arbitrary
// variants can contain brackets — `[&:hover]:ml-4` — which may themselves
// contain colons, so only split on a colon that isn't inside `[...]`.
function stripVariants(token) {
  let depth = 0;
  let lastSplit = 0;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === "[") depth++;
    else if (ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === ":" && depth === 0) lastSplit = i + 1;
  }
  return token.slice(lastSplit);
}

function checkClassString(context, node, value) {
  if (typeof value !== "string") return;
  for (const rawToken of value.split(/\s+/).filter(Boolean)) {
    const baseUtility = stripVariants(rawToken);
    if (PHYSICAL_CLASS_TOKEN.test(baseUtility)) {
      context.report({
        node,
        message: `Physical class "${rawToken}" breaks RTL layouts. Use the logical Tailwind equivalent (ms-/me-/ps-/pe-/start-/end-) instead.`,
      });
    }
  }
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "disallow physical (left/right) CSS in class names and inline styles; use logical properties for RTL safety",
    },
    schema: [],
    messages: {},
  },
  create(context) {
    return {
      JSXAttribute(node) {
        const name = node.name && node.name.name;
        if (name !== "className" && name !== "class") return;

        const value = node.value;
        if (!value) return;

        if (value.type === "Literal" && typeof value.value === "string") {
          checkClassString(context, node, value.value);
          return;
        }

        if (value.type === "JSXExpressionContainer") {
          const expr = value.expression;
          if (expr.type === "Literal" && typeof expr.value === "string") {
            checkClassString(context, node, expr.value);
          } else if (expr.type === "TemplateLiteral") {
            for (const quasi of expr.quasis) {
              checkClassString(context, node, quasi.value.raw);
            }
          }
        }
      },
      'JSXAttribute[name.name="style"] ObjectExpression > Property'(node) {
        const key = node.key;
        const keyName = key && (key.name ?? key.value);
        if (keyName && PHYSICAL_STYLE_PROPS.has(keyName)) {
          context.report({
            node,
            message: `Physical style property "${keyName}" breaks RTL layouts. Use the logical CSS property (margin-inline-start/end, padding-inline-start/end, inset-inline-start/end) instead.`,
          });
        }
      },
    };
  },
};

export default rule;
