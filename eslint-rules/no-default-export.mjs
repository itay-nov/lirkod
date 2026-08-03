/**
 * Local ESLint rule: flags `export default`. AGENTS.md §6 forbids default
 * exports except where Next.js requires them. That exemption is applied in
 * eslint.config.mjs via a per-filename override, not in this rule — this
 * rule just says "no default export" wherever it's turned on.
 */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description: "disallow default exports (AGENTS.md §6)",
    },
    schema: [],
  },
  create(context) {
    return {
      ExportDefaultDeclaration(node) {
        context.report({
          node,
          message:
            "Default exports are forbidden here (AGENTS.md §6). Use a named export, or — if this is a Next.js special file that requires one — add it to the exemption list in eslint.config.mjs.",
        });
      },
    };
  },
};

export default rule;
