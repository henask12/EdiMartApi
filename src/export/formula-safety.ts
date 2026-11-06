/**
 * Spreadsheet programs run cells that start with = + - @ (or a tab/CR) as formulas. A product or
 * customer name like `=HYPERLINK(...)` would then execute when someone opens an export, so such
 * text is prefixed with an apostrophe. Plain numbers (including negatives like -3) are left alone.
 */
const PLAIN_NUMBER = /^[-+]?\d+(\.\d+)?$/;
const FORMULA_START = /^[=+\-@\t\r]/;

export const neutralizeFormula = (value: string): string => {
  if (PLAIN_NUMBER.test(value)) {
    return value;
  }
  return FORMULA_START.test(value) ? `'${value}` : value;
};
