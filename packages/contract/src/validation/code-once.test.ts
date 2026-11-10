import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { summarized, summaryOf } from '../../test/failures.ts';
import { anInstalledPackage, aRootPackage } from '../../test/root-package.ts';
import {
  type Definitions,
  defineDefinitions,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  defineService,
  type Guard,
  notFound,
  type Rejection,
  type StandardRejection,
} from '../index.ts';
import {
  type ResolvedDefinitions,
  type Root,
  snapshotOf,
  validateRoot,
} from '../internal/index.ts';

/** A Service whose Endpoint `i` attaches `guards[i]` and lists `rejections[i]`, one Endpoint per entry. */
function aService(
  endpoints: readonly {
    readonly guards?: readonly Guard[];
    readonly rejections?: readonly (Rejection | StandardRejection)[];
  }[],
  standardRejections?: Definitions,
) {
  const declared = endpoints.map(({ guards = [], rejections = [] }, index) =>
    defineEndpoint({
      name: `ping${index}`,
      method: 'GET',
      path: `/ping${index}`,
      visibility: 'public',
      description: 'Ping',
      guards: [...guards],
      success: { status: 200, body: z.object({ ok: z.boolean() }) },
      rejections: [...rejections] as never,
    }),
  );
  const group = defineGroup({ name: 'ping', description: 'Ping', endpoints: declared as never });
  return defineService({
    name: 'ping-service',
    groups: [group],
    ...(standardRejections === undefined ? {} : { standardRejections }),
  });
}

function failuresOf(root: Root, packages: readonly ResolvedDefinitions[] = []) {
  const validated = validateRoot(root, aRootPackage(root, { packages }));
  return validated.kind === 'invalid' ? validated.failures.map(summaryOf) : [];
}

function codeOnce(code: string, sources: string, location = `codes.${code}`) {
  return {
    kind: 'declaration',
    location,
    rule: 'code-once',
    message: `A code is declared once: ${code} (${sources})`,
  };
}

const locked = (message: string) => defineRejection({ code: 'LOCKED', status: 409, message });

