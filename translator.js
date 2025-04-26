// translator.js (Strictly following user's working example syntax)

// IMPORTANT: Assumes '@google/genai' package providing this syntax is installed.
import { GoogleGenAI } from '@google/genai'; // <-- Using package name from user's example

import iso6391 from 'iso-639-1';
import { createEmptyStructure } from "./utils.js"; // For fallback on errors

let aiClientInstance; // Stores the initialized client instance (user's 'ai' variable)
let modelNameToUse; // Stores the model name used during initialization
const BATCH_SIZE = 30; // How many strings to translate per API call (adjust as needed)

// Safety settings are good practice, but omitted to strictly match user snippet if it didn't have them.
// Add them back inside getGenerativeModel if needed/supported by this library version.
// const safetySettings = [ ... ];

/**
 * Initializes the Google AI client using the exact syntax provided by the user.
 * @param {string} apiKey - The user's Google AI API key (e.g., GEMINI_API_KEY).
 * @param {string} [modelName='gemini-1.5-flash'] - The model name from user's example.
 * @throws {Error} If initialization fails.
 */
export function initializeTranslator(apiKey, modelName = 'gemini-1.5-flash') {
    if (!apiKey) throw new Error("API Key is required for translation.");
    try {
        // Initialize using the exact syntax: new GoogleGenAI({ apiKey })
        aiClientInstance = new GoogleGenAI({ apiKey });
        modelNameToUse = modelName; // Store the model name for use in generateContent
        console.log(`Translator initialized (using user-provided syntax) with model: ${modelNameToUse}`);
    } catch (error) {
        console.error("Failed to initialize Google AI Client:", error.message);
        console.error("Ensure the package providing 'new GoogleGenAI({ apiKey })' syntax (e.g., '@google/genai'?) is installed.");
        throw new Error(`Failed to initialize Google AI Client.`);
    }
}

/**
 * Internal function to translate a small batch of strings using user's syntax.
 * NOTE: This batching function attempts to request a JSON array back.
 * @param {string[]} texts - Array of strings (non-empty).
 * @param {string} sourceLangCode
 * @param {string} targetLangCode
 * @returns {Promise<string[]>} Array of translated strings or originals on failure.
 */
async function translateBatchInternal(texts, sourceLangCode, targetLangCode) {
    if (!aiClientInstance) return texts; // Not initialized
    const sourceLangName = iso6391.getName(sourceLangCode) || sourceLangCode;
    const targetLangName = iso6391.getName(targetLangCode) || targetLangCode;

    // Construct prompt asking for JSON array output
    const promptText = `Translate the following list of ${texts.length} text strings accurately from ${sourceLangName} to ${targetLangName}.
Return ONLY a valid JSON array where each element is the translated string corresponding to the input strings, in the exact same order.
Do not include explanations, markdown formatting, or anything outside the JSON array structure (e.g., ["translation1", "translation2", ...]).

Input Texts:
${JSON.stringify(texts, null, 2)}

JSON Array Output:`;

    const contents = [{ role: 'user', parts: [{ text: promptText }] }];
    // Request JSON response type
    const config = { responseMimeType: 'application/json' };

    try {
        await new Promise(resolve => setTimeout(resolve, 500)); // Delay

        // Use the exact API call structure: ai.models.generateContent({...})
        const response = await aiClientInstance.models.generateContent({
            model: modelNameToUse,
            config: config,
            contents: contents
        });

        // Use the exact response handling: response.text
        const responseText = response.text;

        if (!responseText) {
            console.warn(`  ❓ Warning: Received empty text response for string batch. Keeping originals.`);
            return texts;
        }

        // Try parsing the response text as JSON array
        try {
            const translatedBatch = JSON.parse(responseText);
            if (!Array.isArray(translatedBatch) || translatedBatch.length !== texts.length) {
                console.warn(`  ⚠️ Warning: String batch response was not a valid JSON array or length mismatch. Keeping originals.`);
                console.warn("     Raw Response Text:", responseText);
                return texts;
            }
            // Replace any null/undefined translations with empty string for consistency
            return translatedBatch.map(t => t ?? "");
        } catch (parseError) {
            console.warn(`  ⚠️ Warning: Failed to parse string batch response as JSON array. Keeping originals.`);
            console.warn("     Raw Response Text:", responseText);
            return texts;
        }
    } catch (error) {
        console.error(`  ❌ API Error translating string batch to ${targetLangCode}: ${error.message}`);
        return texts; // Return original batch on error
    }
}

/**
 * Collects non-empty strings from a nested structure.
 * @param {any} node
 * @param {string[]} strings - Array to push strings into.
 */
function collectStrings(node, strings) {
    if (Array.isArray(node)) {
        node.forEach(element => collectStrings(element, strings));
    } else if (typeof node === 'object' && node !== null) {
        for (const key in node) {
            if (Object.prototype.hasOwnProperty.call(node, key)) {
                collectStrings(node[key], strings);
            }
        }
    } else if (typeof node === 'string' && node.trim()) { // Only collect non-empty strings
        strings.push(node);
    }
}

/**
 * Reconstructs structure replacing original strings with translated ones.
 * @param {any} node - The original source node structure.
 * @param {{ index: number, list: string[] }} translatedState - Mutable state.
 * @returns {any} - The reconstructed structure.
 */
