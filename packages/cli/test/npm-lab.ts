import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as baseTest } from 'vitest';
import type { NpmPlace } from '../src/internal/index.ts';
import { aDeadAddress, type DeadAddress } from './dead-address.ts';
import { type Address, aRegistry, type Registry, type RegistryOptions } from './fake-registry.ts';
import {
  anNpmEnvironment,
  aPlaceIn,
  type EnvironmentOptions,
  type NpmEnvironment,
  type PlaceOptions,
} from './npm-environment.ts';

export type Lab = {
  readonly aRegistry: (options?: RegistryOptions) => Promise<Registry>;
  readonly aDeadAddress: () => Promise<Address>;
  readonly aPlace: (options: PlaceOptions) => NpmPlace;
  readonly anNpmEnvironment: (options?: EnvironmentOptions) => NpmEnvironment;
  readonly aFolder: () => string;
};

/** What a lab made, to be gone when its test ends. */
type Made = {
  readonly registries: Registry[];
  readonly addresses: DeadAddress[];
  readonly folders: string[];
};

function aLab(): Lab & { readonly dispose: () => Promise<void> } {
  const made: Made = { registries: [], addresses: [], folders: [] };
  const aFolder = () => {
    const folder = mkdtempSync(join(tmpdir(), 'cf-loom-registry-test-'));
    made.folders.push(folder);
    return folder;
  };
  return {
    aRegistry: async (options) => {
      const registry = await aRegistry(options);
      made.registries.push(registry);
      return registry;
    },
    aDeadAddress: async () => {
      const address = await aDeadAddress();
      made.addresses.push(address);
      return address;
    },
    aPlace: (options) => aPlaceIn(aFolder(), options),
    anNpmEnvironment: (options = {}) => anNpmEnvironment(aFolder(), options),
    aFolder,
    dispose: () => disposed(made),
  };
}

async function disposed({ registries, addresses, folders }: Made): Promise<void> {
  await Promise.all(registries.map((registry) => registry.close()));
  for (const address of addresses) {
    address.release();
  }
  for (const folder of folders) {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** Vitest's `test` with a `lab` fixture: its registries, addresses and folders are gone when the test ends. */
export const test = baseTest.extend<{ lab: Lab }>({
  // biome-ignore lint/correctness/noEmptyPattern: vitest reads what a fixture needs from this pattern
  lab: async ({}, use) => {
    const lab = aLab();
    await use(lab);
    await lab.dispose();
  },
});
