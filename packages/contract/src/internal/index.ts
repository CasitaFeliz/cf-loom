import type { Definitions } from '../definitions.ts';
import type { Dependencies } from '../dependencies.ts';
import type { Endpoint } from '../endpoint.ts';
import type { Group } from '../group.ts';
import type { Guard } from '../guard.ts';
import type { Rejection } from '../rejection.ts';
import type { Application, Contract } from '../roots.ts';
import type { StandardRejection } from '../standard-rejections.ts';

export { isOpen } from '../open.ts';

/** The `kind` every declaration carries, which the walker switches on to tell them apart. */
export type Kind =
  | Contract['kind']
  | Application['kind']
  | Definitions['kind']
  | Group['kind']
  | Endpoint['kind']
  | Guard['kind']
  | Rejection['kind']
  | StandardRejection['kind']
  | Dependencies['kind'];
