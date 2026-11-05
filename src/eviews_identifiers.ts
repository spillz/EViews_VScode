/**
 * EViews names may contain expandable placeholders such as foo{%bar}baz.
 *
 * Keep repetitions unambiguous: an expression such as
 * ([A-Za-z_]\w*)+ can backtrack exponentially when no '=' follows a
 * long name. This matcher consumes plain text once, then any placeholders.
 */
const identifier = String.raw`[%!]?(?:[A-Za-z_]\w*|\{[%!][A-Za-z_]\w*\}\w*)(?:\{[%!][A-Za-z_]\w*\}\w*)*`;

/** Match variable assignments, capturing the variable name as group 1. */
export const assignmentPattern = new RegExp(String.raw`^(${identifier})\s*=`);

/** Match '@type annotations, capturing name (1) and EViews type (2). */
export const typeAnnotationPattern = new RegExp(
    String.raw`^(${identifier})\s*=>\s*(\w+)`, 'i'
);
