import { type Failed, failed, jsonFromNpm, lineOf, type NpmPlace, textFromNpm } from './npm.ts';

const registrySetting = 'npm_config_registry';

/** A package the registry npm reads for its scope does not know, found with the user npm logs in as there. */
export type UnknownPackage = {
  readonly kind: 'unknown-package';
  readonly registry: string;
  readonly username: string;
};

type Registry = { readonly kind: 'registry'; readonly registry: string };

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
): Promise<{ kind: 'no-baseline'; packageName: string; why: UnknownPackage } | Failed> {
  const served = await registryOf(npm, scope);
  if (served.kind === 'failed') {
    return served;
  }
  const { registry } = served;
  const login = await loginOn(npm, registry);
  if (login.kind === 'refused') {
    const refusal = `npm has no login there it accepts (${login.why})`;
    const looksUnpublished = 'a package your login cannot read looks unpublished';
    return failed(`${packageName} is not in ${registry}, and ${refusal}: ${looksUnpublished}`);
  }
  const why = { kind: 'unknown-package', registry, username: login.username } as const;
  return { kind: 'no-baseline', packageName, why };
}

async function registryOf(npm: NpmPlace, scope: string): Promise<Registry | Failed> {
  const key = `${scope}:registry`;
  const call = { label: `npm config get ${key}`, args: ['config', 'get', key, 'registry'] };
  const run = await textFromNpm(npm, call);
  if (run.kind === 'failed') {
    return run;
  }
  const lines = run.text.split('\n');
  const scoped = settingOf(lines, key);
  const registry =
    scoped === undefined || scoped === 'undefined' ? settingOf(lines, 'registry') : scoped;
  if (registry === undefined || registry === '' || registry === 'undefined') {
    return failed(`npm did not say which registry serves ${scope}`);
  }
  return { kind: 'registry', registry: lineOf(registry) };
}

function settingOf(lines: readonly string[], key: string): string | undefined {
  const line = lines.find((candidate) => candidate.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim();
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