describe('validateRoot: a code is declared once', () => {
  test.each([
    ['identical', locked('Locked'), locked('Locked')],
    ['with another message', locked('Locked'), locked('Other')],
    [
      'with another status',
      locked('Locked'),
      defineRejection({ code: 'LOCKED', status: 410, message: 'Gone' }),
    ],
    [
      'with a body',
      locked('Locked'),
      defineRejection({
        code: 'LOCKED',
        status: 409,
        message: 'Locked',
        body: z.object({ at: z.string() }),
      }),
    ],
  ])('two Rejections with one code, %s, fail code-once', (_, first, second) => {
    const root = aService([{ rejections: [first] }, { rejections: [second] }]);

    expect(failuresOf(root)).toEqual([codeOnce('LOCKED', 'the Contract twice')]);
  });

  test('one Rejection an Endpoint and its Guard both list is one declaration', () => {
    const rejection = locked('Locked');
    const guard = defineGuard({ name: 'gate', description: 'A gate', rejections: [rejection] });

    expect(failuresOf(aService([{ guards: [guard], rejections: [rejection] }]))).toEqual([]);
  });

  test('one Rejection two Definitions Packages export, one re-exporting the other’s, is one declaration', () => {
    const rejection = locked('Locked');
    const p2 = anInstalledPackage(
      defineDefinitions({}),
      { rejection },
      { packageName: '@p2/defs' },
    );
    const p1 = anInstalledPackage(
      defineDefinitions({}),
      { rejection },
      { packageName: '@p1/defs', reaches: [p2] },
    );

    expect(failuresOf(aService([{ rejections: [rejection] }]), [p1, p2])).toEqual([]);
  });

  test('a code two Definitions Packages declare, both reached, fails code-once naming both origins', () => {
    const auth = defineRejection({ code: 'FORBIDDEN', status: 403, message: 'Not allowed' });
    const billing = defineRejection({
      code: 'FORBIDDEN',
      status: 403,
      message: 'Forbidden by billing',
    });
    const authGuard = defineGuard({ name: 'auth', description: 'Auth', rejections: [auth] });
    const billingGuard = defineGuard({
      name: 'billing',
      description: 'Billing',
      rejections: [billing],
    });
    const packages = [
      anInstalledPackage(
        defineDefinitions({}),
        { authGuard, auth },
        { packageName: '@org/auth-definitions', version: '1.0.0' },
      ),
      anInstalledPackage(
        defineDefinitions({}),
        { billingGuard, billing },
        { packageName: '@org/billing-definitions', version: '2.1.0' },
      ),
    ];

    const failures = failuresOf(aService([{ guards: [authGuard, billingGuard] }]), packages);

    expect(failures).toEqual([
      codeOnce('FORBIDDEN', '@org/auth-definitions@1.0.0 and @org/billing-definitions@2.1.0'),
    ]);
  });

  test('a Rejection a used package exports and nothing reaches does not count against the Contract’s code', () => {
    const theirs = locked('Theirs');
    const ours = locked('Ours');
    const guard = defineGuard({ name: 'gate', description: 'A gate' });
    const definitions = defineDefinitions({});
    const packages = [anInstalledPackage(definitions, { guard, theirs })];

    expect(failuresOf(aService([{ guards: [guard], rejections: [ours] }]), packages)).toEqual([]);
    expect(failuresOf(definitions, [])).toEqual([]);
  });

  test.each([
    ['cf-loom’s default code', undefined, 'NOT_FOUND'],
    [
      'the code its standardRejections package declares',
      defineDefinitions({
        standardRejections: { notFound: { code: 'MISSING', status: 404, message: 'Missing' } },
      }),
      'MISSING',
    ],
  ])(
    'a declared Rejection with %s of a Standard Rejection fails code-once naming it',
    (_, definitions, code) => {
      const declared = defineRejection({ code, status: 404, message: 'Ours' });
      const packages = definitions === undefined ? [] : [anInstalledPackage(definitions, {})];

      const failures = failuresOf(aService([{ rejections: [declared] }], definitions), packages);

      expect(failures).toEqual([
        codeOnce(code, 'the Contract and the notFound Standard Rejection'),
      ]);
    },
  );

  test('a code three sources declare fails code-once naming them as a list, the last after and', () => {
    const declared = (message: string) =>
      defineRejection({ code: 'NOT_FOUND', status: 404, message });
    const installed = declared('Installed');
    const packages = [
      anInstalledPackage(
        defineDefinitions({}),
        { installed },
        {
          packageName: '@org/one',
          version: '1.0.0',
        },
      ),
    ];
    const endpoints = [declared('First'), declared('Second'), installed].map((rejection) => ({
      rejections: [rejection],
    }));

    const failures = failuresOf(aService(endpoints), packages);

    expect(failures).toEqual([
      codeOnce(
        'NOT_FOUND',
        'the Contract twice, @org/one@1.0.0 and the notFound Standard Rejection',
      ),
    ]);
  });

  test('a package whose name and version hold a comma and a closing word is one quoted item of the list', () => {
    const declared = (message: string) =>
      defineRejection({ code: 'NOT_FOUND', status: 404, message });
    const installed = declared('Installed');
    const packages = [
      anInstalledPackage(
        defineDefinitions({}),
        { installed },
        { packageName: '@org/one, @org/two', version: '1.0.0 and 2.0.0' },
      ),
    ];
    const endpoints = [declared('First'), installed].map((rejection) => ({
      rejections: [rejection],
    }));

    const failures = failuresOf(aService(endpoints), packages);

    expect(failures).toEqual([
      codeOnce(
        'NOT_FOUND',
        'the Contract, "@org/one, @org/two@1.0.0 and 2.0.0" and the notFound Standard Rejection',
      ),
    ]);
  });

  test('a source that declared a code three times is written with its count after it', () => {
    const declared = (message: string) => defineRejection({ code: 'LOCKED', status: 409, message });
    const endpoints = ['One', 'Two', 'Three'].map((message) => ({
      rejections: [declared(message)],
    }));

    const failures = failuresOf(aService(endpoints));

    expect(failures).toEqual([codeOnce('LOCKED', 'the Contract 3 times')]);
  });

  test('two Standard Rejections resolving to one code fail code-once', () => {
    const definitions = defineDefinitions({
      standardRejections: {
        invalidInput: { code: 'BAD', status: 400, message: 'Bad' },
        notFound: { code: 'BAD', status: 404, message: 'Not here' },
      },
    });

    const failures = failuresOf(aService([{ rejections: [notFound] }], definitions), [
      anInstalledPackage(definitions, {}),
    ]);

    expect(failures).toEqual([
      codeOnce(
        'BAD',
        'the invalidInput Standard Rejection and the notFound Standard Rejection',
        'standardRejections.invalidInput',
      ),
    ]);
  });

  test('a Definitions Package exporting two Rejections with one code fails code-once', () => {
    const root = defineDefinitions({});
    const rootExports = { first: locked('One'), second: locked('Two') };

    const validated = summarized(validateRoot(root, aRootPackage(root, { rootExports })));

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [codeOnce('LOCKED', 'the Definitions Package twice')],
    });
  });

  test('two installed copies of one Definitions Package whose reached Guards answer one code fail naming both versions', () => {
    const older = locked('Old');
    const newer = locked('New');
    const oldGuard = defineGuard({ name: 'old', description: 'Old', rejections: [older] });
    const newGuard = defineGuard({ name: 'fresh', description: 'New', rejections: [newer] });
    const packages = [
      anInstalledPackage(defineDefinitions({}), { oldGuard, older }, { version: '1.0.0' }),
      anInstalledPackage(defineDefinitions({}), { newGuard, newer }, { version: '2.0.0' }),
    ];

    const failures = failuresOf(aService([{ guards: [oldGuard, newGuard] }]), packages);

    expect(failures).toEqual([
      codeOnce('LOCKED', '@org/definitions@1.0.0 and @org/definitions@2.0.0'),
    ]);
  });
});

