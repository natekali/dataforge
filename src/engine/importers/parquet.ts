/**
 * Parquet parser built on hyparquet (pure-JS, browser/worker safe).
 *
 * Runtime-environment agnostic: safe in Web Workers and Node.
 */

import { parquetReadObjects, toJson } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

/**
 * Reads every row of a parquet file into plain JSON-friendly objects.
 *
 * All standard codecs (snappy, gzip, zstd, brotli, lz4 …) are supported via
 * hyparquet-compressors. Values are post-processed with hyparquet's `toJson`
 * so BigInts become numbers, dates become ISO strings, and byte arrays become
 * plain arrays — keeping rows structured-clone and IndexedDB friendly.
 *
 * @param data - The raw parquet file bytes.
 * @returns One object per row, keyed by column name.
 */
export async function parseParquet(data: ArrayBuffer): Promise<unknown[]> {
  // An ArrayBuffer structurally satisfies hyparquet's AsyncBuffer
  // ({ byteLength, slice }) so it can be passed directly.
  const records = await parquetReadObjects({
    file: data,
    compressors,
    utf8: true,
  });
  return records.map((row) => toJson(row) as unknown);
}
