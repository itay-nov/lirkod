/**
 * Local ESLint rule: flags physical (left/right) CSS in favor of RTL-safe
 * logical properties. See AGENTS.md §7 — this app is Hebrew-first and RTL,
 * and `margin-left` / `right: 0` / `ml-4` style code silently breaks in RTL.
 *
 * What it catches:
 *   - Tailwind utility classes in a `className`/`class` JSX attribute whose
 *     token starts with ml-, mr-, pl-, pr-, left-, right- (with an optional
 *     leading "-" for negative values), in string literals and template
 *     literals written directly in the attribute.
 *   - Object properties named marginLeft, marginRight, paddingLeft,
 *     paddingRight, left, right inside an object literal passed to a JSX
 *     `style` attribute.
 *
 * What it will NOT catch (known gaps — flagged deliberately rather than
 * papered over):
 *   - Classes built dynamically: clsx(...), cn(...), template literals with
 *     interpolated variables, classnames stored in a separate variable/const
 *     and referenced by identifier.
 *   - Physical properties written in .css/.module.css files (this is a JS/TS
 *     AST rule; it does not parse CSS — that would need Stylelint).
 *   - Other physical utilities/properties this rule doesn't enumerate:
 *     border-l/border-r, rounded-l/rounded-r, text-left/text-right, float,
 *     inset (non-left/right forms). Only the properties named in the task
 *     (margin-left/right, padding-left/right, left, right) are covered.
 *   - `left`/`right` object keys that aren't CSS at all (e.g. tree-node
 *     pointers, drag coordinates) will false-positive if they appear inside
 *     a `style={{ ... }}` object — scoped to `style` attributes specifically
 *     to keep this rare.
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

function checkClassString(context, node, value) {
  if (typeof value !== "string") return;
  for (const token of value.split(/\s+/).filter(Boolean)) {
    if (PHYSICAL_CLASS_TOKEN.test(token)) {
      context.report({
        node,
        message: `Physical class "${token}" breaks RTL layouts. Use the logical Tailwind equivalent (ms-/me-/ps-/pe-/start-/end-) instead.`,
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
