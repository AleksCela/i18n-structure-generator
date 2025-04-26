// translator.js (Strictly following user's specified syntax)

// IMPORTANT: Assumes '@google/genai' package providing this syntax is installed.
import { GoogleGenAI } from '@google/genai'; // <-- Using user's specified import

import iso6391 from 'iso-639-1';
import { createEmptyStructure } from "./utils.js"; // For fallback on errors

let aiClientInstance; // Stores the initialized client instance
let modelNameToUse; // Stores the model name used during initialization
const BATCH_SIZE = 30; // How many strings to translate per API call

// Regular expression to find common placeholder patterns
const PLACEHOLDER_REGEX = /(\{\{\s*[\w.]+\s*\}\}|{\s*[\w.]+\s*}|%[sd]|\%\{[\w.]+\}|:\w+)/g;

/**
 * Extracts unique, sorted placeholders from a text string.
 * @param {string} text The text to scan.
 * @returns {string[]} A sorted array of unique placeholders found.
 */
function extractPlaceholders(text) {
    if (typeof text !== 'string') return [];
    const matches = text.match(PLACEHOLDER_REGEX);
    if (!matches) return [];
    return [...new Set(matches)].sort();
}

/**
 * Compares placeholders between source and translated strings. Logs warning on mismatch.
 * @param {string} sourceText Original text.
 * @param {string} translatedText Text received from LLM.
 * @param {string} identifier A path or index for logging warnings.
 * @returns {boolean} True if placeholders match or none exist in source, false otherwise.
 */
function comparePlaceholders(sourceText, translatedText, identifier) {
    const sourcePlaceholders = extractPlaceholders(sourceText);
    const translatedPlaceholders = extractPlaceholders(translatedText);

    if (sourcePlaceholders.length === 0) return true; // No source placeholders, nothing to mismatch

    if (sourcePlaceholders.length !== translatedPlaceholders.length) {
        console.warn(`  ⚠️ Placeholder count mismatch at '${identifier}':`);
        console.warn(`     Source (${sourcePlaceholders.length}): [${sourcePlaceholders.join(', ')}]`);
        console.warn(`     Target (${translatedPlaceholders.length}): [${translatedPlaceholders.join(', ')}]`);
        return false;
    }

    const mismatch = sourcePlaceholders.some((ph, index) => ph !== translatedPlaceholders[index]);
    if (mismatch) {
        console.warn(`  ⚠️ Placeholder content mismatch at '${identifier}':`);
        console.warn(`     Source: [${sourcePlaceholders.join(', ')}]`);
        console.warn(`     Target: [${translatedPlaceholders.join(', ')}]`);
        return false;
    }
    return true; // Match
}

/**
 * Initializes the Google AI client using the exact syntax provided by the user.
 * @param {string} apiKey - The user's Google AI API key.
 * @param {string} [modelName='gemini-1.5-flash'] - The model name from user's example.
 * @throws {Error} If initialization fails.
 */
export function initializeTranslator(apiKey, modelName = 'gemini-1.5-flash') {
    if (!apiKey) throw new Error("API Key is required for translation.");
    try {
        // Initialize using the exact syntax: new GoogleGenAI({ apiKey })
        aiClientInstance = new GoogleGenAI({ apiKey });
        modelNameToUse = modelName;
        console.log(`Translator initialized (using user-provided syntax) with model: ${modelNameToUse}`);
    } catch (error) {
        console.error("Failed to initialize Google AI Client:", error.message);
        console.error("Ensure the package providing 'new GoogleGenAI({ apiKey })' syntax (e.g., '@google/genai'?) is installed.");
        throw new Error(`Failed to initialize Google AI Client.`);
    }
}

/**
 * Internal: Translates a small batch of strings using user's syntax, validates placeholders.
 * Reverts to original string in batch if placeholder validation fails.
 * @param {string[]} texts - Array of original strings.
 * @param {string} sourceLangCode
 * @param {string} targetLangCode
 * @returns {Promise<string[]>} Array of translated (or original) strings.
 */
