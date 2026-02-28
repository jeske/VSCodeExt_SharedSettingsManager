/**
 * Deep merge utility for recursively merging objects.
 * Source values completely overwrite target values at leaf level.
 * Arrays are replaced, not merged.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Recursively merges source object into target object.
 * @param targetObject - The base object to merge into
 * @param sourceObject - The object whose properties will overwrite target
 * @returns A new merged object
 */
export function deepMerge(
	targetObject: Record<string, unknown>,
	sourceObject: Record<string, unknown>
): Record<string, unknown> {
	const mergedResult: Record<string, unknown> = { ...targetObject };

	for (const key in sourceObject) {
		if (!Object.prototype.hasOwnProperty.call(sourceObject, key)) {
			continue;
		}

		const sourceValue = sourceObject[key];
		const targetValue = targetObject[key];

		if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
			// Both are plain objects - recurse
			mergedResult[key] = deepMerge(targetValue, sourceValue);
		} else {
			// Source overwrites target (includes arrays, primitives, null, etc.)
			mergedResult[key] = sourceValue;
		}
	}

	return mergedResult;
}