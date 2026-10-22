import { lineOf } from '../loading/index.ts';
import { type Failed, failed, jsonFromNpm, type NpmPlace, textFromNpm } from './npm.ts';

const registrySetting = 'npm_config_registry';
const credentialsInUrl =
  'npm will not print a registry URL that holds credentials: put them in a //host/:_authToken or //host/:_auth line instead of in the registry URL';

/** A package the registry npm reads for its scope does not know, found with the user npm logs in as there. */
export type UnknownPackage = {
  readonly kind: 'unknown-package';
  readonly registry: string;
  readonly username: string;
};

type Registry = { readonly kind: 'registry'; readonly registry: string };

type Unset = { readonly kind: 'unset' };

type Login =
  | { readonly kind: 'user'; readonly username: string }
  | { readonly kind: 'refused'; readonly why: string };

/**
 * Settles what npm's 404 for a package means: a package never published only when npm has a login
 * on the registry that serves the scope; without one, a package the login cannot read looks the
 * same, so the read fails.
 */
export async function unknownPackageOf(
  npm: NpmPlace,
  packageName: string,
  scope: string,
): Promise<UnknownPackage | Failed> {
  const served = await registryOf(npm, scope);
  if (served.kind === 'failed') {
    return served;
  }
  const login = await loginOn(npm, served.registry);
  const registry = lineOf(served.registry);
  if (login.kind === 'refused') {
    const refusal = `npm has no login there it accepts (${login.why})`;
    const looksUnpublished = 'a package your login cannot read looks unpublished';
    return failed(`${packageName} is not in ${registry}, and ${refusal}: ${looksUnpublished}`);
  }
  return { kind: 'unknown-package', registry, username: login.username };
}

/** The scope's own registry, or else the default one; each asked alone, since npm refuses one that holds credentials. */
async function registryOf(npm: NpmPlace, scope: string): Promise<Registry | Failed> {
  const scoped = await registryAt(npm, `${scope}:registry`);
  if (scoped.kind !== 'unset') {
    return scoped;
  }
  const standard = await registryAt(npm, 'registry');
  return standard.kind === 'unset'
    ? failed(`npm did not say which registry serves ${scope}`)
    : standard;
}

async function registryAt(npm: NpmPlace, key: string): Promise<Registry | Unset | Failed> {
  const call = { label: `npm config get ${key}`, args: ['config', 'get', key] };
  const run = await textFromNpm(npm, call);
  if (run.kind === 'failed') {
    return isProtected(run.message) ? failed(`${call.label} failed: ${credentialsInUrl}`) : run;
  }
  const registry = run.text.trim();
  return registry === '' || registry === 'undefined'
    ? { kind: 'unset' }
    : { kind: 'registry', registry };
}

function isProtected(npmFailure: string): boolean {
  return npmFailure.includes('is protected');
}

async function loginOn(npm: NpmPlace, registry: string): Promise<Login> {
  const call = { label: 'npm whoami', args: ['whoami'], env: { [registrySetting]: registry } };
  const run = await jsonFromNpm(npm, call);
  switch (run.kind) {
    case 'json': {
      const username = typeof run.value === 'string' ? lineOf(run.value) : '';
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
