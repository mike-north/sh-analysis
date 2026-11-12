/** The shared ecosystem map changes only as the map itself describes: a new map version, copied byte for byte to every repository. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

/** Pin the complete canonical file, including its final newline. */
const acceptedSha256 =
  "fa56cde52a39b762c76bcff9707f7a9cda5274fa5cdff6a953909418648ec144";

/** Only complete LF-delimited marker lines bound the payload; prose containing a marker is not a fence. */
function markerOffsets(source: Buffer, marker: Buffer): readonly number[] {
  const offsets: number[] = [];
  let offset = source.indexOf(marker);
  while (offset !== -1) {
    const after = offset + marker.length;
    if (
      (offset === 0 || source[offset - 1] === 10) &&
      (after === source.length || source[after] === 10)
    ) {
      offsets.push(offset);
    }
    offset = source.indexOf(marker, offset + marker.length);
  }
  return offsets;
}

void test("AGENTS contains exactly the canonical ecosystem map bytes inside one ordered fence", () => {
  const source = readFileSync(new URL("../AGENTS.md", import.meta.url));
  const begin = Buffer.from("<!-- ecosystem-map:begin -->");
  const end = Buffer.from("<!-- ecosystem-map:end -->");
  const starts = markerOffsets(source, begin);
  const ends = markerOffsets(source, end);
  assert.equal(starts.length, 1, "expected one standalone begin marker");
  assert.equal(ends.length, 1, "expected one standalone end marker");
  const start = starts.at(0);
  const finish = ends.at(0);
  assert.ok(
    start !== undefined && finish !== undefined && start < finish,
    "begin marker must precede end marker",
  );
  // Slice the original bytes after the begin line, retaining every payload byte up to the end line.
  const payload = source.subarray(start + begin.length + 1, finish);
  assert.equal(
    createHash("sha256").update(payload).digest("hex"),
    acceptedSha256,
  );
});
