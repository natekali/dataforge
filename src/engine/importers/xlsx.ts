/**
 * Excel (.xlsx / .xls) parser built on SheetJS.
 *
 * Runtime-environment agnostic: safe in Web Workers and Node.
 */

import { read, utils } from 'xlsx';

/**
 * Parses the first sheet of an Excel workbook into row objects.
 *
 * The first row of the sheet is used as the header; missing cells are filled
 * with `null` so every row exposes the same keys.
 *
 * @param data - The raw workbook bytes.
 * @returns One object per data row, keyed by header names. Empty workbooks
 *          yield an empty array.
 */
export function parseXlsx(data: ArrayBuffer): unknown[] {
  const workbook = read(data, { type: 'array' });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];

  return utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
}
