/**
 * Memory export — write all stored user data to a JSON file and hand
 * off to the system share sheet.
 *
 * Spec §4: "Export produces valid, importable JSON." v1 has no import
 * flow yet, so "importable" means: the format is documented and matches
 * the persisted shape so future imports are deserialization. The
 * top-level metadata block is forward-compat for schema migrations.
 *
 * No persistence on the file system beyond a transient write to the
 * cache directory. The user's chosen destination (Files app, email,
 * AirDrop) is where the data actually ends up.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useMemoryStore } from '@/stores/memoryStore';

const EXPORT_SCHEMA_VERSION = 1;
const APP_VERSION = '1.0.0';

export async function exportMemoryToShareSheet(): Promise<void> {
  const state = useMemoryStore.getState();

  const payload = {
    metadata: {
      exported_at: new Date().toISOString(),
      app_version: APP_VERSION,
      schema_version: EXPORT_SCHEMA_VERSION,
    },
    data: {
      dietaryRestrictions: state.dietaryRestrictions,
      observations: state.observations,
      cookingHistory: state.cookingHistory,
      cookbook: state.cookbook,
      pantryItems: state.pantryItems,
      proactivityEnabled: state.proactivityEnabled,
    },
  };

  const json = JSON.stringify(payload, null, 2);

  // Write to cache (volatile); the user's share-sheet destination is
  // the real persistence path. Cache cleanup is the OS's problem.
  const path = `${FileSystem.cacheDirectory}pastaio-memory-${Date.now()}.json`;
  await FileSystem.writeAsStringAsync(path, json, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error(
      'Sharing not available on this device. File written to ' + path,
    );
  }

  await Sharing.shareAsync(path, {
    mimeType: 'application/json',
    dialogTitle: 'Export Pastaio data',
    UTI: 'public.json',
  });
}
