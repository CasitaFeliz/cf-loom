import type { ContractDirectory, Listed } from './contract-directory.ts';

const npmjs = 'https://registry.npmjs.org';
const ansiSequence = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');

/** Which npm organization `npm()` lists, with what token, and on which registry. */
export type NpmOptions = {
  /** The organization, lower-case and without `@`; its packages are `@<org>/<name>`. */
  readonly org: string;
  /**
   * A read-only access token of a member who can read every package of the scope, since npm
   * leaves restricted packages out of the listing without one; its surrounding whitespace is
   * ignored, and `undefined` or a blank token fails the listing.
   */
  readonly token: string | undefined;
  /**
   * The registry that serves npm's organization listing: `https://registry.npmjs.org` unless set;
   * only its origin and path are used, not its user, password, query or fragment.
   */
  readonly registry?: string;
};

type Reading = {
  readonly org: string;
  readonly registry: string;
  readonly token: string;
};

type Answered = {
  readonly kind: 'answered';
  readonly status: number;
  readonly statusText: string;
  readonly body: string;
};

type Answer = Answered | { readonly kind: 'unreachable'; readonly cause: string };

/**
 * A Contract directory that lists an npm organization's packages in its scope, read afresh from
 * the registry's organization listing on each `list`; any error fails the listing.
 */
export function npm({ org, token, registry = npmjs }: NpmOptions): ContractDirectory {
  return { list: () => listOrganization(org, token, registry) };
}

async function listOrganization(
  org: string,
  token: string | undefined,
  registry: string,
): Promise<Listed> {
  if (typeof org !== 'string' || !org.isWellFormed()) {
    return failed('npm({ org }) has an organization that cannot be put in a URL');
  }
  const secret = typeof token === 'string' ? token.trim() : '';
  if (oneLine(secret) === '') {
    return failed(
      `npm({ org: '${org}' }) has no token, and npm lists only public packages without one`,
    );
  }
  const base = baseOf(registry);
  if (base === undefined) {
    return failed(`npm({ org: '${org}' }) has a registry that is no http or https URL`);
  }
  const reading = { org, registry: base, token: secret };
  const answer = await ask(reading);
  switch (answer.kind) {
    case 'unreachable':
      return failedWithoutToken(reading, `${base} cannot be reached: ${answer.cause}`);
    case 'answered':
      return listedFrom(reading, answer);
  }
}

function baseOf(registry: string): string | undefined {
  const url = URL.parse(registry);
  if (url === null || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    return undefined;
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

async function ask(reading: Reading): Promise<Answer> {
  const url = `${reading.registry}/-/org/${encodeURIComponent(reading.org)}/package`;
  const headers = { accept: 'application/json', authorization: `Bearer ${reading.token}` };
  try {
    const response = await fetch(url, { headers, redirect: 'manual' });
    const body = await response.text();
    return { kind: 'answered', status: response.status, statusText: response.statusText, body };
  } catch (error) {
    return { kind: 'unreachable', cause: causeOf(error) };
  }
}

function causeOf(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  if (!(error.cause instanceof Error)) {
    return error.message;
  }
  const code = 'code' in error.cause ? String(error.cause.code) : '';
  return error.cause.message || code || error.message;
}

function listedFrom(reading: Reading, answer: Answered): Listed {
  const { status } = answer;
  const about = `listing the packages of the npm organization ${reading.org}`;
  if (status === 200) {
    return namesIn(reading, answer.body);
  }
  if (status >= 300 && status < 400) {
    const refusal = 'redirects are refused so the token stays with the registry';
    return failedWithoutToken(
      reading,
      `${reading.registry} answered with a redirect ${about}; ${refusal}`,
    );
  }
  const reason = errorOf(answer.body) || answer.statusText || 'no reason given';
  return failedWithoutToken(reading, `${reading.registry} answered ${status} ${about}: ${reason}`);
}

function namesIn(reading: Reading, body: string): Listed {
  const packages = parseJson(body);
  if (!isNameMap(packages)) {
    const message = `${reading.registry} answered the npm organization ${reading.org} with no map of package names`;
    return failedWithoutToken(reading, message);
  }
  const scope = `@${reading.org}/`;
  const names = Object.keys(packages).filter((name) => name.startsWith(scope));
  return { kind: 'listed', names };
}

function isNameMap(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((access) => typeof access === 'string');
}

function errorOf(body: string): string | undefined {
  const parsed = parseJson(body);
  if (typeof parsed !== 'object' || parsed === null || !('error' in parsed)) {
    return undefined;
  }
  return typeof parsed.error === 'string' ? parsed.error : undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function failedWithoutToken(reading: Reading, message: string): Listed {
  return failed(oneLine(message).replaceAll(oneLine(reading.token), '<token>'));
}

function failed(message: string): Listed {
  return { kind: 'failed', message: oneLine(message) };
}

function oneLine(text: string): string {
  return text
    .replaceAll(ansiSequence, '')
    .replace(/\s+/g, ' ')
    .replace(/\p{Cc}/gu, '')
    .trim();
}
