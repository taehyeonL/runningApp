import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

type AuthStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

type SecureValueMetadata = {
  version: 1;
  generation: string;
  chunks: number;
};

// SecureStore values can have platform-specific size limits. Splitting the
// serialized Supabase session also leaves room for providers with larger JWTs.
const CHUNK_SIZE = 1800;
const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};
const memoryFallback = new Map<string, string>();

function normalizeKey(key: string) {
  return `runningmate.${key.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

function metadataKey(key: string) {
  return `${normalizeKey(key)}.meta`;
}

function chunkKey(key: string, generation: string, index: number) {
  return `${normalizeKey(key)}.${generation}.${index}`;
}

function parseMetadata(value: string | null): SecureValueMetadata | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<SecureValueMetadata>;
    if (
      parsed.version === 1
      && typeof parsed.generation === 'string'
      && Number.isInteger(parsed.chunks)
      && (parsed.chunks ?? 0) > 0
    ) {
      return parsed as SecureValueMetadata;
    }
  } catch {
    // Corrupt metadata is treated as a signed-out local state.
  }

  return null;
}

async function deleteGeneration(key: string, metadata: SecureValueMetadata | null) {
  if (!metadata) return;

  await Promise.all(
    Array.from({ length: metadata.chunks }, (_, index) =>
      SecureStore.deleteItemAsync(
        chunkKey(key, metadata.generation, index),
        secureStoreOptions,
      ).catch(() => undefined),
    ),
  );
}

const nativeStorage: AuthStorage = {
  async getItem(key) {
    if (!(await SecureStore.isAvailableAsync())) {
      return memoryFallback.get(key) ?? null;
    }

    const metadata = parseMetadata(
      await SecureStore.getItemAsync(metadataKey(key), secureStoreOptions),
    );
    if (!metadata) return null;

    const chunks = await Promise.all(
      Array.from({ length: metadata.chunks }, (_, index) =>
        SecureStore.getItemAsync(
          chunkKey(key, metadata.generation, index),
          secureStoreOptions,
        ),
      ),
    );
    if (chunks.some((chunk) => chunk === null)) return null;
    return chunks.join('');
  },

  async setItem(key, value) {
    if (!(await SecureStore.isAvailableAsync())) {
      memoryFallback.set(key, value);
      return;
    }

    const oldMetadata = parseMetadata(
      await SecureStore.getItemAsync(metadataKey(key), secureStoreOptions),
    );
    const generation = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const chunks = value.match(new RegExp(`.{1,${CHUNK_SIZE}}`, 'gs')) ?? [''];
    const newMetadata: SecureValueMetadata = {
      version: 1,
      generation,
      chunks: chunks.length,
    };

    // Publish metadata only after every new chunk exists. If the app is killed
    // mid-write, the previous generation remains readable.
    await Promise.all(
      chunks.map((chunk, index) =>
        SecureStore.setItemAsync(
          chunkKey(key, generation, index),
          chunk,
          secureStoreOptions,
        ),
      ),
    );
    await SecureStore.setItemAsync(
      metadataKey(key),
      JSON.stringify(newMetadata),
      secureStoreOptions,
    );
    await deleteGeneration(key, oldMetadata);
  },

  async removeItem(key) {
    memoryFallback.delete(key);
    if (!(await SecureStore.isAvailableAsync())) return;

    const metadata = parseMetadata(
      await SecureStore.getItemAsync(metadataKey(key), secureStoreOptions),
    );
    await SecureStore.deleteItemAsync(metadataKey(key), secureStoreOptions);
    await deleteGeneration(key, metadata);
  },
};

const webStorage: AuthStorage = {
  async getItem(key) {
    try {
      const storage = globalThis.localStorage;
      return storage ? storage.getItem(key) : memoryFallback.get(key) ?? null;
    } catch {
      return memoryFallback.get(key) ?? null;
    }
  },
  async setItem(key, value) {
    try {
      const storage = globalThis.localStorage;
      if (storage) storage.setItem(key, value);
      else memoryFallback.set(key, value);
    } catch {
      memoryFallback.set(key, value);
    }
  },
  async removeItem(key) {
    try {
      globalThis.localStorage?.removeItem(key);
    } finally {
      memoryFallback.delete(key);
    }
  },
};

export const authStorage: AuthStorage = Platform.OS === 'web' ? webStorage : nativeStorage;
