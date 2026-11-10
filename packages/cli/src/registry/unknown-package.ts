import { type Failed, failed, lineOf } from '../child-process/index.ts';
import { jsonFromNpm, type NpmPlace, userName } from './npm.ts';
import { viewLabelOf } from './package-versions.ts';

const registrySetting = 'npm_config_registry';
const getMarker = ' - GET ';
const passwordRedacted = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*:\*\*\*@/i;
const credentialsInUrl =
  'npm redacts a registry URL that holds credentials: put them in a //host/:_authToken or //host/:_auth line instead of in the registry URL';

/** A package the registry npm reads it from does not know, found with the user npm logs in as there. */
export type UnknownPackage = {
  readonly kind: 'unknown-package';
  readonly registry: string;
  readonly username: string;
};

type Named = { readonly kind: 'registry'; readonly registry: string } | Failed;

type Login =
  | { readonly kind: 'user'; readonly username: string }
  | { readonly kind: 'refused'; readonly why: string };

/**
 * Settles what npm's 404 for a package means: a package never published only when npm has a login
 * on the registry that answered the 404, which the 404 names; without one, a package the login
 * cannot read looks the same, so the read fails.
 */
export async function unknownPackageOf(
  npm: NpmPlace,
  packageName: string,
  notFound: string,
): Promise<UnknownPackage | Failed> {
  const named = registryNamedBy(packageName, notFound);
  if (named.kind === 'failed') {
    return named;
  }
  const login = await loginOn(npm, named.registry);
  const registry = lineOf(named.registry);
  if (login.kind === 'refused') {
    const refusal = `npm has no login there it accepts (${login.why})`;
    const looksUnpublished = 'a package your login cannot read looks unpublished';
    return failed(`${packageName} is not in ${registry}, and ${refusal}: ${looksUnpublished}`);
  }
  return { kind: 'unknown-package', registry, username: login.username };
}

/**
 * The registry whose URL follows the first ` - GET ` of npm's 404 summary: the URL without its
 * last path segment, which must be the package's name. A URL npm redacted names no registry that
 * `npm whoami` can be pointed at.
 */
function registryNamedBy(packageName: string, notFound: string): Named {
  const label = viewLabelOf(packageName);
  const url = urlAfterGet(notFound);
  if (url !== undefined && passwordRedacted.test(url)) {
    return failed(`${label} failed: ${credentialsInUrl}`);
  }
  const registry = url === undefined ? undefined : registryOfUrl(url, packageName);
  return registry === undefined
    ? failed(`${label}'s 404 names no registry: ${lineOf(notFound)}`)
    : { kind: 'registry', registry };
}

function urlAfterGet(notFound: string): string | undefined {
  const start = notFound.indexOf(getMarker);
  if (start === -1) {
    return undefined;
  }
  const url = notFound.slice(start + getMarker.length);
  const end = url.search(/\s/);
  return end === -1 ? url : url.slice(0, end);
}

function registryOfUrl(url: string, packageName: string): string | undefined {
  const cut = url.lastIndexOf('/') + 1;
  return decodedOf(url.slice(cut)) === packageName ? url.slice(0, cut) : undefined;
}

function decodedOf(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

async function loginOn(npm: NpmPlace, registry: string): Promise<Login> {
  const call = { label: 'npm whoami', args: ['whoami'], env: { [registrySetting]: registry } };
  const run = await jsonFromNpm(npm, call, userName);
  switch (run.kind) {
    case 'json': {
      const username = lineOf(run.value);
      return username === ''
        ? { kind: 'refused', why: 'npm whoami printed no user name' }
        : { kind: 'user', username };
    }
    case 'refused':
      return { kind: 'refused', why: `${run.code}: ${run.summary}` };
    case 'failed':
      return { kind: 'refused', why: run.message };
  }
}
