/**
 * localStorage keys, and the migration from the project's former name.
 *
 * The app was called Gesture Synth before it was called Meend. Renaming the
 * keys without moving the data would silently reset every returning player's
 * settings -- and their measured handedness, which takes two hands in frame to
 * re-learn. So the old keys are copied across once, on first load under the
 * new name.
 */

export const SETTINGS_KEY = "meend.settings";
export const HANDEDNESS_KEY = "meend.handedness";

const LEGACY_PREFIX = "gesture-synth.";

/**
 * Copy a value written under the old name to the new one, once.
 *
 * Only ever writes when the new key is absent, so a player who has since
 * changed a setting is never overwritten by a stale legacy blob. The old key
 * is left in place: harmless, and it means rolling back to a previous build
 * does not lose anything either.
 *
 * Safe in private browsing and anywhere storage is unavailable -- a failure
 * here just means the defaults apply.
 */
export function migrateLegacyKey(newKey: string): void {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    if (storage.getItem(newKey) !== null) return;

    const legacyKey = LEGACY_PREFIX + newKey.slice("meend.".length);
    const legacyValue = storage.getItem(legacyKey);
    if (legacyValue !== null) storage.setItem(newKey, legacyValue);
  } catch {
    // Storage disabled or full. Defaults apply; nothing to surface.
  }
}