/** A source a code may be declared by in the exhaustive table. */
type Source = 'contract' | 'package' | 'second-package' | 'declared-standard' | 'default-standard';

const sources: readonly Source[] = [
  'contract',
  'package',
  'second-package',
  'declared-standard',
  'default-standard',
];

/** What the line names a source as, written apart from the code. */
const sourceNames: Readonly<Record<Source, string>> = {
  contract: 'the Contract',
  package: '@org/one@1.0.0',
  'second-package': '@org/two@1.0.0',
  'declared-standard': 'the notFound Standard Rejection',
  'default-standard': 'the notFound Standard Rejection',
};

const pairs = sources.flatMap((first, index) =>
  sources
    .slice(index + 1)
    .flatMap((second) =>
      [true, false].flatMap((firstReached) =>
        [true, false].map((secondReached) => ({ first, second, firstReached, secondReached })),
      ),
    ),
);

/** What one drawn source adds to a Root: a Rejection its Endpoints list, an installed package, its Standard Rejections. */
type Added = {
  readonly listed: readonly (Rejection | StandardRejection)[];
  readonly packages: readonly ResolvedDefinitions[];
  readonly standardRejections?: Definitions;
};

function addedBy(source: Source, reached: boolean, code: string): Added {
  const rejection = defineRejection({ code, status: 404, message: source });
  switch (source) {
    case 'contract':
      return { listed: reached ? [rejection] : [], packages: [] };
    case 'package':
    case 'second-package': {
      const packageName = source === 'package' ? '@org/one' : '@org/two';
      const installed = { packageName, version: '1.0.0' };
      const packages = [anInstalledPackage(defineDefinitions({}), { rejection }, installed)];
      return { listed: reached ? [rejection] : [], packages };
    }
    case 'declared-standard': {
      if (!reached) {
        return { listed: [], packages: [] };
      }
      const declaration = { code, status: 404, message: source } as const;
      const standardRejections = defineDefinitions({
        standardRejections: { notFound: declaration },
      });
      const installed = { packageName: '@org/std', version: '1.0.0' };
      const packages = [anInstalledPackage(standardRejections, {}, installed)];
      return { listed: [], packages, standardRejections };
    }
    case 'default-standard':
      return { listed: reached ? [notFound] : [], packages: [] };
  }
}

/** A Root where `code` is declared by the sources drawn, each reached or not, with its packages. */
function rootWith(drawn: readonly { readonly source: Source; readonly reached: boolean }[]) {
  const code = drawn.some(({ source }) => source === 'default-standard') ? 'NOT_FOUND' : 'TAKEN';
  const added = drawn.map(({ source, reached }) => addedBy(source, reached, code));
  const listed = added.flatMap((each) => each.listed);
  const packages = added.flatMap((each) => each.packages);
  const standardRejections = added.find((each) => each.standardRejections)?.standardRejections;
  const endpoints = [{}, ...listed.map((rejection) => ({ rejections: [rejection] }))];
  return { root: aService(endpoints, standardRejections), packages, code };
}

describe('validateRoot and snapshotOf: a valid Root’s Snapshot says what its Endpoints answer', () => {
  test.each(pairs)(
    '$first (reached: $firstReached) and $second (reached: $secondReached)',
    ({ first, second, firstReached, secondReached }) => {
      const drawn = [
        { source: first, reached: firstReached },
        { source: second, reached: secondReached },
      ];
      const { root, packages, code } = rootWith(drawn);
      const counted = drawn.filter(
        ({ source, reached }) => reached || source === 'default-standard',
      );
      const named = counted.filter(
        ({ source }) =>
          !(
            source === 'default-standard' &&
            counted.some(({ source: other }) => other === 'declared-standard')
          ),
      );

      const validated = summarized(validateRoot(root, aRootPackage(root, { packages })));

      if (named.length > 1) {
        const line = named.map(({ source }) => sourceNames[source]).join(' and ');
        expect(validated).toEqual({ kind: 'invalid', failures: [codeOnce(code, line)] });
        return;
      }
      expect(validated.kind).toBe('valid');
      const snapshot = validated.kind === 'valid' ? snapshotOf(validated) : undefined;
      const written = snapshot?.kind === 'service' ? snapshot.codes[code] : undefined;
      const [only] = named;
      const message = only?.source === 'default-standard' ? 'Not found' : only?.source;
      expect(written?.message).toBe(message);
    },
  );
});
