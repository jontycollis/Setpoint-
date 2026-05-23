// ── Image picker module wrapper ──────────────────────────────────────────
//
// `expo-image-picker` is a NATIVE module — it needs an APK rebuild to
// ship. The require() is wrapped in try/catch so OTA bundles on older
// APKs that don't have the module compiled in don't crash; the feature
// flag `isImagePickerAvailable()` stays false and callers fall back to
// the auto-generated avatar without a "Change image" affordance.
//
// Mirrors the pattern used by `sidelineHdCookies` for
// @react-native-cookies/cookies and `notifications` for expo-notifications.
// ──────────────────────────────────────────────────────────────────────────

export type PermissionStatus = 'granted' | 'denied' | 'undetermined';

export interface ImagePickerResult {
  /** Local file URI of the picked / captured image. */
  uri: string;
}

interface MediaTypeOptions {
  Images: unknown;
}

interface ImagePickerOptions {
  mediaTypes?: unknown;
  allowsEditing?: boolean;
  quality?: number;
  aspect?: [number, number];
}

interface RawImagePickerResponse {
  canceled?: boolean;
  assets?: Array<{ uri?: string }> | null;
}

interface RawPermissionResponse {
  granted?: boolean;
  status?: string;
}

interface ImagePickerModule {
  MediaTypeOptions?: MediaTypeOptions;
  requestMediaLibraryPermissionsAsync?: () => Promise<RawPermissionResponse>;
  requestCameraPermissionsAsync?: () => Promise<RawPermissionResponse>;
  launchImageLibraryAsync?: (
    options?: ImagePickerOptions
  ) => Promise<RawImagePickerResponse>;
  launchCameraAsync?: (
    options?: ImagePickerOptions
  ) => Promise<RawImagePickerResponse>;
}

let pickerModule: ImagePickerModule | null = null;
let loadError: string | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('expo-image-picker');
  pickerModule = (mod?.default ?? mod) as ImagePickerModule;
  if (
    typeof pickerModule?.launchImageLibraryAsync !== 'function' ||
    typeof pickerModule?.launchCameraAsync !== 'function'
  ) {
    pickerModule = null;
    loadError = 'expo-image-picker loaded but is missing required methods';
  }
} catch (err) {
  pickerModule = null;
  loadError = err instanceof Error ? err.message : String(err);
}

/**
 * True when expo-image-picker is compiled into the current APK. Returns
 * false on OTA-only builds that ran before the dep landed — callers
 * should hide the "Change image" affordance and let the auto-generated
 * avatar stand on its own.
 */
export function isImagePickerAvailable(): boolean {
  return pickerModule !== null;
}

export function getImagePickerLoadError(): string | null {
  return loadError;
}

function normalizePermission(raw: RawPermissionResponse | undefined): PermissionStatus {
  if (!raw) return 'undetermined';
  if (raw.granted) return 'granted';
  if (raw.status === 'denied') return 'denied';
  return 'undetermined';
}

function pickAssetUri(raw: RawImagePickerResponse | undefined): string | null {
  if (!raw || raw.canceled) return null;
  const first = raw.assets?.[0];
  if (first?.uri) return first.uri;
  return null;
}

const pickerOptions: ImagePickerOptions = {
  // mediaTypes defaults to "Images" in modern expo-image-picker; we set
  // it explicitly when the constant is available so older module
  // versions also limit to images.
  allowsEditing: true,
  quality: 0.8,
  aspect: [1, 1],
};

function buildOptions(): ImagePickerOptions {
  const mt = pickerModule?.MediaTypeOptions?.Images;
  return mt ? { ...pickerOptions, mediaTypes: mt } : { ...pickerOptions };
}

/**
 * Show the system photo library picker. Returns the local URI of the
 * selected image, or null if the user cancelled or the module isn't
 * available. Requests library permission first — returns null if the
 * user denies it.
 */
export async function pickFromLibrary(): Promise<ImagePickerResult | null> {
  if (!pickerModule?.launchImageLibraryAsync) return null;
  try {
    const perm = await pickerModule.requestMediaLibraryPermissionsAsync?.();
    if (normalizePermission(perm) !== 'granted') return null;
    const res = await pickerModule.launchImageLibraryAsync(buildOptions());
    const uri = pickAssetUri(res);
    return uri ? { uri } : null;
  } catch {
    return null;
  }
}

/**
 * Show the system camera. Returns the local URI of the captured image,
 * or null on cancel / missing permission / missing module.
 */
export async function takePhoto(): Promise<ImagePickerResult | null> {
  if (!pickerModule?.launchCameraAsync) return null;
  try {
    const perm = await pickerModule.requestCameraPermissionsAsync?.();
    if (normalizePermission(perm) !== 'granted') return null;
    const res = await pickerModule.launchCameraAsync(buildOptions());
    const uri = pickAssetUri(res);
    return uri ? { uri } : null;
  } catch {
    return null;
  }
}
