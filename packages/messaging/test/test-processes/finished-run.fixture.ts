import { expect, test } from 'vitest';
import { runProcess } from '../test-process.ts';

test('a run that exits', async () => {
  const ran = await runProcess(process.execPath, ['-e', "process.stderr.write('warned')"]);

  expect(ran.status).toBe(0);
});
