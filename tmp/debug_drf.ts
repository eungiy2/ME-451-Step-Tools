import { parseStepFile } from '../src/utils/stepParser.ts';
import { readFileSync } from 'fs';

const files = [
  './STEP samples with PMI/AP242/nist_ctc_01_asme1_ap242-e1.stp',
  './STEP samples with PMI/AP242/nist_ctc_02_asme1_ap242-e2.stp'
];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const result = parseStepFile(file.split('/').pop()!, text);
  console.log('FILE', file);
  for (const frame of result.datumReferenceFrames) {
    console.log('FRAME', frame.label, frame.entityId);
    for (const ref of frame.references) {
      const geom = (ref.surfaceGeometry || [])[0];
      console.log(' ', ref.datumIdentifier, 'surface', geom?.surfaceType);
      console.log('   point', geom?.point);
      console.log('   normal', geom?.normal);
      console.log('   axis', geom?.axis);
      console.log('   xDirection', geom?.xDirection);
    }
  }
}
