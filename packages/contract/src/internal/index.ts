import type { Definitions } from '../definitions.ts';
import type { Dependencies } from '../dependencies.ts';
import type { Endpoint } from '../endpoint.ts';
import type { Group } from '../group.ts';
import type { Guard } from '../guard.ts';
import type { Rejection } from '../rejection.ts';
import type { Application, Contract } from '../roots.ts';
import type { StandardRejection } from '../standard-rejections.ts';

export { isOpen } from '../open.ts';
export type { DeclarationFailure, Failure, Rule } from '../validation/failures.ts';
export type {
  LocatedCode,
  LocatedDefinitions,
  LocatedEndpoint,
  LocatedGroup,
  LocatedGuard,
  LocatedRejection,
  LocatedStandardRejection,
} from '../validation/located.ts';
export type { LocatedNode } from '../validation/schemas.ts';
export type { ResolvedStandard } from '../validation/standard-codes.ts';
export type { ValidatedContract, ValidatedSchemas } from '../validation/validate.ts';
export { validateContract } from '../validation/validate.ts';
export type {
  ValidatedCode,
  ValidatedDeclarations,
  ValidatedGuard,
} from '../validation/validated.ts';
export type { Field, NotAllowed, Origin, Path, SchemaNode } from '../walker/nodes.ts';
export type { OriginOf, WalkedLocation, WalkedSchemas } from '../walker/walk.ts';
export { walkSchemas } from '../walker/walk.ts';
export type { LocatedSchema } from '../walker/walked.ts';

/** The `kind` every declaration carries, which tells them apart at runtime. */
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