function reconstructStructure(node, translatedState) {
    if (Array.isArray(node)) {
        return node.map(element => reconstructStructure(element, translatedState));
    } else if (typeof node === 'object' && node !== null) {
        const newObj = {};
        for (const key in node) {
            if (Object.prototype.hasOwnProperty.call(node, key)) {
                newObj[key] = reconstructStructure(node[key], translatedState);
            }
        }
        return newObj;
    } else if (typeof node === 'string' && node.trim()) {
        // If it was a non-empty string we collected, replace it
        const nextTranslation = translatedState.list[translatedState.index] ?? node; // Fallback to original
        translatedState.index++;
        return nextTranslation;
    } else {
        // Keep numbers, booleans, null, empty strings as is
        return node;
    }
}

/**
 * Translates only the strings within a given structure (object/array) using batching.
 * Used for translating newly added fragments during sync. Uses user's specified syntax.
 * @param {any} sourceStructure - The source object/array fragment.
 * @param {string} sourceLangCode
 * @param {string} targetLangCode
 * @returns {Promise<any>} - The translated structure fragment.
 */
export async function translateStructureInBatches(sourceStructure, sourceLangCode, targetLangCode) {
    if (!aiClientInstance) {
        console.warn("Translator not initialized. Returning original structure fragment.");
        return sourceStructure;
    }

    const originalStrings = [];
    collectStrings(sourceStructure, originalStrings);

    if (originalStrings.length === 0) {
        return sourceStructure; // Nothing to translate
    }

    const allTranslatedStrings = [];
    // console.log(`      Translating ${originalStrings.length} strings for fragment...`);
    for (let i = 0; i < originalStrings.length; i += BATCH_SIZE) {
        const batch = originalStrings.slice(i, i + BATCH_SIZE);
        // Use the internal batch translator which uses the user's syntax
        const translatedBatch = await translateBatchInternal(batch, sourceLangCode, targetLangCode);
        allTranslatedStrings.push(...translatedBatch);
        if (translatedBatch.length !== batch.length) {
            console.error("  ❌ ERROR: Batch translation returned incorrect number of items. Aborting fragment translation.");
            return sourceStructure; // Return original fragment on error
        }
    }

    if (allTranslatedStrings.length !== originalStrings.length) {
        console.error(`  ❌ ERROR: Final count mismatch during fragment translation. Aborting reconstruction.`);
        return sourceStructure;
    }

    const translationState = { index: 0, list: allTranslatedStrings };
    const finalStructure = reconstructStructure(sourceStructure, translationState);
    return finalStructure;
}


/**
 * Translates an entire JSON object structure using the user's specified syntax,
 * requesting a JSON response and parsing it. Used for translating whole new files.
 * @param {object | Array} sourceJson - The source JSON object/array to translate.
 * @param {string} sourceLangCode - ISO 639-1 source language code.
 * @param {string} targetLangCode - ISO 639-1 target language code.
 * @returns {Promise<object | Array>} - The translated JSON object/array, or an empty structure on failure.
 */
export async function translateJsonFileContent(sourceJson, sourceLangCode, targetLangCode) {
    if (!aiClientInstance) {
        console.warn("Translator not initialized. Returning empty structure.");
        return createEmptyStructure(sourceJson);
    }
    if (typeof sourceJson !== 'object' || sourceJson === null) {
        console.warn("Input is not a valid object/array. Returning empty structure.");
        return createEmptyStructure(sourceJson);
    }

    const sourceLangName = iso6391.getName(sourceLangCode) || sourceLangCode;
    const targetLangName = iso6391.getName(targetLangCode) || targetLangCode;

    // Construct the prompt exactly as in the user's example
    const promptText = `Translate the text values within the following JSON object from ${sourceLangName} to ${targetLangName}.
IMPORTANT INSTRUCTIONS:
1. Preserve the exact JSON structure (all keys, nesting, arrays, etc.).
2. Translate only the user-facing string values. Do not translate keys or non-string values (like numbers or booleans).
3. Output ONLY the raw translated JSON object. Do not include \`\`\`json markdown, explanations, apologies, or any text outside the JSON structure itself.

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

        // Use the exact API call structure from user example: ai.models.generateContent({...})
        const response = await aiClientInstance.models.generateContent({
            model: modelNameToUse,
            config: config,
            contents: contents
        });

        // Use the exact response handling from user example: response.text
        const responseText = response.text;

        if (!responseText) {
            console.warn(`  ⚠️ JSON translation returned empty text content. Creating empty structure.`);
            return createEmptyStructure(sourceJson);
        }

        // Try parsing the response text as JSON
        try {
            const translatedJson = JSON.parse(responseText);
            if (typeof translatedJson === 'object' && translatedJson !== null) {
                console.log("    ✅ Successfully received and parsed translated JSON structure.");
                return translatedJson;
            } else {
                console.warn(`  ⚠️ API response was not a valid JSON object/array after parsing. Creating empty structure.`);
                console.warn("     Parsed Response:", translatedJson);
                return createEmptyStructure(sourceJson);
            }
        } catch (parseError) {
            console.warn(`  ⚠️ Failed to parse API response as JSON. Creating empty structure. Error: ${parseError.message}`);
            console.warn("     Raw Response Text (first 500 chars):", responseText.substring(0, 500) + (responseText.length > 500 ? '...' : ''));
            return createEmptyStructure(sourceJson);
        }

    } catch (error) {
        console.error(`  ❌ API Error during JSON translation to ${targetLangCode}: ${error.message}`);
        // Add specific hints...
        if (error.message.includes('API key not valid')) {
            console.error("     Hint: Check the API key provided during the prompt.");
        }
        console.error("     Falling back to creating empty structure.");
        return createEmptyStructure(sourceJson); // Fallback on API error
    }
}