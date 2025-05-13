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
 * Recursively synchronizes the structure of the targetNode to match the sourceNode.
 * - Adds missing keys/elements using createEmptyStructure.
 * - Removes keys/elements from targetNode that are no longer in sourceNode.
 * - If data types mismatch significantly, replaces target branch with empty structure.
 * - Keeps existing primitive values in targetNode if structure/key matches.
 * - Returns information about structural changes AND details of added nodes.
 *
 * @param {any} sourceNode - The corresponding node from the source JSON.
 * @param {any} targetNode - The corresponding node from the target JSON.
 * @param {string} currentPath - Current path for logging & reporting (e.g., 'root.key1.list[0]')
 * @param {Array<{path: string, sourceValue: any}>} addedNodesCollector - Array to collect info about added nodes.
 * @returns {{ updatedNode: any, changesMade: boolean }} - The synchronized target node and a flag.
 */
export function syncStructure(sourceNode, targetNode, currentPath = 'root', addedNodesCollector = []) {
    let changesMade = false;

    const sourceType = Array.isArray(sourceNode) ? 'array' : (sourceNode === null ? 'null' : typeof sourceNode);
    const targetType = Array.isArray(targetNode) ? 'array' : (targetNode === null ? 'null' : typeof targetNode);

    // --- Type Mismatch Handling ---
    if (sourceType !== targetType) {
        const isMajorMismatch = (sourceType === 'object' || sourceType === 'array' || targetType === 'object' || targetType === 'array');
        if (isMajorMismatch) {
            console.warn(`    ⚠️ Structural mismatch at '${currentPath}'. Type changed from '${targetType}' to '${sourceType}'. Replacing target branch with empty structure.`);
            const emptyReplacement = createEmptyStructure(sourceNode);
            // Report the entire replaced branch as 'added' for potential translation
            addedNodesCollector.push({ path: currentPath, sourceValue: sourceNode });
            return { updatedNode: emptyReplacement, changesMade: true };
        }
        return { updatedNode: targetNode, changesMade: false }; // Keep target primitive if only primitive types changed
    }

    // --- Array Synchronization ---
    if (sourceType === 'array') {
        const newTargetArray = [];
        let arrayChanges = false;
        const sourceLength = sourceNode.length;
        const targetLength = targetNode.length;
        const maxLength = Math.max(sourceLength, targetLength);

        for (let i = 0; i < maxLength; i++) {
            const elementPath = `${currentPath}[${i}]`;
            const sourceElement = sourceNode[i];
            const targetElement = targetNode[i];

            if (i < sourceLength && i < targetLength) {
                // Element exists in both: recurse
                const result = syncStructure(sourceElement, targetElement, elementPath, addedNodesCollector); // Pass collector down
                newTargetArray.push(result.updatedNode);
                if (result.changesMade) arrayChanges = true;
            } else if (i < sourceLength) {
                // Element only in source (added): add empty structure AND report addition
                console.log(`    ➕ Added structure at '${elementPath}'`);
                const emptyElement = createEmptyStructure(sourceElement);
                newTargetArray.push(emptyElement);
                addedNodesCollector.push({ path: elementPath, sourceValue: sourceElement }); // Report addition
                arrayChanges = true;
            } else if (i < targetLength) {
                // Element only in target (deleted from source): log removal
                console.log(`    ➖ Removed structure at '${elementPath}'`);
                arrayChanges = true;
            }
        }
        changesMade = arrayChanges;
        return { updatedNode: newTargetArray, changesMade };
    }
    // --- Object Synchronization ---
    else if (sourceType === 'object') {
        let objectChanges = false;
        const newTargetObject = { ...targetNode }; // Start with existing target properties

        // Check for added/modified keys (iterate source)
        for (const key in sourceNode) {
            if (Object.prototype.hasOwnProperty.call(sourceNode, key)) {
                const elementPath = `${currentPath}.${key}`;
                if (Object.prototype.hasOwnProperty.call(newTargetObject, key)) {
                    // Key exists in both: recurse
                    const result = syncStructure(sourceNode[key], newTargetObject[key], elementPath, addedNodesCollector); // Pass collector down
                    if (result.changesMade) {
                        newTargetObject[key] = result.updatedNode;
                        objectChanges = true;
                    }
                } else {
                    // Key only in source (added): add empty structure AND report addition
                    console.log(`    ➕ Added key: '${elementPath}'`);
                    const emptyValue = createEmptyStructure(sourceNode[key]);
                    newTargetObject[key] = emptyValue;
                    addedNodesCollector.push({ path: elementPath, sourceValue: sourceNode[key] }); // Report addition
                    objectChanges = true;
                }
            }
        }

        // Check for deleted keys (iterate target's original keys)
        for (const key in targetNode) {
            if (Object.prototype.hasOwnProperty.call(targetNode, key)) {
                const elementPath = `${currentPath}.${key}`;
                if (!Object.prototype.hasOwnProperty.call(sourceNode, key)) {
                    // Key only in target (deleted from source): remove from the copy
                    console.log(`    ➖ Removed key: '${elementPath}'`);
                    delete newTargetObject[key];
                    objectChanges = true;
                }
            }
        }
        changesMade = objectChanges;
        return { updatedNode: newTargetObject, changesMade };
    }
    // --- Primitive Synchronization ---
    else {
        // Primitives match type: keep target value
        return { updatedNode: targetNode, changesMade: false };
    }
}