async function translateBatchInternal(texts, sourceLangCode, targetLangCode) {
    if (!aiClientInstance) return texts;
    const sourceLangName = iso6391.getName(sourceLangCode) || sourceLangCode;
    const targetLangName = iso6391.getName(targetLangCode) || targetLangCode;

    const validTextsInfo = texts
        .map((text, index) => ({ text, originalIndex: index }))
        .filter(item => item.text && typeof item.text === 'string' && item.text.trim());

    if (validTextsInfo.length === 0) {
        return texts.map(t => (typeof t === 'string' ? t : ""));
    }

    const textsToSend = validTextsInfo.map(item => item.text);

    const promptText = `Translate the following list of ${textsToSend.length} text strings accurately from ${sourceLangName} to ${targetLangName}.
IMPORTANT: Preserve any interpolation placeholders exactly as they appear in the source text (e.g., {{variable}}, %s, :value, {0}). Do not translate the content within placeholders.
Return ONLY a valid JSON array where each element is the translated string corresponding to the input strings, in the exact same order.
Do not include explanations, markdown formatting, or anything outside the JSON array structure (e.g., ["translation1", "translation2", ...]).

Input Texts:
${JSON.stringify(textsToSend, null, 2)}

JSON Array Output:`;

    const contents = [{ role: 'user', parts: [{ text: promptText }] }];
    const config = { responseMimeType: 'application/json' };

    try {
        await new Promise(resolve => setTimeout(resolve, 500));
        // Use the exact API call structure: ai.models.generateContent({...})
        const response = await aiClientInstance.models.generateContent({ model: modelNameToUse, config, contents });
        // Use the exact response handling: response.text
        const responseText = response.text;

        if (!responseText) {
            console.warn(`  ❓ Warning: Received empty text response for string batch. Keeping originals.`);
            return texts;
        }

        let translatedBatchRaw = [];
        try {
            translatedBatchRaw = JSON.parse(responseText);
            if (!Array.isArray(translatedBatchRaw) || translatedBatchRaw.length !== textsToSend.length) {
                console.warn(`  ⚠️ Warning: String batch response was not a valid JSON array or length mismatch. Keeping originals.`);
                return texts;
            }
        } catch (parseError) {
            console.warn(`  ⚠️ Warning: Failed to parse string batch response as JSON array. Keeping originals.`);
            console.warn("     Raw Response Text:", responseText);
            return texts;
        }

        // Reconstruct the full results array, validating placeholders
        const finalResults = [...texts]; // Start with originals
        validTextsInfo.forEach((item, i) => {
            if (i < translatedBatchRaw.length) {
                const translatedString = translatedBatchRaw[i] ?? "";
                // Validate placeholders before accepting
                if (comparePlaceholders(item.text, translatedString, `batch item index ${item.originalIndex}`)) {
                    finalResults[item.originalIndex] = translatedString;
                } else {
                    console.warn(`     Reverting translation for batch item index ${item.originalIndex} due to placeholder mismatch.`);
                    finalResults[item.originalIndex] = item.text; // Revert
                }
            } else {
                finalResults[item.originalIndex] = item.text; // Fallback
            }
        });
        return finalResults;

    } catch (error) {
        console.error(`  ❌ API Error translating string batch to ${targetLangCode}: ${error.message}`);
        return texts; // Return original batch on error
    }
}

/** Collects non-empty strings from a nested structure. */
function collectStrings(node, strings) {
    if (Array.isArray(node)) { node.forEach(element => collectStrings(element, strings)); }
    else if (typeof node === 'object' && node !== null) { for (const key in node) { if (Object.prototype.hasOwnProperty.call(node, key)) { collectStrings(node[key], strings); } } }
    else if (typeof node === 'string' && node.trim()) { strings.push(node); }
}

