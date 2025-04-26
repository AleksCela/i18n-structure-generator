// translator.js (Strictly following user's working example syntax)

// IMPORTANT: Ensure you have the correct package installed that provides this exact syntax.
// This code assumes 'import { GoogleGenAI } from "@google/genai";' works based on your test environment.
import { GoogleGenAI } from '@google/genai'; // <-- Using the exact import from user's example

import iso6391 from 'iso-639-1';
import { createEmptyStructure } from "./utils.js"; // For fallback on errors

let aiClientInstance; // Stores the initialized client instance (user's 'ai' variable)
let modelNameToUse; // Stores the model name used during initialization

// Safety settings are generally good practice, but omitting if not in user's exact example
// const safetySettings = [ ... ];

/**
 * Initializes the Google AI client using the exact syntax provided by the user.
 * @param {string} apiKey - The user's Google AI API key (e.g., GEMINI_API_KEY).
 * @param {string} [modelName='gemini-1.5-flash'] - The model name from user's example.
 * @throws {Error} If initialization fails.
 */
export function initializeTranslator(apiKey, modelName = 'gemini-1.5-flash') {
    if (!apiKey) {
        throw new Error("API Key is required for translation.");
    }
    try {
        // Initialize using the exact syntax from user example: new GoogleGenAI({ apiKey })
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
 * Translates an entire JSON object structure using the user's specified syntax
 * and the initialized client.
 * @param {object | Array} sourceJson - The source JSON object/array.
 * @param {string} sourceLangCode - ISO 639-1 source language code.
 * @param {string} targetLangCode - ISO 639-1 target language code.
 * @returns {Promise<object | Array>} - Translated JSON or empty structure on failure.
 */
export async function translateJsonFileContent(sourceJson, sourceLangCode, targetLangCode) {
    if (!aiClientInstance) {
        console.warn("Translator not initialized. Returning empty structure.");
        return createEmptyStructure(sourceJson);
    }
    if (typeof sourceJson !== 'object' || sourceJson === null) {
        console.warn("Invalid input: sourceJson is not an object/array. Returning empty structure.");
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
    // Configuration requesting JSON output type
    const config = { responseMimeType: 'application/json' };

    try {
        console.log(`    Sending JSON structure for translation (${sourceLangCode} -> ${targetLangCode})...`);
        // Optional delay (can be adjusted or removed)
        await new Promise(resolve => setTimeout(resolve, 500));

        // Use the exact API call structure from user example: ai.models.generateContent({...})
        const response = await aiClientInstance.models.generateContent({
            model: modelNameToUse, // Pass the stored model name
            config: config,        // Pass the mime type config
            contents: contents     // Pass the structured contents
        });

        // Use the exact response handling from user example: response.text
        const responseText = response.text; // Directly access .text property

        if (!responseText) {
            console.warn(`  ⚠️ JSON translation returned empty text content. Creating empty structure.`);
            // console.warn("Raw response object:", response); // For debugging if needed
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
        } else if (error.message.includes('quota') || error.message.includes('rate limit')) {
            console.error("     Hint: You might have exceeded the API rate limits or quota.");
        } else if (error.message.includes('token limit')) {
            console.error("     Hint: The source JSON file might be too large for the model's input/output limits.");
        }
        console.error("     Falling back to creating empty structure.");
        return createEmptyStructure(sourceJson); // Fallback on API error
    }
}