/**
 * Sets a value at a nested path within an object/array.
 * Path uses dot notation for objects and simplified bracket notation (e.g., 'a.b[0].c').
 * Modifies the object in place. Creates structure if it doesn't exist.
 * @param {object|Array} obj - The object/array to modify.
 * @param {string} pathString - The path string (e.g., 'root.data.items[2].name').
 * @param {any} value - The value to set.
 */
export function setValueAtPath(obj, pathString, value) {
    // Remove 'root.' prefix if present and split path using regex for keys and indices
    const pathSegments = pathString.replace(/^root\.?/, '').split(/\.|\[(\d+)\]/).filter(Boolean);

    let current = obj;
    try {
        for (let i = 0; i < pathSegments.length - 1; i++) {
            const segment = pathSegments[i];
            const nextSegment = pathSegments[i + 1];
            const nextIsIndex = /^\d+$/.test(nextSegment); // Check if the next part looks like an index

            // Create path segment if it doesn't exist
            if (current[segment] === undefined || current[segment] === null) {
                current[segment] = nextIsIndex ? [] : {};
                // console.log(`Creating path segment: ${segment} as ${nextIsIndex ? 'Array' : 'Object'}`);
            }

            // Basic type checking/correction during traversal
            if (nextIsIndex && !Array.isArray(current[segment])) {
                console.warn(`Path type mismatch at '${pathSegments.slice(0, i + 1).join('.')}'. Expected Array, found ${typeof current[segment]}. Overwriting.`);
                current[segment] = [];
            } else if (!nextIsIndex && typeof current[segment] !== 'object') {
                // If next segment is a key, current segment must be an object (or we create it)
                console.warn(`Path type mismatch at '${pathSegments.slice(0, i + 1).join('.')}'. Expected Object, found ${typeof current[segment]}. Overwriting.`);
                current[segment] = {};
            } else if (!nextIsIndex && Array.isArray(current[segment])) {
                // Handle case where we expect an object but find an array (less common, more problematic)
                console.warn(`Path type mismatch at '${pathSegments.slice(0, i + 1).join('.')}'. Expected Object, found Array. Overwriting - existing array lost.`);
                current[segment] = {};
            }


            // Move to the next level
            current = current[segment];
            // Check if traversal failed (became non-object unexpectedly)
            if (typeof current !== 'object' || current === null) {
                throw new Error(`Cannot traverse path further at segment '${segment}'. Non-object/array encountered.`);
            }
        }

        // Set the final value at the last segment
        const finalSegment = pathSegments[pathSegments.length - 1];
        if (typeof current === 'object' && current !== null) {
            // console.log(`Setting value at final segment: ${finalSegment}`);
            current[finalSegment] = value;
        } else {
            // This should be caught by the loop check, but acts as a safeguard
            throw new Error(`Cannot set final value. Parent at path '${pathSegments.slice(0, -1).join('.')}' is not an object/array.`);
        }
    } catch (error) {
        console.error(`Error in setValueAtPath for path "${pathString}": ${error.message}`);
        // Depending on requirements, you might re-throw or just log
    }
}


// Simple error class (optional)
export class AppError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'AppError';
        this.code = code;
    }
}


