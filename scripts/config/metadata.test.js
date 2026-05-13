import { ARTIFACT_SCHEMA_VERSION, buildToolVersions, stampMetadata } from './metadata.js';

describe('metadata helper', () => {
  describe('ARTIFACT_SCHEMA_VERSION', () => {
    it('is a non-empty string', () => {
      expect(typeof ARTIFACT_SCHEMA_VERSION).toBe('string');
      expect(ARTIFACT_SCHEMA_VERSION.length).toBeGreaterThan(0);
    });
  });

  describe('buildToolVersions', () => {
    it('always includes node version', () => {
      const versions = buildToolVersions('/nonexistent-cwd-for-test');
      expect(versions.node).toBe(process.version);
    });

    it('returns plain object even when project.json is absent', () => {
      const versions = buildToolVersions('/nonexistent-cwd-for-test');
      expect(typeof versions).toBe('object');
      expect(versions).not.toBeNull();
    });
  });

  describe('stampMetadata', () => {
    it('adds schema_version and tool_versions to an artifact', () => {
      const artifact = { meta: { fps: 60 }, segments: [] };
      const stamped = stampMetadata(artifact, '/nonexistent-cwd-for-test');

      expect(stamped.schema_version).toBe(ARTIFACT_SCHEMA_VERSION);
      expect(typeof stamped.tool_versions).toBe('object');
      expect(stamped.tool_versions.node).toBe(process.version);
    });

    it('preserves all original artifact fields', () => {
      const artifact = { meta: { fps: 60 }, segments: [{ id: 1 }], extra: 'keep' };
      const stamped = stampMetadata(artifact, '/nonexistent-cwd-for-test');

      expect(stamped.meta).toEqual({ fps: 60 });
      expect(stamped.segments).toEqual([{ id: 1 }]);
      expect(stamped.extra).toBe('keep');
    });

    it('artifact fields take precedence over metadata keys', () => {
      // If an artifact already has schema_version, the spread preserves it
      const artifact = { schema_version: '99', segments: [] };
      const stamped = stampMetadata(artifact, '/nonexistent-cwd-for-test');

      expect(stamped.schema_version).toBe('99');
    });

    it('works with object-wrapped array artifacts', () => {
      const artifact = { turns: [{ speaker: 'A', start: 0, end: 1 }] };
      const stamped = stampMetadata(artifact, '/nonexistent-cwd-for-test');

      expect(stamped.schema_version).toBe(ARTIFACT_SCHEMA_VERSION);
      expect(stamped.turns).toEqual(artifact.turns);
    });
  });
});
