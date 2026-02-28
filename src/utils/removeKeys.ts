/**
 * Utility for removing keys from an object based on keys present in another object.
 * Recursively removes nested keys as well.
 */

/**
 * Removes all keys from targetObject that exist in keysSourceObject.
 * Works recursively for nested objects.
 * @param targetObject - The object to remove keys from
 * @param keysSourceObject - The object whose keys should be removed from target
 * @returns A new object with specified keys removed
 */
export function removeKeys(
	targetObject: Record<string, unknown>,
	keysSourceObject: Record<string, unknown>
): Record<string, unknown> {
	const cleanedResult: Record<string, unknown> = {};

	for (const key in targetObject) {
		if (!Object.prototype.hasOwnProperty.call(targetObject, key)) {
			continue;
		}

		// If this key exists in the source, skip it (remove it)
		if (Object.prototype.hasOwnProperty.call(keysSourceObject, key)) {
			continue;
		}

		// Key doesn't exist in source, so keep it
		cleanedResult[key] = targetObject[key];
	}

	return cleanedResult;
}