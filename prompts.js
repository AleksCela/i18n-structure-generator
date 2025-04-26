// prompts.js
import inquirer from 'inquirer';
// Import needs to be dynamic for ESM in some Node versions if validators isn't explicitly listed in package.json imports, but direct static should work with type:module
import { validateSourceLang, validateTargetLangs } from './validators.js';

/**
 * Gathers user input for base directory and languages.
 * @returns {Promise<object>} A promise that resolves with the user's answers.
 */
export async function getBaseInputs() {
    return await inquirer.prompt([
        {
            type: 'input',
            name: 'baseDir',
            message: 'Enter the base directory containing language folders (e.g., ./translations):',
            default: './translations',
        },
        {
            type: 'input',
            name: 'sourceLang',
            message: 'Enter the source language code (ISO 639-1, e.g., en, sq):',
            validate: validateSourceLang, // Use imported validator
            filter: input => input.trim().toLowerCase(),
        },
        {
            type: 'input',
            name: 'targetLangsString', // Keep name consistent with index.js usage
            message: 'Enter target language codes (ISO 639-1), comma-separated (e.g., fr, es, sq):',
            validate: validateTargetLangs, // Use imported validator
            // Filter transforms the comma-separated string into an array of codes
            filter: input => input.split(',').map(lang => lang.trim().toLowerCase()).filter(Boolean),
        },
    ]);
}
