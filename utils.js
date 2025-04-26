// utils.js
import path from 'path';

/**
 * Recursively creates a new object/array mirroring the input structure,
 * replacing only string values with empty strings ("").
 * Keeps numbers, booleans, null, and undefined as they are.
 *
 * @param {any} value - The value to process (object, array, string, number, etc.)
 * @returns {any} - The new structure with strings replaced.
 */
export function createEmptyStructure(value) {
    if (Array.isArray(value)) {
        // If it's an array, map over its elements and process each recursively
        return value.map(element => createEmptyStructure(element));
    } else if (typeof value === 'object' && value !== null) {
        // If it's an object, create a new object and process each property recursively
        const newObj = {};
        for (const key in value) {
            // Ensure it's an own property, not from the prototype chain
            if (Object.prototype.hasOwnProperty.call(value, key)) {
                newObj[key] = createEmptyStructure(value[key]);
            }
        }
        return newObj;
    } else if (typeof value === 'string') {
        // If it's a string, return an empty string
        return "";
    } else {
        // Otherwise (number, boolean, null, undefined), return the value as is
        return value;
    }
}

/**
 * Generates a conventional variable name for imports.
 * Example: ('fr', 'hero.json') => 'frHero'
 * @param {string} lang Language code
 * @param {string} filename Filename
 * @returns {string} Import variable name
 */
export function generateImportName(lang, filename) {
    const name = path.basename(filename, '.json');
    // Ensure the name starts with a letter, prefix if needed
    const baseName = /^[a-zA-Z]/.test(name) ? name : `_${name}`;
    // Capitalize the first letter of the base name
    const capitalizedBaseName = baseName.charAt(0).toUpperCase() + baseName.slice(1);
    return `${lang}${capitalizedBaseName}`;
}

/**
 * Ensures path uses forward slashes, necessary for JS imports
 * @param {string} filePath
 * @returns {string} Path with forward slashes
 */
export function normalizeImportPath(filePath) {
    return filePath.replace(/\\/g, '/');
}

/**
 * Recursively synchronizes the structure of the targetNode to match the sourceNode.
 * - Adds missing keys/elements using createEmptyStructure.
 * - Removes keys/elements from targetNode that are no longer in sourceNode.
 * - If data types for a key mismatch, replaces the target branch with createEmptyStructure(sourceNode).
 * - Keeps existing primitive values in targetNode if the key/structure matches.
 * - Returns information about structural changes made.
 * (This version does NOT handle translation, only structure).
 *
 * @param {any} sourceNode - The corresponding node from the source JSON.
 * @param {any} targetNode - The corresponding node from the target JSON.
 * @param {string} path - Current path for logging (e.g., 'root.key1.list[0]')
 * @returns {{ updatedNode: any, changesMade: boolean }} - The synchronized target node and a flag.
 */
export function syncStructure(sourceNode, targetNode, path = 'root') {
    let changesMade = false;

    const sourceType = Array.isArray(sourceNode) ? 'array' : (sourceNode === null ? 'null' : typeof sourceNode);
    const targetType = Array.isArray(targetNode) ? 'array' : (targetNode === null ? 'null' : typeof targetNode);

    // --- Type Mismatch Handling ---
    if (sourceType !== targetType) {
        const isMajorMismatch = (sourceType === 'object' || sourceType === 'array' || targetType === 'object' || targetType === 'array');
        if (isMajorMismatch) {
            console.warn(`    ⚠️ Structural mismatch at '${path}'. Type changed from '${targetType}' to '${sourceType}'. Replacing target branch with empty structure.`);
            // Replace with empty structure only
            return { updatedNode: createEmptyStructure(sourceNode), changesMade: true };
        }
        // Keep target primitive if only primitive types changed (e.g., string -> number)
        return { updatedNode: targetNode, changesMade: false };
    }

    // --- Array Synchronization ---
    if (sourceType === 'array') {
        const newTargetArray = [];
        let arrayChanges = false;
        const sourceLength = sourceNode.length;
        const targetLength = targetNode.length;
        const maxLength = Math.max(sourceLength, targetLength);

        for (let i = 0; i < maxLength; i++) {
            const currentPath = `${path}[${i}]`;
            const sourceElement = sourceNode[i];
            const targetElement = targetNode[i];

            if (i < sourceLength && i < targetLength) {
                // Element exists in both: recurse
                const result = syncStructure(sourceElement, targetElement, currentPath); // Recursive call
                newTargetArray.push(result.updatedNode);
                if (result.changesMade) arrayChanges = true;
            } else if (i < sourceLength) {
                // Element only in source (added): add empty structure
                console.log(`    ➕ Added structure at '${currentPath}'`);
                newTargetArray.push(createEmptyStructure(sourceElement)); // Just empty structure
                arrayChanges = true;
            } else if (i < targetLength) {
                // Element only in target (deleted from source): log removal
                console.log(`    ➖ Removed structure at '${currentPath}'`);
                // Do not push to newTargetArray, effectively removing it
                arrayChanges = true;
            }
        }
        changesMade = arrayChanges;
        return { updatedNode: newTargetArray, changesMade };
    }
    // --- Object Synchronization ---
    else if (sourceType === 'object') {
        let objectChanges = false;
        const newTargetObject = { ...targetNode }; // Shallow copy to modify

        // Check for added/modified keys (iterate source)
        for (const key in sourceNode) {
            if (Object.prototype.hasOwnProperty.call(sourceNode, key)) {
                const currentPath = `${path}.${key}`;
                if (Object.prototype.hasOwnProperty.call(newTargetObject, key)) {
                    // Key exists in both: recurse
                    const result = syncStructure(sourceNode[key], newTargetObject[key], currentPath); // Recursive call
                    if (result.changesMade) {
                        newTargetObject[key] = result.updatedNode;
                        objectChanges = true;
                    }
                } else {
                    // Key only in source (added): add empty structure
                    console.log(`    ➕ Added key: '${currentPath}'`);
                    newTargetObject[key] = createEmptyStructure(sourceNode[key]); // Just empty structure
                    objectChanges = true;
                    // NOTE: If needed later for targeted translation on sync,
                    // could collect info about added keys here:
                    // addedNodesInfo.push({ path: currentPath, sourceValue: sourceNode[key] });
                }
            }
        }

        // Check for deleted keys (iterate target's original keys to compare against source)
        for (const key in targetNode) {
            if (Object.prototype.hasOwnProperty.call(targetNode, key)) {
                const currentPath = `${path}.${key}`;
                // If key existed in original target but not in source, delete from new target
                if (!Object.prototype.hasOwnProperty.call(sourceNode, key)) {
                    console.log(`    ➖ Removed key: '${currentPath}'`);
                    delete newTargetObject[key]; // Delete from the copy
                    objectChanges = true;
                }
            }
        }
        changesMade = objectChanges;
        return { updatedNode: newTargetObject, changesMade };
    }
    // --- Primitive Synchronization ---
    else {
        // Primitives match type: keep target value, no structural change.
        return { updatedNode: targetNode, changesMade: false };
    }
}

// Simple error class (optional, can be removed if not used)
export class AppError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'AppError';
        this.code = code; // e.g., 'ENOENT', 'JSON_PARSE'
    }
}