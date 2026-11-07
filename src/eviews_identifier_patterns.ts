/**
 * EViews identifier names may contain expandable placeholders such as foo{%bar}baz.
 *
 * Keep repetitions unambiguous: an expression such as
 * ([A-Za-z_]\w*)+ can backtrack exponentially when no '=' follows a
 * long name. This matcher consumes plain text once, then any placeholders.
 */
const identifierBody = String.raw`(?:[A-Za-z_]\w*|\{[%!][A-Za-z_]\w*\}\w*)(?:\{[%!][A-Za-z_]\w*\}\w*)*`;
const identifier = String.raw`[%!]?${identifierBody}`;

/** Match variable assignments, capturing the variable name as group 1. */
export const assignmentPattern = new RegExp(String.raw`^(${identifier})\s*=`);

/** Match '@type annotations, capturing name (1) and EViews type (2). */
export const typeAnnotationPattern = new RegExp(
    String.raw`^(${identifier})\s*=>\s*(\w+)`, 'i'
);

/** Match an object before a dot in a function signature (name in group 1). */
export const signatureObjectPattern = new RegExp(
    String.raw`([%!]?${identifierBody})\.$`, 'i'
);

/** Match a complete EViews object name followed by a dot or type arrow. */
export const dottedReferencePattern = new RegExp(
    String.raw`[!%@]?${identifierBody}\.$`, 'i'
);
export const typeArrowReferencePattern = new RegExp(
    String.raw`[!%@]?${identifierBody}=>$`, 'i'
);

/** Match the token used by VS Code's completion and hover providers. */
export const completionWordPattern = new RegExp(
    String.raw`((?<=')@\w*|(?<==>)\w*|[!%@]?${identifierBody}\.?|[!%@])`, 'i'
);
export const hoverWordPattern = new RegExp(
    String.raw`[!%@]?${identifierBody}`, 'i'
);
