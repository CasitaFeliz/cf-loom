import { type Failed, failed, lineOf } from '../child-process/index.ts';
import { jsonFromNpm, type NpmPlace, type Refused, userName } from './npm.ts';
import { viewLabelOf } from './package-versions.ts';

const registrySetting = 'npm_config_registry';
const workspacesRefusal = 'ENOWORKSPACES';
const getMarker = ' - GET ';
const redaction = '***';
const passwordRedacted = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*:\*\*\*@/i;
const looksUnpublished = 'a package your login cannot read looks unpublished';
const removeWorkspaceSetting =
  'remove it from the npm configuration the project reads, its .npmrc files or npm_config_workspace in the environment';
const credentialsInUrl =
  'npm redacts a registry URL that holds credentials: put them in a //host/:_authToken or //host/:_auth line instead of in the registry URL';

/** A package the registry npm reads it from does not know, found with the user npm logs in as there. */
export type UnknownPackage = {
  readonly kind: 'unknown-package';
  readonly registry: string;
  readonly username: string;
};

type Named = { readonly kind: 'registry'; readonly registry: string } | Failed;

type Refusal =
  | { readonly kind: 'refused'; readonly why: string }
  | { readonly kind: 'workspace-selected'; readonly why: string };

type Login = { readonly kind: 'user'; readonly username: string } | Refusal;

/**
 * Settles what npm's 404 for a package means, from the summary as npm `printed` it: a package never
 * published only when npm has a login on the registry that answered the 404, which the 404 names;
 * without one, a package the login cannot read looks the same, so the read fails.
 */
export async function unknownPackageOf(
  npm: NpmPlace,
  packageName: string,
  printed: string,
): Promise<UnknownPackage | Failed> {
  const named = registryNamedBy(packageName, printed);
  if (named.kind === 'failed') {
    return named;
  }
  const login = await loginOn(npm, named.registry);
  const registry = lineOf(named.registry);
  if (login.kind === 'user') {
    return { kind: 'unknown-package', registry, username: login.username };
  }
  return failed(`${packageName} is not in ${registry}, and ${refusalLineOf(login)}`);
}

function refusalLineOf(refusal: Refusal): string {
  switch (refusal.kind) {
    case 'refused':
      return `npm has no login there it accepts (${refusal.why}): ${looksUnpublished}`;
    case 'workspace-selected': {
      const refuses = `npm refuses npm whoami under a workspace setting (${refusal.why})`;
      return `${refuses}: ${removeWorkspaceSetting}, since without npm's login ${looksUnpublished}`;
    }
  }
}

/**
 * The registry whose URL follows the first ` - GET ` of npm's 404 summary: the URL without its
 * last path segment, which must be the package's name. A URL npm redacted names no registry that
 * `npm whoami` can be pointed at.
 */
function registryNamedBy(packageName: string, printed: string): Named {
  const label = viewLabelOf(packageName);
  const url = urlAfterGet(printed);
  if (url === undefined) {
    return namesNoRegistry(label, printed);
  }
  if (passwordRedacted.test(url)) {
    return failed(`${label} failed: ${credentialsInUrl}`);
  }
  if (url.includes(redaction)) {
    const redacted = `npm redacted part of the registry URL (${lineOf(url)})`;
    const unnamable = 'so cf-loom cannot name the registry to ask npm whoami';
    return failed(`${label} failed: ${redacted}, ${unnamable}`);
  }
  const registry = registryOfUrl(url, packageName);
  return registry === undefined ? namesNoRegistry(label, printed) : { kind: 'registry', registry };
}

function namesNoRegistry(label: string, printed: string): Failed {
  return failed(`${label}'s 404 names no registry: ${lineOf(printed)}`);
}

function urlAfterGet(printed: string): string | undefined {
  const start = printed.indexOf(getMarker);
  if (start === -1) {
    return undefined;
  }
  const url = printed.slice(start + getMarker.length);
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
      return refusedLoginOf(run);
    case 'failed':
      return { kind: 'refused', why: run.message };
  }
}

function refusedLoginOf({ code, summary }: Refused): Refusal {
  const why = `${code}: ${summary}`;
  return code === workspacesRefusal
    ? { kind: 'workspace-selected', why }
    : { kind: 'refused', why };
}