/** Reconstructs structure replacing original strings with translated ones. */
function reconstructStructure(node, translatedState) {
    if (Array.isArray(node)) { return node.map(element => reconstructStructure(element, translatedState)); }
    else if (typeof node === 'object' && node !== null) { const newObj = {}; for (const key in node) { if (Object.prototype.hasOwnProperty.call(node, key)) { newObj[key] = reconstructStructure(node[key], translatedState); } } return newObj; }
    else if (typeof node === 'string' && node.trim()) { const nextTranslation = translatedState.list[translatedState.index] ?? node; translatedState.index++; return nextTranslation; }
    else { return node; }
}

/**
 * Translates only the strings within a given structure fragment using batching.
 * Used for translating newly added fragments during sync. Uses user's specified syntax internally.
 * @param {any} sourceStructureFragment - The source object/array fragment.
 * @param {string} sourceLangCode
 * @param {string} targetLangCode
 * @returns {Promise<any>} - The translated structure fragment.
 */
export async function translateStructureInBatches(sourceStructureFragment, sourceLangCode, targetLangCode) {
    if (!aiClientInstance) {
        console.warn("Translator not initialized. Returning original structure fragment.");
        return sourceStructureFragment;
    }
    const originalStrings = [];
    collectStrings(sourceStructureFragment, originalStrings);
    if (originalStrings.length === 0) return sourceStructureFragment;

    const allTranslatedStringsValidated = [];
    // console.log(`      Translating ${originalStrings.length} strings for fragment...`); // Optional logging
    for (let i = 0; i < originalStrings.length; i += BATCH_SIZE) {
        const batch = originalStrings.slice(i, i + BATCH_SIZE);
        const translatedBatch = await translateBatchInternal(batch, sourceLangCode, targetLangCode); // Uses user syntax
        allTranslatedStringsValidated.push(...translatedBatch);
        if (translatedBatch.length !== batch.length) {
            console.error("  ❌ ERROR: Batch translation returned incorrect number of items. Aborting fragment translation.");
            return sourceStructureFragment;
        }
    }

    if (allTranslatedStringsValidated.length !== originalStrings.length) {
        console.error(`  ❌ ERROR: Final count mismatch during fragment translation. Aborting reconstruction.`);
        return sourceStructureFragment;
    }

    const translationState = { index: 0, list: allTranslatedStringsValidated };
    const finalStructure = reconstructStructure(sourceStructureFragment, translationState);
    return finalStructure;
}


/**
 * Translates an entire JSON object structure using the user's specified syntax,
 * requesting a JSON response, parsing it, and validating placeholders. Used for new files.
 * @param {object | Array} sourceJson - The source JSON object/array.
 * @param {string} sourceLangCode - Source language code.
 * @param {string} targetLangCode - Target language code.
 * @returns {Promise<object | Array>} - Translated JSON or empty structure on failure.
 */
