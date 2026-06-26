import * as DocumentPicker from 'expo-document-picker';

export type FirmwareSelection = {
  path: string;
  name: string;
  size: number | null;
};

/** Strips a `file://` URI prefix so native code can open the path with ifstream. */
export function uriToFilePath(uri: string): string {
  if (uri.startsWith('file://')) {
    return decodeURIComponent(uri.replace(/^file:\/\//, ''));
  }
  return uri;
}

/** Opens the system document picker for a firmware image (.bin, etc.). */
export async function pickFirmwareFile(): Promise<FirmwareSelection | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets?.[0]) {
    return null;
  }

  const asset = result.assets[0];
  return {
    path: uriToFilePath(asset.uri),
    name: asset.name,
    size: asset.size ?? null,
  };
}
