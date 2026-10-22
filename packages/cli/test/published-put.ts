import { Buffer } from 'node:buffer';

/** A version npm put to the registry: its package.json, the dist-tags it asked for and its tarball. */
export type Published = {
  readonly name: string;
  readonly version: string;
  readonly distTags: Readonly<Record<string, string>>;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly tarball: Buffer;
};

/** The version in the body of the `PUT` `npm publish` sends, as the registry stores it. */
export function publishedFrom(body: string): Published {
  const put = JSON.parse(body);
  const [version] = Object.keys(put.versions);
  const [attachment] = Object.values<{ readonly data: string }>(put._attachments);
  if (version === undefined || attachment === undefined) {
    throw new Error('npm put a body with no version or no tarball');
  }
  const { dist: _dist, ...manifest } = put.versions[version];
  const tarball = Buffer.from(attachment.data, 'base64');
  return { name: put.name, version, distTags: put['dist-tags'], manifest, tarball };
}