export async function translateJsonFileContent(sourceJson, sourceLangCode, targetLangCode) {
    if (!aiClientInstance) {
        console.warn("Translator not initialized. Returning empty structure.");
        return createEmptyStructure(sourceJson);
    }
    if (typeof sourceJson !== 'object' || sourceJson === null) {
        return createEmptyStructure(sourceJson);
    }

    const sourceLangName = iso6391.getName(sourceLangCode) || sourceLangCode;
    const targetLangName = iso6391.getName(targetLangCode) || targetLangCode;

    // Prompt asking for JSON translation, including placeholder instruction
    const promptText = `Translate the text values within the following JSON object from ${sourceLangName} to ${targetLangName}.
IMPORTANT INSTRUCTIONS:
1. Preserve the exact JSON structure (all keys, nesting, arrays, etc.).
2. Translate only the user-facing string values. Do not translate keys or non-string values.
3. Preserve any interpolation placeholders exactly as they appear (e.g., {{variable}}, %s, :value, {0}). Do not translate inside placeholders.
4. Output ONLY the raw translated JSON object. Do not include \`\`\`json markdown, explanations, or any text outside the JSON structure itself.

Source JSON:
\`\`\`json
${JSON.stringify(sourceJson, null, 2)}
\`\`\`

Translated JSON object only:`;

    const contents = [{ role: 'user', parts: [{ text: promptText }] }];
    const config = { responseMimeType: 'application/json' }; // Request JSON output

    try {
        console.log(`    Sending JSON structure for translation (${sourceLangCode} -> ${targetLangCode})...`);
        await new Promise(resolve => setTimeout(resolve, 600)); // Delay

        // Use the exact API call syntax: ai.models.generateContent({...})
        const response = await aiClientInstance.models.generateContent({ model: modelNameToUse, config, contents });

        // Use the exact response handling: response.text
        const responseText = response.text;

        if (!responseText) { /* ... handle empty response ... */
            console.warn(`  ⚠️ JSON translation returned empty text content. Creating empty structure.`);
            return createEmptyStructure(sourceJson);
        }

        let translatedJson;
        try {
            // Parse the potentially JSON string response
            translatedJson = JSON.parse(responseText);
            if (typeof translatedJson !== 'object' || translatedJson === null) { /* ... handle non-object ... */
                console.warn(`  ⚠️ API response was not a valid JSON object/array after parsing. Creating empty structure.`);
                return createEmptyStructure(sourceJson);
            }
        } catch (parseError) { /* ... handle parse error ... */
            console.warn(`  ⚠️ Failed to parse API response as JSON. Creating empty structure. Error: ${parseError.message}`);
            console.warn("     Raw Response Text (first 500 chars):", responseText.substring(0, 500) + (responseText.length > 500 ? '...' : ''));
            return createEmptyStructure(sourceJson);
        }

        // --- Validate Placeholders Recursively ---
        console.log("    Validating placeholders in translated JSON...");
        validateStructurePlaceholders(sourceJson, translatedJson); // Logs warnings on mismatch
        console.log("    Placeholder validation complete.");
        // ---------------------------------------

        console.log("    ✅ Successfully received and parsed translated JSON structure.");
        return translatedJson; // Return translated JSON (with potential warnings logged)

    } catch (error) { /* ... handle API error ... */
        console.error(`  ❌ API Error during JSON translation to ${targetLangCode}: ${error.message}`);
        console.error("     Falling back to creating empty structure.");
        return createEmptyStructure(sourceJson);
    }
}

/**
 * Recursive helper to validate placeholders throughout a translated JSON structure.
 * @param {*} sourceNode
 * @param {*} translatedNode
 * @param {string} path
 */
function validateStructurePlaceholders(sourceNode, translatedNode, path = 'root') {
    const sourceType = Array.isArray(sourceNode) ? 'array' : (sourceNode === null ? 'null' : typeof sourceNode);
    const translatedType = Array.isArray(translatedNode) ? 'array' : (translatedNode === null ? 'null' : typeof translatedNode);

    if (sourceType !== translatedType) return; // Skip validation if structure already diverged

    if (sourceType === 'array') {
        const commonLength = Math.min(sourceNode.length, translatedNode.length);
        for (let i = 0; i < commonLength; i++) {
            validateStructurePlaceholders(sourceNode[i], translatedNode[i], `${path}[${i}]`);
        }
    } else if (sourceType === 'object') {
        for (const key in sourceNode) {
            if (Object.prototype.hasOwnProperty.call(sourceNode, key) &&
                Object.prototype.hasOwnProperty.call(translatedNode, key)) { // Validate only common keys
                validateStructurePlaceholders(sourceNode[key], translatedNode[key], `${path}.${key}`);
            }
        }
    } else if (sourceType === 'string') {
        // Compare placeholders for this string node
        comparePlaceholders(sourceNode, translatedNode, path);
    }
}